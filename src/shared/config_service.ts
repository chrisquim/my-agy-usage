import * as vscode from 'vscode';
import { CONFIG_KEYS, TIMING } from './constants';

class ConfigService {
    private readonly configSection = 'myAgyUsage';

    getRefreshIntervalMs(): number {
        const config = vscode.workspace.getConfiguration(this.configSection);
        const seconds = config.get<number>(
            CONFIG_KEYS.REFRESH_INTERVAL,
            TIMING.DEFAULT_REFRESH_INTERVAL_MS / 1000,
        );
        return seconds * 1000;
    }
}

export const configService = new ConfigService();
