import { debugService } from "../debug/debug.module";
import { CollaborationService } from "./collaboration.service";

let collaborationService: CollaborationService
import { CANNONICAL_NAME } from "../constants";
import { CollaborativeStore } from "./collaborative-store";

export let collaborativeStoreSocket: SocketModule;
export let collaborativeStore: CollaborativeStore;

export default {
    hooks: {
        init() {
            if (!game.modules.get('socketlib')?.active) {
                debugService.warn(
                    'Collaborative editing is disabled because SocketLib is not installed or not active.',
                );
            }
        },
        socketlib() {
            collaborativeStoreSocket = socketlib.registerModule(CANNONICAL_NAME);
            collaborativeStore = new CollaborativeStore();
            collaborativeStore.activateSocketListeners(collaborativeStoreSocket);
        }
    }
};
