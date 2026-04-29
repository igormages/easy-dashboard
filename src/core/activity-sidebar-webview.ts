import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import Dashboard from './dashboard';
import { uiT } from './ui-locale';
import { escapeHtml } from './i18n-catalog';

export const ACTIVITY_WEBVIEW_VIEW_ID = 'easy-dashboard-activity-webview';

export class ActivitySidebarWebviewViewProvider implements vscode.WebviewViewProvider {

	constructor(private readonly dashboard: Dashboard) {}

	resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void> {
		const bundleJs = path.join(this.dashboard.ext.extensionPath, 'local', 'dist', 'index.js');
		if (!fs.existsSync(bundleJs)) {
			webviewView.webview.html = `<!DOCTYPE html><html><body style="padding:10px;font-family:sans-serif;font-size:13px;">${escapeHtml(uiT(
				'Easy Dashboard: the web UI bundle is missing (local/dist). Run npm run build:webview then reload the window.'
			))}</body></html>`;
			return;
		}

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.file(this.dashboard.ext.extensionPath)],
		};

		this.dashboard.setActivityWebviewView(webviewView);
		webviewView.webview.html = this.dashboard.generateActivityViewContent(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(raw => {
			const r = raw as { type?: string; data?: object };
			if (typeof r?.type !== 'string') return;
			this.dashboard.onMessage({ type: r.type, data: r.data ?? {} });
		});

		webviewView.onDidDispose(() => {
			this.dashboard.setActivityWebviewView(undefined);
		});
	}
}
