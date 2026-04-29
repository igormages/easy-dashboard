import * as vscode from 'vscode';

import { getUiLangForHtml, uiT } from './ui-locale';

function escapeAttr(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;');
}

function getNonce(): string {
	let t = '';
	const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		t += c.charAt(Math.floor(Math.random() * c.length));
	}
	return t;
}

/** Vue webview au-dessus de l’arbre : champ pour filtrer les projets */
export class SidebarSearchWebviewViewProvider implements vscode.WebviewViewProvider {

	static readonly viewId = 'easy-dashboard-search';

	private view?: vscode.WebviewView;

	constructor(private readonly onQueryChange: (query: string) => void) {}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	): void {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
		};
		const nonce = getNonce();
		webviewView.webview.html = this.getHtml(webviewView.webview, nonce);

		let debounce: ReturnType<typeof setTimeout> | undefined;
		webviewView.onDidDispose(() => {
			if (debounce) {
				clearTimeout(debounce);
			}
		});
		webviewView.webview.onDidReceiveMessage((msg: { type?: string; value?: string }) => {
			if (msg?.type === 'search' && typeof msg.value === 'string') {
				if (debounce) {
					clearTimeout(debounce);
				}
				debounce = setTimeout(() => this.onQueryChange(msg.value as string), 150);
			}
		});
	}

	/** À appeler si `easy-dashboard.uiLocale` change pendant que la vue est visible. */
	refreshI18nHtml(): void {
		if (!this.view) {
			return;
		}
		const nonce = getNonce();
		this.view.webview.html = this.getHtml(this.view.webview, nonce);
	}

	private getHtml(webview: vscode.Webview, nonce: string): string {
		const csp = webview.cspSource;
		const ph = uiT('Search for a project…');
		const aria = uiT('Search for a project');
		const lang = escapeAttr(getUiLangForHtml());
		return `<!DOCTYPE html>
<html lang="${lang}">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
</head>
<body style="margin:0;padding:4px 0 2px 0;">
	<input type="search" id="q" placeholder="${escapeAttr(ph)}" aria-label="${escapeAttr(aria)}"
		style="width:100%;box-sizing:border-box;padding:4px 8px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);border-radius:2px;font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);" />
	<script nonce="${nonce}">
		(function () {
			const vscode = acquireVsCodeApi();
			const input = document.getElementById('q');
			function send() {
				vscode.postMessage({ type: 'search', value: input.value || '' });
			}
			input.addEventListener('input', send);
			input.addEventListener('change', send);
		})();
	</script>
</body>
</html>`;
	}
}

export function registerSidebarSearchView(
	context: vscode.ExtensionContext,
	onQueryChange: (query: string) => void
): SidebarSearchWebviewViewProvider {
	const provider = new SidebarSearchWebviewViewProvider(onQueryChange);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(SidebarSearchWebviewViewProvider.viewId, provider, {
			webviewOptions: { retainContextWhenHidden: true },
		})
	);
	return provider;
}
