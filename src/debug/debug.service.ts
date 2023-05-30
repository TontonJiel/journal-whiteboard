import { MODULE_NAME } from '../constants';
import { DebugSettings } from './debug.settings';

export class DebugService {
    constructor(private readonly debugSettings: DebugSettings) {}

    log(...args: unknown[]) {
        if (this.debugSettings.debug) {
            console.log(`${MODULE_NAME} |`, ...args);
        }
    }
}
