import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

let extensionPath: string | null = null;
let bundleEn: Record<string, string> | null = null;
let bundleFr: Record<string, string> | null = null;

export function setUiLocaleExtensionPath(p: string): void {
	extensionPath = p;
	bundleEn = null;
	bundleFr = null;
}

export function clearUiLocaleBundleCache(): void {
	bundleEn = null;
	bundleFr = null;
}

function readBundle(file: string): Record<string, string> | null {
	try {
		const raw = fs.readFileSync(file, 'utf8');
		const o = JSON.parse(raw) as Record<string, string>;
		return o && typeof o === 'object' ? o : null;
	} catch {
		return null;
	}
}

function getBundles(): { en: Record<string, string>; fr: Record<string, string> } | null {
	if (!extensionPath) {
		return null;
	}
	if (!bundleEn) {
		const p = path.join(extensionPath, 'l10n', 'bundle.l10n.json');
		bundleEn = readBundle(p) ?? {};
	}
	if (!bundleFr) {
		const p = path.join(extensionPath, 'l10n', 'bundle.l10n.fr.json');
		bundleFr = readBundle(p) ?? {};
	}
	return { en: bundleEn, fr: bundleFr };
}

function forcedMode(): 'en' | 'fr' | null {
	const v = vscode.workspace.getConfiguration('easy-dashboard').get<string>('uiLocale', 'auto');
	if (v === 'en' || v === 'fr') {
		return v;
	}
	return null;
}

function substitute(template: string, args: readonly (string | number | boolean)[]): string {
	let out = template;
	for (let i = 0; i < args.length; i++) {
		out = out.split(`{${i}}`).join(String(args[i]));
	}
	return out;
}

/**
 * Traduction runtime : respecte `easy-dashboard.uiLocale` (auto = vscode.l10n).
 */
export function uiT(message: string, ...args: (string | number | boolean)[]): string {
	const mode = forcedMode();
	if (!mode) {
		return vscode.l10n.t(message, ...args);
	}
	const packs = getBundles();
	if (!packs) {
		return args.length ? substitute(message, args) : message;
	}
	const map = mode === 'fr' ? packs.fr : packs.en;
	const template = map[message] ?? message;
	return args.length ? substitute(template, args) : template;
}

/** Attribut `lang` du HTML webview selon le réglage forcé ou l’éditeur. */
export function getUiLangForHtml(): string {
	const mode = forcedMode();
	if (mode === 'fr') {
		return 'fr';
	}
	if (mode === 'en') {
		return 'en';
	}
	return vscode.env.language || 'en';
}
