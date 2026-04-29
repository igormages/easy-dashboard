#!/usr/bin/env node
/**
 * Génère bundle.l10n.<locale>.json via translate.googleapis.com (client=gtx).
 * Locales : pour l’instant uniquement le français ; ajoutez d’autres paires pour étendre.
 *
 * Usage:
 *   node l10n/generate-from-gtx.mjs        → toutes les cibles ci-dessous
 *   node l10n/generate-from-gtx.mjs fr     → uniquement fr
 */
import fs from 'fs';
import { setTimeout as delay } from 'timers/promises';

const enPath = new URL('./bundle.l10n.json', import.meta.url);
const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
const keys = Object.keys(en);

/** [vscode locale, code langue Google] — anglais = bundle.l10n.json par défaut */
const TARGETS = [['fr', 'fr']];

const only = process.argv[2];
const targets = only ? TARGETS.filter(([loc]) => loc === only) : TARGETS;
if (targets.length === 0) {
	console.error('Locale inconnue:', only, '— cibles:', TARGETS.map((t) => t[0]).join(', '));
	process.exit(1);
}

async function translateText(text, tl) {
	const q = encodeURIComponent(text);
	const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${tl}&dt=t&q=${q}`;
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`${res.status} ${url}`);
	}
	const data = await res.json();
	return data[0].map((x) => x[0]).join('');
}

for (const [vscodeLocale, gtxTl] of targets) {
	const out = {};
	let i = 0;
	for (const k of keys) {
		process.stderr.write(`\r${vscodeLocale} ${i + 1}/${keys.length}   `);
		try {
			out[k] = await translateText(k, gtxTl);
		} catch (e) {
			console.error(`\nÉchec clé: ${k.slice(0, 60)}`, e);
			out[k] = k;
		}
		await delay(120);
		i++;
	}
	const dest = new URL(`./bundle.l10n.${vscodeLocale}.json`, import.meta.url);
	fs.writeFileSync(dest, JSON.stringify(out, null, '\t') + '\n');
	console.error(`\nÉcrit ${dest.pathname}`);
}
