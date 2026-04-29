import * as https from 'https';
import { uiT } from './ui-locale';

const NEON_API = 'console.neon.tech';
const MAX_OPERATION_POLLS = 30;
const OPERATION_POLL_MS = 2000;
const HTTP_TIMEOUT_MS = 30000;

export type NeonProjectSummary = {
	id: string;
	name: string;
	regionId?: string;
};

export type NeonConnectionInfo = {
	projectId: string;
	projectName: string;
	databaseUrl: string;
	databaseUrlUnpooled?: string;
};

type NeonProject = {
	id?: string;
	name?: string;
	region_id?: string;
	connection_uri?: string;
	connection_uris?: Array<{ connection_uri?: string; type?: string }>;
};

type NeonOperation = {
	id?: string;
	status?: string;
};

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function neonRequest<T>(token: string, method: 'GET' | 'POST', pathWithQuery: string, body?: unknown): Promise<T> {
	return new Promise((resolve, reject) => {
		const rawBody = typeof body === 'undefined' ? undefined : JSON.stringify(body);
		const req = https.request(
			{
				hostname: NEON_API,
				path: `/api/v2${pathWithQuery}`,
				method,
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: 'application/json',
					'Content-Type': 'application/json',
					...(rawBody ? { 'Content-Length': Buffer.byteLength(rawBody) } : {}),
				},
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
				res.on('end', () => {
					const raw = Buffer.concat(chunks).toString('utf8');
					let parsed: unknown = {};
					if (raw.trim()) {
						try {
							parsed = JSON.parse(raw);
						} catch {
							reject(new Error(`Neon API: invalid JSON (${res.statusCode ?? '?'})`));
							return;
						}
					}
					if (res.statusCode && res.statusCode >= 400) {
						const errObj = parsed as { message?: string; error?: string; errors?: Array<{ message?: string }> };
						reject(new Error(errObj.message || errObj.error || errObj.errors?.[0]?.message || `HTTP ${res.statusCode}`));
						return;
					}
					resolve(parsed as T);
				});
			}
		);
		req.setTimeout(HTTP_TIMEOUT_MS, () => {
			req.destroy(new Error(uiT('Neon API request timed out.')));
		});
		req.on('error', reject);
		if (rawBody) {
			req.write(rawBody);
		}
		req.end();
	});
}

function applyOrgScope(params: URLSearchParams, neonOrgId: string | undefined): void {
	const org = (neonOrgId || '').trim();
	if (org) {
		params.set('org_id', org);
	}
}

function extractProject(input: unknown): NeonProject | null {
	const o = input as { project?: NeonProject; projects?: NeonProject[] };
	return o.project ?? o.projects?.[0] ?? null;
}

function extractConnectionUri(input: unknown): string {
	const o = input as {
		connection_uri?: string;
		connection_uris?: Array<{ connection_uri?: string; type?: string }>;
		project?: NeonProject;
	};
	const direct =
		o.connection_uri ||
		o.project?.connection_uri ||
		o.connection_uris?.find((v) => v.type !== 'pooled')?.connection_uri ||
		o.project?.connection_uris?.find((v) => v.type !== 'pooled')?.connection_uri ||
		o.connection_uris?.[0]?.connection_uri ||
		o.project?.connection_uris?.[0]?.connection_uri ||
		'';
	return direct;
}

function extractPooledConnectionUri(input: unknown): string {
	const o = input as {
		connection_uris?: Array<{ connection_uri?: string; type?: string }>;
		project?: NeonProject;
	};
	return (
		o.connection_uris?.find((v) => v.type === 'pooled')?.connection_uri ||
		o.project?.connection_uris?.find((v) => v.type === 'pooled')?.connection_uri ||
		''
	);
}

async function waitForOperations(token: string, projectId: string, operations: NeonOperation[] | undefined): Promise<void> {
	const ids = (operations ?? []).map((op) => op.id).filter((id): id is string => !!id);
	if (ids.length === 0) {
		return;
	}
	for (let i = 0; i < MAX_OPERATION_POLLS; i++) {
		const states = await Promise.all(ids.map((id) =>
			neonRequest<{ operation?: NeonOperation }>(token, 'GET', `/projects/${encodeURIComponent(projectId)}/operations/${encodeURIComponent(id)}`)
				.then((res) => res.operation?.status ?? 'finished')
		));
		const failed = states.find((s) => s === 'failed' || s === 'error');
		if (failed) {
			throw new Error(uiT('Neon operation failed: {0}', failed));
		}
		if (states.every((s) => s === 'finished')) {
			return;
		}
		await delay(OPERATION_POLL_MS);
	}
	throw new Error(uiT('Neon operation did not finish in time.'));
}

export async function listNeonProjects(token: string, neonOrgId: string | undefined): Promise<NeonProjectSummary[]> {
	const params = new URLSearchParams();
	applyOrgScope(params, neonOrgId);
	const qs = params.toString();
	const data = await neonRequest<{ projects?: NeonProject[] }>(token, 'GET', `/projects${qs ? `?${qs}` : ''}`);
	return (data.projects ?? [])
		.filter((p) => typeof p.id === 'string' && typeof p.name === 'string')
		.map((p) => ({ id: p.id!, name: p.name!, regionId: p.region_id }))
		.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export async function createNeonProject(
	token: string,
	name: string,
	neonOrgId: string | undefined,
	regionId?: string
): Promise<NeonConnectionInfo> {
	const body = {
		project: {
			name,
			...(regionId ? { region_id: regionId } : {}),
			...(neonOrgId ? { org_id: neonOrgId } : {}),
		},
	};
	const created = await neonRequest<{ project?: NeonProject; operations?: NeonOperation[] }>(token, 'POST', '/projects', body);
	const project = extractProject(created);
	if (!project?.id || !project.name) {
		throw new Error(uiT('Neon project was created but the response did not include a project id.'));
	}
	await waitForOperations(token, project.id, created.operations);
	return getNeonProjectConnection(token, project.id);
}

export async function getNeonProjectConnection(token: string, projectId: string): Promise<NeonConnectionInfo> {
	const params = new URLSearchParams();
	params.set('project_id', projectId);
	const pooledParams = new URLSearchParams(params);
	pooledParams.set('pooled', 'true');
	const data = await neonRequest<unknown>(token, 'GET', `/connection_uri?${params.toString()}`);
	let projectName = '';
	const directUrl = extractConnectionUri(data);
	let databaseUrl = directUrl;
	let databaseUrlUnpooled = directUrl;

	try {
		const pooled = await neonRequest<unknown>(token, 'GET', `/connection_uri?${pooledParams.toString()}`);
		databaseUrl = extractConnectionUri(pooled) || directUrl;
	} catch {
		databaseUrl = extractPooledConnectionUri(data) || directUrl;
	}

	if (!databaseUrl) {
		const projectData = await neonRequest<unknown>(token, 'GET', `/projects/${encodeURIComponent(projectId)}`);
		const project = extractProject(projectData);
		projectName = project?.name ?? '';
		databaseUrlUnpooled = extractConnectionUri(projectData);
		databaseUrl = extractPooledConnectionUri(projectData) || databaseUrlUnpooled;
	}

	if (!databaseUrl) {
		throw new Error(uiT('Neon did not return a connection string for this project.'));
	}

	return {
		projectId,
		projectName,
		databaseUrl,
		...(databaseUrlUnpooled && databaseUrlUnpooled !== databaseUrl ? { databaseUrlUnpooled } : {}),
	};
}
