import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { listVercelEnvVars, upsertVercelEnvVars, VercelEnvTarget, VercelEnvVar } from './vercel-api';
import { uiT } from './ui-locale';

export type VercelEnvSyncScope = 'all_targets' | 'development_only';

type EnvMap = Map<string, string>;

type EnvFileSpec = {
	target: VercelEnvTarget;
	fileName: string;
};

export type VercelEnvSyncResult = {
	localAdded: number;
	vercelAdded: number;
	conflictsResolved: number;
};

const ENV_FILES: EnvFileSpec[] = [
	{ target: 'development', fileName: '.env.local' },
	{ target: 'preview', fileName: '.env.vercel.preview' },
	{ target: 'production', fileName: '.env.vercel.production' },
];

const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/;

function specsForScope(scope: VercelEnvSyncScope): EnvFileSpec[] {
	return scope === 'development_only'
		? ENV_FILES.filter((f) => f.target === 'development')
		: ENV_FILES;
}

function decodeEnvValue(raw: string): string {
	const value = raw.trim();
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}
	return value;
}

function encodeEnvValue(value: string): string {
	if (/[\s#"'\\]/.test(value)) {
		return JSON.stringify(value);
	}
	return value;
}

function readEnvFile(filePath: string): EnvMap {
	const map: EnvMap = new Map();
	if (!fs.existsSync(filePath)) {
		return map;
	}
	const raw = fs.readFileSync(filePath, 'utf8');
	for (const line of raw.split(/\r?\n/)) {
		const m = line.match(ENV_LINE);
		if (!m) {
			continue;
		}
		map.set(m[1], decodeEnvValue(m[2]));
	}
	return map;
}

function writeEnvFile(filePath: string, values: EnvMap): void {
	const seen = new Set<string>();
	const out: string[] = [];
	const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8').split(/\r?\n/) : [];
	const dir = path.dirname(filePath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	for (const line of existing) {
		const m = line.match(ENV_LINE);
		if (!m) {
			if (line.length > 0) {
				out.push(line);
			}
			continue;
		}
		const key = m[1];
		if (values.has(key)) {
			out.push(`${key}=${encodeEnvValue(values.get(key) ?? '')}`);
			seen.add(key);
		}
	}

	for (const key of Array.from(values.keys()).sort((a, b) => a.localeCompare(b))) {
		if (!seen.has(key)) {
			out.push(`${key}=${encodeEnvValue(values.get(key) ?? '')}`);
		}
	}

	fs.writeFileSync(filePath, `${out.join('\n')}\n`, 'utf8');
}

function targetsOf(env: VercelEnvVar): VercelEnvTarget[] {
	const raw = env.target;
	if (Array.isArray(raw)) {
		return raw;
	}
	if (raw === 'production' || raw === 'preview' || raw === 'development') {
		return [raw];
	}
	return [];
}

function vercelMapForTarget(envs: VercelEnvVar[], target: VercelEnvTarget): EnvMap {
	const map: EnvMap = new Map();
	for (const env of envs) {
		if (!env.key || typeof env.value !== 'string') {
			continue;
		}
		if (targetsOf(env).includes(target)) {
			map.set(env.key, env.value);
		}
	}
	return map;
}

async function resolveConflict(key: string, target: VercelEnvTarget, fileName: string): Promise<'local' | 'vercel'> {
	const keepVercel = uiT('Keep Vercel value');
	const keepLocal = uiT('Keep local value');
	const cancel = uiT('Cancel sync');
	const pick = await vscode.window.showQuickPick([keepVercel, keepLocal, cancel], {
		title: uiT('Environment variable conflict'),
		placeHolder: uiT('{0} differs between Vercel {1} and {2}', key, target, fileName),
		ignoreFocusOut: true,
	});
	if (!pick || pick === cancel) {
		throw new Error(uiT('Environment sync cancelled.'));
	}
	return pick === keepLocal ? 'local' : 'vercel';
}

async function confirmSensitiveSync(scope: VercelEnvSyncScope): Promise<void> {
	if (scope !== 'all_targets') {
		return;
	}
	const proceed = uiT('Synchronize all targets');
	const picked = await vscode.window.showWarningMessage(
		uiT('This will write Production, Preview, and Development environment variables to local files.'),
		{ modal: true },
		proceed
	);
	if (picked !== proceed) {
		throw new Error(uiT('Environment sync cancelled.'));
	}
}

export function writeLocalNeonEnv(cwd: string, values: Record<string, string>, scope: VercelEnvSyncScope): void {
	const defaultEnvPath = path.join(cwd, '.env');
	const defaultEnv = readEnvFile(defaultEnvPath);
	for (const [key, value] of Object.entries(values)) {
		if (value) {
			defaultEnv.set(key, value);
		}
	}
	writeEnvFile(defaultEnvPath, defaultEnv);

	for (const spec of specsForScope(scope)) {
		const filePath = path.join(cwd, spec.fileName);
		const current = readEnvFile(filePath);
		for (const [key, value] of Object.entries(values)) {
			if (value) {
				current.set(key, value);
			}
		}
		writeEnvFile(filePath, current);
	}
}

export async function syncVercelEnvWithLocal(input: {
	token: string;
	projectName: string;
	teamSlugOrId?: string;
	cwd: string;
	scope: VercelEnvSyncScope;
	confirmAllTargets?: boolean;
}): Promise<VercelEnvSyncResult> {
	const scope = input.scope || 'all_targets';
	if (input.confirmAllTargets !== false) {
		await confirmSensitiveSync(scope);
	}

	const result: VercelEnvSyncResult = {
		localAdded: 0,
		vercelAdded: 0,
		conflictsResolved: 0,
	};
	const remote = await listVercelEnvVars(input.token, input.projectName, input.teamSlugOrId);
	const toUpsert: Array<{ key: string; value: string; target: VercelEnvTarget[] }> = [];

	for (const spec of specsForScope(scope)) {
		const filePath = path.join(input.cwd, spec.fileName);
		const local = readEnvFile(filePath);
		const vercel = vercelMapForTarget(remote, spec.target);
		const merged: EnvMap = new Map(local);
		const keys = new Set([...local.keys(), ...vercel.keys()]);

		for (const key of keys) {
			const localHas = local.has(key);
			const vercelHas = vercel.has(key);
			const localVal = local.get(key) ?? '';
			const vercelVal = vercel.get(key) ?? '';

			if (vercelHas && !localHas) {
				merged.set(key, vercelVal);
				result.localAdded += 1;
			} else if (localHas && !vercelHas) {
				toUpsert.push({ key, value: localVal, target: [spec.target] });
				result.vercelAdded += 1;
			} else if (localHas && vercelHas && localVal !== vercelVal) {
				const source = await resolveConflict(key, spec.target, spec.fileName);
				result.conflictsResolved += 1;
				if (source === 'vercel') {
					merged.set(key, vercelVal);
				} else {
					toUpsert.push({ key, value: localVal, target: [spec.target] });
				}
			}
		}

		writeEnvFile(filePath, merged);
	}

	await upsertVercelEnvVars(input.token, input.projectName, input.teamSlugOrId, toUpsert);
	return result;
}
