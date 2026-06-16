import * as https from 'https';
import * as vscode from 'vscode';
import { logger } from '../shared/log_service';
import { QuotaSnapshot, ModelQuotaInfo } from '../shared/types';
import { API_ENDPOINTS } from '../shared/constants';

export class ReactorCore {
    private connectPort?: number;
    private csrfToken?: string;
    private timer?: NodeJS.Timeout;
    private snapshotChangeEmitter = new vscode.EventEmitter<QuotaSnapshot>();

    public readonly onSnapshotChange = this.snapshotChangeEmitter.event;

    engage(port: number, token: string, diagnostics: any) {
        this.connectPort = port;
        this.csrfToken = token;
        logger.info(`Reactor engaged on port ${port}`);
    }

    startReactor(intervalMs: number) {
        if (this.timer) { clearInterval(this.timer); }
        this.syncTelemetry();
        this.timer = setInterval(() => this.syncTelemetry(), intervalMs);
    }

    shutdown() {
        if (this.timer) { clearInterval(this.timer); }
        this.snapshotChangeEmitter.dispose();
    }

    async syncTelemetry() {
        if (!this.connectPort || !this.csrfToken) { return; }
        try {
            const data = await this.fetchLocalQuota();
            const snapshot = this.parseResponse(data);
            this.snapshotChangeEmitter.fire(snapshot);
        } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            logger.error(`Sync error: ${errorMsg}`);
            
            // UI에 에러 상태를 전달하기 위해 빈 모델과 isConnected = false로 전송
            this.snapshotChangeEmitter.fire({
                timestamp: new Date(),
                isConnected: false,
                models: [],
                errorMessage: errorMsg
            });
        }
    }

    private fetchLocalQuota(): Promise<any> {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify({
                metadata: { ideName: 'antigravity', extensionName: 'antigravity', locale: 'en' }
            });
            const req = https.request({
                hostname: '127.0.0.1',
                port: this.connectPort,
                path: API_ENDPOINTS.GET_USER_STATUS,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data),
                    'Connect-Protocol-Version': '1',
                    'X-Codeium-Csrf-Token': this.csrfToken,
                },
                rejectUnauthorized: false,
                timeout: 10000,
                agent: false
            }, res => {
                let body = '';
                res.on('data', d => body += d);
                res.on('end', () => {
                    try { resolve(JSON.parse(body)); } catch(e) { reject(new Error('JSON Parse failed')); }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Timeout'));
            });
            req.write(data);
            req.end();
        });
    }

    private parseResponse(data: any): QuotaSnapshot {
        const models: ModelQuotaInfo[] = [];
        const status = data?.userStatus;
        if (status?.cascadeModelConfigData?.clientModelConfigs) {
            for (const m of status.cascadeModelConfigData.clientModelConfigs) {
                if (m.quotaInfo) {
                    models.push({
                        label: m.label || m.modelOrAlias?.model || 'Unknown',
                        modelId: m.modelOrAlias?.model || 'unknown',
                        remainingPercentage: m.quotaInfo.remainingFraction !== undefined ? m.quotaInfo.remainingFraction * 100 : undefined,
                        resetTime: new Date(),
                        resetTimeDisplay: '',
                        timeUntilResetFormatted: '',
                        isExhausted: m.quotaInfo.remainingFraction === 0,
                        remainingFraction: m.quotaInfo.remainingFraction,
                        timeUntilReset: 0,
                        resetTimeValid: true
                    });
                }
            }
        }
        return {
            timestamp: new Date(),
            isConnected: true,
            models
        };
    }
}
