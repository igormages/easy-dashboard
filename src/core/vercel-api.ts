/**
 * Appels API Vercel (liste de projets) pour la liaison `vercel link --project`.
 * Le jeton n’est jamais journalisé.
 */

import * as https from 'https';
import { uiT } from './ui-locale';

const VERCEL_API = 'api.vercel.com';
const MAX_PAGES = 20;
const PAGE_SIZE = 100;
const HTTP_TIMEOUT_MS = 30000;

type ListProjectsResponse = {
	projects?: Array<{ name?: string }>;
	pagination?: {
		next?: string | number | null;
	};
};

export type VercelEnvTarget = 'production' | 'preview' | 'development';

export type VercelEnvVar = {
	id?: string;
	key: string;
	value: string;
	target?: VercelEnvTarget | VercelEnvTarget[];
	type?: string;
};

type ListEnvResponse = {
	envs?: VercelEnvVar[];
	pagination?: {
		next?: string | number | null;
	};
};

type VercelEnvInput = {
	key: string;
	value: string;
	target: VercelEnvTarget[];
	type?: 'plain' | 'encrypted' | 'sensitive';
	comment?: string;
};

function vercelRequest<T>(token: string, method: 'GET' | 'POST', pathWithQuery: string, body?: unknown): Promise<T> {
	return new Promise((resolve, reject) => {
		const rawBody = typeof body === 'undefined' ? undefined : JSON.stringify(body);
		const req = https.request(
			{
				hostname: VERCEL_API,
				path: pathWithQuery,
				method,
				headers: {
					Authorization: `Bearer ${token}`,
					'Content-Type': 'application/json',
					...(rawBody ? { 'Content-Length': Buffer.byteLength(rawBody) } : {}),
				},
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
				res.on('end', () => {
					const raw = Buffer.concat(chunks).toString('utf8');
					let parsed: unknown;
					try {
						parsed = JSON.parse(raw);
					} catch {
						reject(new Error(`Vercel API: invalid JSON (${res.statusCode ?? '?'})`));
						return;
					}
					if (res.statusCode && res.statusCode >= 400) {
						const errObj = parsed as { error?: { message?: string }; message?: string };
						const msg =
							errObj?.error?.message ||
							(typeof errObj?.message === 'string' ? errObj.message : undefined) ||
							`HTTP ${res.statusCode}`;
						reject(new Error(msg));
						return;
					}
					resolve(parsed as T);
				});
			}
		);
		req.setTimeout(HTTP_TIMEOUT_MS, () => {
			req.destroy(new Error(uiT('Vercel API request timed out.')));
		});
		req.on('error', reject);
		if (rawBody) {
			req.write(rawBody);
		}
		req.end();
	});
}

function vercelGet<T>(token: string, pathWithQuery: string): Promise<T> {
	return vercelRequest<T>(token, 'GET', pathWithQuery);
}

function vercelPost<T>(token: string, pathWithQuery: string, body: unknown): Promise<T> {
	return vercelRequest<T>(token, 'POST', pathWithQuery, body);
}

function applyTeamScope(params: URLSearchParams, teamSlugOrId: string | undefined): void {
	const t = (teamSlugOrId || '').trim();
	if (!t) {
		return;
	}
	if (t.startsWith('team_')) {
		params.set('teamId', t);
	} else {
		params.set('slug', t);
	}
}

export function applyVercelTeamScope(params: URLSearchParams, teamSlugOrId: string | undefined): void {
	applyTeamScope(params, teamSlugOrId);
}

/** Noms de projets du compte (ou de l’équipe indiquée dans les paramètres). */
export async function listVercelProjectNames(
	token: string,
	vercelTeamSlugOrId: string | undefined
): Promise<string[]> {
	const names = new Set<string>();
	let from: string | undefined;
	let pages = 0;

	while (pages < MAX_PAGES) {
		const params = new URLSearchParams();
		params.set('limit', String(PAGE_SIZE));
		applyTeamScope(params, vercelTeamSlugOrId);
		if (from) {
			params.set('from', from);
		}

		const data = await vercelGet<ListProjectsResponse>(token, `/v10/projects?${params.toString()}`);
		const batch = data.projects ?? [];
		for (const p of batch) {
			if (typeof p.name === 'string' && p.name.length > 0) {
				names.add(p.name);
			}
		}
		pages += 1;
		const next = data.pagination?.next;
		if (next === undefined || next === null || batch.length === 0) {
			break;
		}
		from = typeof next === 'number' ? String(next) : next;
	}

	return Array.from(names).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/** Variables d’environnement Vercel déchiffrées pour un projet. */
export async function listVercelEnvVars(
	token: string,
	projectNameOrId: string,
	vercelTeamSlugOrId: string | undefined
): Promise<VercelEnvVar[]> {
	const envs: VercelEnvVar[] = [];
	let from: string | undefined;
	let pages = 0;

	while (pages < MAX_PAGES) {
		const params = new URLSearchParams();
		params.set('decrypt', 'true');
		applyTeamScope(params, vercelTeamSlugOrId);
		if (from) {
			params.set('from', from);
		}
		const data = await vercelGet<ListEnvResponse>(
			token,
			`/v10/projects/${encodeURIComponent(projectNameOrId)}/env?${params.toString()}`
		);
		envs.push(...(data.envs ?? []));
		pages += 1;
		const next = data.pagination?.next;
		if (next === undefined || next === null || (data.envs ?? []).length === 0) {
			break;
		}
		from = typeof next === 'number' ? String(next) : next;
	}

	return envs.filter((env) => typeof env.key === 'string' && typeof env.value === 'string');
}

/** Crée ou met à jour une ou plusieurs variables Vercel. */
export async function upsertVercelEnvVars(
	token: string,
	projectNameOrId: string,
	vercelTeamSlugOrId: string | undefined,
	vars: VercelEnvInput[]
): Promise<void> {
	if (vars.length === 0) {
		return;
	}
	const params = new URLSearchParams();
	params.set('upsert', 'true');
	applyTeamScope(params, vercelTeamSlugOrId);
	const body = vars.map((v) => ({
		key: v.key,
		value: v.value,
		type: v.type ?? 'encrypted',
		target: v.target,
		...(v.comment ? { comment: v.comment } : {}),
	}));
	await vercelPost<unknown>(
		token,
		`/v10/projects/${encodeURIComponent(projectNameOrId)}/env?${params.toString()}`,
		body
	);
}
