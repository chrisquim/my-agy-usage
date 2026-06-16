import * as vscode from 'vscode';
import { QuotaSnapshot } from '../shared/types';

export class StatusBarController {
    private statusBarItem: vscode.StatusBarItem;
    private globalState: vscode.Memento;
    private lastSnapshot?: QuotaSnapshot;

    constructor(context: vscode.ExtensionContext) {
        this.globalState = context.globalState;
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100,
        );
        this.statusBarItem.command = 'myAgyUsage.refresh';
        this.statusBarItem.text = `Loading Quota...`;
        this.statusBarItem.show();

        context.subscriptions.push(this.statusBarItem);
    }

    public update(snapshot: QuotaSnapshot): void {
        if (!snapshot.isConnected) {
            this.statusBarItem.text = `Quota Error`;
            this.statusBarItem.tooltip = snapshot.errorMessage || 'Failed to sync quota';
            return;
        }

        this.lastSnapshot = snapshot;
        const pinnedModel = this.globalState.get<string>('pinnedModel', '');

        let targetPct = 100;
        let targetLabel = 'Unknown';

        if (snapshot.models && snapshot.models.length > 0) {
            // Find the pinned model
            const target = snapshot.models.find(m => m.label === pinnedModel);
            if (target) {
                targetPct = target.remainingPercentage ?? 0;

                // Format label to Gemini or Claude / GPT
                const lowerLabel = target.label.toLowerCase();
                if (lowerLabel.includes('claude') || lowerLabel.includes('gpt')) {
                    targetLabel = 'Claude / GPT';
                } else if (lowerLabel.includes('gemini')) {
                    targetLabel = 'Gemini';
                } else {
                    targetLabel = target.label;
                }
            } else {
                // Fallback to the first model if pinned model not found
                targetPct = snapshot.models[0].remainingPercentage ?? 0;

                const lowerLabel = snapshot.models[0].label.toLowerCase();
                if (lowerLabel.includes('claude') || lowerLabel.includes('gpt')) {
                    targetLabel = 'Claude / GPT';
                } else if (lowerLabel.includes('gemini')) {
                    targetLabel = 'Gemini';
                } else {
                    targetLabel = snapshot.models[0].label;
                }
            }
        }

        if (targetLabel !== 'Unknown') {
            this.statusBarItem.text = `${targetLabel} ${Math.floor(targetPct)}%`;
            this.statusBarItem.tooltip = this.generateTooltip(snapshot);
        } else {
            this.statusBarItem.text = `Quota OK`;
            this.statusBarItem.tooltip = 'Quota synced successfully';
        }
    }

    /** Re-render from the last snapshot — used when the pinned model changes (no re-fetch needed). */
    public repaint(): void {
        if (this.lastSnapshot) {
            this.update(this.lastSnapshot);
        }
    }

    public setLoading(text?: string): void {
        this.statusBarItem.text = text ? `Loading ${text}...` : `Loading...`;
    }

    public setError(message: string): void {
        this.statusBarItem.text = `Quota Error`;
        this.statusBarItem.tooltip = message;
    }

    public setReady(): void {
        this.statusBarItem.text = `Quota Ready`;
    }

    private generateTooltip(snapshot: QuotaSnapshot): vscode.MarkdownString {
        const tooltip = new vscode.MarkdownString();
        tooltip.isTrusted = true;
        tooltip.supportHtml = true;

        if (snapshot.models && snapshot.models.length > 0) {
            // Group models by family (Gemini vs Claude / GPT) so each family is
            // always its own selectable line, even when percentages match.
            const groups = new Map<string, { pct: number, labels: string[], representative: string }>();

            snapshot.models.forEach(m => {
                const lower = m.label.toLowerCase();
                let family = 'Other';
                if (lower.includes('claude') || lower.includes('gpt')) {
                    family = 'Claude / GPT';
                } else if (lower.includes('gemini')) {
                    family = 'Gemini';
                }

                const pct = m.remainingPercentage ?? 0;
                if (!groups.has(family)) {
                    groups.set(family, { pct, labels: [], representative: m.label });
                }
                const group = groups.get(family)!;
                group.labels.push(m.label);
                // Show the lowest remaining % within the family (most conservative)
                group.pct = Math.min(group.pct, pct);
                // Prefer a Claude/Gemini model as the representative to pin
                if (lower.includes('claude') || lower.includes('gemini')) {
                    group.representative = m.label;
                }
            });

            groups.forEach((data, groupName) => {
                // The tooltip is click-only; the pinned selection is shown in the status
                // bar instead (an open tooltip can't re-render live in VS Code).
                const encodedArg = encodeURIComponent(JSON.stringify(data.representative));
                tooltip.appendMarkdown(`[${groupName}](command:myAgyUsage.setPinnedModel?${encodedArg}) : ${Math.floor(data.pct)}%\n\n`);
            });
        } else {
            tooltip.appendMarkdown('No quota data available\n');
        }

        tooltip.appendMarkdown('\n---\n*Click to choose one.*');
        return tooltip;
    }
}
