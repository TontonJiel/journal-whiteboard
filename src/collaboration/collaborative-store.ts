import { TLInstanceId, TLRecord, TLStore, TLUser, TLUserId, TLUserPresence } from '@tldraw/tldraw';
import { RecordsDiff, SerializedSchema, StoreListener, StoreSnapshot, compareSchemas } from '@tldraw/tlstore';
import { MODULE_NAME } from '../constants';

type Diff = {
    instanceId: TLInstanceId;
    changes: RecordsDiff<TLRecord>;
    schema: SerializedSchema;
};

export type Snapshot = {
    store: StoreSnapshot<TLRecord>;
    schema: SerializedSchema;
};

export type ConcurrentUser = {
    name: string;
    id: string;
    color: string;
};

type UserState = Record<string, TLUser | TLUserPresence>

export class CollaborativeStore {
    stores: Map<TLInstanceId, TLStore> = new Map();
    socket: SocketModule;

    activateSocketListeners(socket: SocketModule) {
        this.socket = socket;
        this.socket.register('connectUser', this.handleConnectUser.bind(this));
        this.socket.register('disconnectUser', this.handleDisconnectUser.bind(this));
        this.socket.register('updateUsers', this.handleUpdateUsers.bind(this));
        this.socket.register('getRemoteSnapshot', this.handleGetRemoteSnapshot.bind(this));
        this.socket.register('events', this.handleEvents.bind(this));
    }

    registerStore(instanceId: TLInstanceId, store: TLStore) {
        this.stores.set(instanceId, store);
    }

    getStore(instanceId: TLInstanceId) {
        const store = this.stores.get(instanceId);
        if (!store) {
            throw new Error(`No store found for instance ${instanceId}`);
        }
        return store;
    }

    connectUser(instanceId: TLInstanceId) {
        this.socket.executeForOthers('connectUser', instanceId);
    }

    disconnectUser(instanceId: TLInstanceId, userId: TLUserId) {
        this.socket.executeForOthers('disconnectUser', instanceId, userId);
    }

    handleDisconnectUser(instanceId: TLInstanceId, userId: TLUserId) {
        let store
        try {
            store = this.getStore(instanceId)
        } catch (e) {
            return
        }
        store.mergeRemoteChanges(() => {
            store.remove([userId])
        })
    }

    handleConnectUser(instanceId: TLInstanceId) {
        let store
        try {
            store = this.getStore(instanceId)
        } catch (e) {
            return
        }
        const userState = store.serialize(record => ['user', 'user_presence'].includes(record.typeName))
        this.socket.executeForOthers('updateUsers', instanceId, userState);
    }

    handleUpdateUsers(instanceId: TLInstanceId, userState: UserState) {
        const store = this.getStore(instanceId)
        store.mergeRemoteChanges(() => {
            store.put(Object.values(userState))
        });
    }

    handleEvents(diff: Diff) {
        let store: TLStore;
        try {
            store = this.getStore(diff.instanceId);
        } catch (e) {
            return;
        }
        const comparison = compareSchemas(store.schema.serialize(), diff.schema);
        if (comparison === -1) {
            console.error(`${MODULE_NAME} | Schema mismatch. Can't apply changes.`);
            return;
        } else if (comparison === 1) {
            console.warn(`${MODULE_NAME} | Schema mismatch. Applying changes anyway.`);
        }
        store.mergeRemoteChanges(() => {
            store.applyDiff(diff.changes);
        });
    }

    async restoreFromRemote(instanceId: TLInstanceId) {
        const snapshot = await this.socket.executeAsGM(
            'getRemoteSnapshot',
            instanceId,
        );
        if (!snapshot) {
            return;
        }
        const store = this.getStore(instanceId);
        const migrationResult = store.schema.migrateStoreSnapshot(snapshot.store, snapshot.schema);

        if (migrationResult.type === 'error') {
            return;
        }
        store.mergeRemoteChanges(() => {
            store.put(Object.values(migrationResult.value));
        });
    }

    handleGetRemoteSnapshot(instanceId: TLInstanceId): Snapshot {
        const store = this.getStore(instanceId);
        const documentState = store.serialize(r => {
            return ![
                'instance',
                'camera',
                'instance_page_state',
                'instance_presence',
                'user_document',
            ].includes(r.typeName);
        });
        const snapshot = {
            store: documentState,
            schema: store.schema.serialize(),
        };
        return snapshot;
    }

    getSnapshot(instanceId: TLInstanceId): Snapshot {
        const store = this.getStore(instanceId);
        const documentState = store.serialize(r => {
            return ![
                'instance',
                'camera',
                'instance_page_state',
                'user',
                'instance_presence',
                'user_document',
                'user_presence',
            ].includes(r.typeName);
        });
        const snapshot = {
            store: documentState,
            schema: store.schema.serialize(),
        };
        return snapshot;
    }

    restoreSnapshot(instanceId: TLInstanceId, snapshot: any) {
        const store = this.getStore(instanceId);
        const migrationResult = store.schema.migrateStoreSnapshot(snapshot.store, snapshot.schema);

        if (migrationResult.type === 'error') {
            console.error(`${MODULE_NAME} | Failed to migrate snapshot: ${migrationResult.reason}`);
            return;
        }
        store.deserialize(migrationResult.value);
    }

    put(instanceId: TLInstanceId, changes: RecordsDiff<TLRecord>, source: string) {
        if (source !== 'user') {
            return;
        }
        const store = this.getStore(instanceId);
        this.socket.executeForEveryone('events', {
            instanceId,
            changes: changes,
            schema: store.schema.serialize(),
        });
    }

    listen(instanceId: TLInstanceId, listener: StoreListener<TLRecord>) {
        const store = this.getStore(instanceId);
        return store.listen(listener)
    }

    getConcurrentUsers(instanceId: TLInstanceId): ConcurrentUser[] {
        const store = this.getStore(instanceId);
        const storedUsers = store.serialize(record => ['user'].includes(record.typeName)) as unknown as TLUser[]
        const storedUserPresences = store.serialize(record => ['user_presence'].includes(record.typeName)) as unknown as TLUserPresence[]
        const users = {}
        for (const [userId, user] of Object.entries(storedUsers)) {
            const presence = Object.values(storedUserPresences).find(record => record.userId === userId)
            users[user.id] = {
                name: user.name,
                id: userId,
                color: presence?.color,
            }
        }
        return Object.values(users)
    }

    isCollaborativeMode() {
        return game.modules.get('socketlib')?.active
    }
}
