import * as vscode from 'vscode';
import { QuotaSnapshot, FamilyQuotaSummary, ServerQuotaGroup } from '../shared/types';
import { configService } from '../shared/config_service';

export class StatusBarController {
    private statusBarItem: vscode.StatusBarItem;
    private lastSnapshot?: QuotaSnapshot;
    private previousBucketFractions: Map<string, number> = new Map();

    constructor(context: vscode.ExtensionContext) {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100,
        );
        this.statusBarItem.command = 'myAgyUsage.refresh';
        this.statusBarItem.text = 'Loading Quota...';
        this.statusBarItem.show();

        context.subscriptions.push(this.statusBarItem);
    }

    public update(snapshot: QuotaSnapshot): void {
        if (!snapshot.isConnected) {
            this.statusBarItem.text = 'Quota Error';
            this.statusBarItem.tooltip = snapshot.errorMessage || 'Failed to sync quota';
            return;
        }

        if (snapshot.serverQuotaGroups && snapshot.serverQuotaGroups.length > 0) {
            this.checkResetNotifications(snapshot.serverQuotaGroups);
        }

        this.lastSnapshot = snapshot;

        if (snapshot.serverQuotaGroups && snapshot.serverQuotaGroups.length > 0) {
            this.statusBarItem.text = this.formatServerQuotaGroupsText(snapshot.serverQuotaGroups);
            this.statusBarItem.tooltip = this.generateServerTooltip(snapshot);
        } else if (snapshot.familySummaries && snapshot.familySummaries.length > 0) {
            this.statusBarItem.text = this.formatStatusBarText(snapshot.familySummaries);
            this.statusBarItem.tooltip = this.generateTooltip(snapshot);
        } else {
            this.statusBarItem.text = 'Quota OK';
            this.statusBarItem.tooltip = 'Quota synced — no model data available';
        }
    }

    public repaint(): void {
        if (this.lastSnapshot) {
            this.update(this.lastSnapshot);
        }
    }

    public setLoading(text?: string): void {
        this.statusBarItem.text = text ? `Loading ${text}...` : 'Loading...';
    }

    public setError(message: string): void {
        this.statusBarItem.text = 'Quota Error';
        this.statusBarItem.tooltip = message;
    }

    public setReady(): void {
        this.statusBarItem.text = 'Quota Ready';
    }

    private checkResetNotifications(groups: ServerQuotaGroup[]): void {
        if (!configService.getNotifyOnReset()) {
            return;
        }

        for (const g of groups) {
            const familyName = g.displayName || 'Model';
            for (const b of g.buckets || []) {
                const key = `${familyName}_${b.bucketId || b.displayName}`;
                const currentFraction = b.remainingFraction ?? 0;
                const prevFraction = this.previousBucketFractions.get(key);

                if (prevFraction !== undefined && prevFraction < 0.95 && currentFraction > prevFraction + 0.05) {
                    const pctStr = (currentFraction * 100).toFixed(0);
                    const rawBucketName = b.displayName || '';
                    const bucketName = rawBucketName.replace(/\s+Limit$/i, '').replace(/\bFive Hour\b/gi, '5-Hour');

                    vscode.window.showInformationMessage(
                        `⚡ Antigravity Quota Refreshed! ${familyName} (${bucketName}) is back to ${pctStr}%.`,
                    );

                    try {
                        vscode.commands.executeCommand('accessibility.signals.taskCompleted');
                    } catch {
                        // ignore if signal command unavailable in environment
                    }
                }

                this.previousBucketFractions.set(key, currentFraction);
            }
        }
    }

    private formatCountdown(resetTimeStr?: string): string {
        if (!resetTimeStr) {
            return '--';
        }
        const resetDate = new Date(resetTimeStr);
        const diff = resetDate.getTime() - Date.now();
        if (diff <= 0) {
            return '0m';
        }

        const h = Math.floor(diff / (1000 * 60 * 60));
        const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

        if (h >= 24) {
            const d = Math.floor(h / 24);
            const remainingH = h % 24;
            return `${d}d ${remainingH}h`;
        }
        if (h > 0) {
            return `${h}h${m.toString().padStart(2, '0')}m`;
        }
        return `${m}m`;
    }

    private getFontChartIcon(type: 'ring' | 'pie', fraction?: number): string {
        if (fraction === undefined) {
            return `$(myagy-${type}-0)`;
        }
        const pct = Math.max(0, Math.min(100, fraction * 100));
        const rounded = Math.round(pct / 5) * 5;
        return `$(myagy-${type}-${rounded})`;
    }

    private formatServerQuotaGroupsText(groups: ServerQuotaGroup[]): string {
        const selectedModel = configService.getStatusBarModel();

        let filteredGroups = groups;
        if (selectedModel === 'gemini') {
            filteredGroups = groups.filter(g => (g.displayName || '').includes('Gemini'));
        } else if (selectedModel === 'claudeGpt') {
            filteredGroups = groups.filter(g => (g.displayName || '').includes('Claude') || (g.displayName || '').includes('GPT'));
        }

        if (filteredGroups.length === 0) {
            filteredGroups = groups;
        }

        const parts = filteredGroups.map(g => {
            const familyName = g.displayName || '';
            const initial = familyName.includes('Gemini') ? 'G' : 'C';

            const buckets = g.buckets || [];
            const sprintBucket = buckets.find(b => b.window === '5h') || buckets[1];

            const sprintFraction = sprintBucket?.remainingFraction;
            const sprintPctNum = sprintFraction !== undefined ? Math.floor(sprintFraction * 100) : 100;
            const sprintIcon = this.getFontChartIcon('ring', sprintFraction);

            return `${initial} ${sprintPctNum}% ${sprintIcon}`;
        });
        return parts.join(' | ');
    }

    private generateServerTooltip(snapshot: QuotaSnapshot): vscode.MarkdownString {
        const tooltip = new vscode.MarkdownString();
        tooltip.isTrusted = true;
        tooltip.supportThemeIcons = true;

        const lines: string[] = [];

        for (const g of snapshot.serverQuotaGroups!) {
            const familyName = g.displayName.includes('Gemini') ? 'Gemini' : 'Claude';
            const buckets = g.buckets || [];
            const sprintBucket = buckets.find(b => b.window === '5h') || buckets[1];
            const weeklyBucket = buckets.find(b => b.window === 'weekly') || buckets[0];

            const sprintFraction = sprintBucket?.remainingFraction;
            const sprintPct = sprintFraction !== undefined
                ? Math.floor(sprintFraction * 100)
                : 100;
            const sprintIcon = this.getFontChartIcon('ring', sprintFraction);
            const sprintCountdown = sprintBucket ? this.formatCountdown(sprintBucket.resetTime) : '--';

            const weeklyFraction = weeklyBucket?.remainingFraction;
            const weeklyPct = weeklyFraction !== undefined
                ? Math.floor(weeklyFraction * 100)
                : 100;
            const weeklyIcon = this.getFontChartIcon('pie', weeklyFraction);
            const weeklyCountdown = weeklyBucket ? this.formatCountdown(weeklyBucket.resetTime) : '--';

            lines.push(`**${familyName}** ${sprintIcon} 5h ${sprintPct}% ${sprintCountdown} · ${weeklyIcon} 7d ${weeklyPct}% ${weeklyCountdown}`);
        }

        tooltip.appendMarkdown(lines.join('  \n'));
        return tooltip;
    }

    private formatStatusBarText(summaries: FamilyQuotaSummary[]): string {
        const selectedModel = configService.getStatusBarModel();

        let filteredSummaries = summaries;
        if (selectedModel === 'gemini') {
            filteredSummaries = summaries.filter(s => s.familyName.includes('Gemini'));
        } else if (selectedModel === 'claudeGpt') {
            filteredSummaries = summaries.filter(s => s.familyName.includes('Claude') || s.familyName.includes('GPT'));
        }

        if (filteredSummaries.length === 0) {
            filteredSummaries = summaries;
        }

        const parts = filteredSummaries.map(s => {
            const initial = s.familyName.includes('Gemini') ? 'G' : 'C';
            const sprintIcon = this.getFontChartIcon('ring', s.sprintPct / 100);
            return `${initial} ${s.sprintPct}% ${sprintIcon}`;
        });
        return parts.join(' | ');
    }

    private generateTooltip(snapshot: QuotaSnapshot): vscode.MarkdownString {
        const tooltip = new vscode.MarkdownString();
        tooltip.isTrusted = true;
        tooltip.supportThemeIcons = true;

        if (snapshot.familySummaries && snapshot.familySummaries.length > 0) {
            const lines: string[] = [];
            for (const s of snapshot.familySummaries) {
                const name = s.familyName.includes('Gemini') ? 'Gemini' : 'Claude';
                const sprintIcon = this.getFontChartIcon('ring', s.sprintPct / 100);
                const weeklyIcon = this.getFontChartIcon('pie', s.weeklyPct / 100);
                lines.push(`**${name}** ${sprintIcon} 5h ${s.sprintPct}% ${s.sprintCountdown} · ${weeklyIcon} 7d ${s.weeklyPct}% ${s.weeklyCountdown}`);
            }
            tooltip.appendMarkdown(lines.join('  \n'));
        } else {
            tooltip.appendMarkdown('No quota data available');
        }

        return tooltip;
    }
}
