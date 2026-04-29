/**
 * Appels API Cloudflare (zones DNS) pour lister les domaines et créer des enregistrements.
 * Les jetons ne sont jamais journalisés.
 */

import * as https from 'https';
import { uiT } from './ui-locale';

const CF_API = 'api.cloudflare.com';
const HTTP_TIMEOUT_MS = 30000;

export type CloudflareZone = { id: string; name: string };

type CfApiResult<T> = { success: boolean; result?: T; errors?: Array<{ code: number; message: string }> };

function cfRequest<T>(
	token: string,
	method: string,
	pathWithQuery: string,
	body?: object
): Promise<CfApiResult<T>> {
	return new Promise((resolve, reject) => {
		const payload = body ? Buffer.from(JSON.stringify(body), 'utf8') : undefined;
		const req = https.request(
			{
				hostname: CF_API,
				path: pathWithQuery,
				method,
				headers: {
					Authorization: `Bearer ${token}`,
					'Content-Type': 'application/json',
					...(payload ? { 'Content-Length': String(payload.length) } : {}),
				},
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
				res.on('end', () => {
					const raw = Buffer.concat(chunks).toString('utf8');
					let parsed: CfApiResult<T>;
					try {
						parsed = JSON.parse(raw) as CfApiResult<T>;
					} catch {
						reject(new Error(`Cloudflare API: invalid JSON (${res.statusCode})`));
						return;
					}
					if (res.statusCode && res.statusCode >= 400) {
						const msg =
							parsed.errors?.map((e) => e.message).join('; ') ||
							`HTTP ${res.statusCode}`;
						reject(new Error(msg));
						return;
					}
					resolve(parsed);
				});
			}
		);
		req.setTimeout(HTTP_TIMEOUT_MS, () => {
			req.destroy(new Error(uiT('Cloudflare API request timed out.')));
		});
		req.on('error', reject);
		if (payload) {
			req.write(payload);
		}
		req.end();
	});
}

/** Liste les zones (domaines) accessibles au jeton. */
export async function listCloudflareZones(token: string): Promise<CloudflareZone[]> {
	const out: CloudflareZone[] = [];
	let page = 1;
	const perPage = 50;
	for (;;) {
		const path = `/client/v4/zones?per_page=${perPage}&page=${page}`;
		const res = await cfRequest<Array<{ id: string; name: string; status: string }>>(
			token,
			'GET',
			path
		);
		if (!res.success || !Array.isArray(res.result)) {
			const err = res.errors?.map((e) => e.message).join('; ') || 'Unknown error';
			throw new Error(err);
		}
		for (const z of res.result) {
			if (z.status === 'active' || z.status === 'pending') {
				out.push({ id: z.id, name: z.name });
			}
		}
		if (res.result.length < perPage) {
			break;
		}
		page += 1;
		if (page > 200) {
			break;
		}
	}
	out.sort((a, b) => a.name.localeCompare(b.name));
	return out;
}

/** Crée un CNAME vers Vercel sans proxy Cloudflare (requis pour Vercel). */
export async function createCloudflareCnameToVercel(
	token: string,
	zoneId: string,
	recordName: string,
	content: string = 'cname.vercel-dns.com'
): Promise<{ id: string }> {
	const res = await cfRequest<{ id: string }>(token, 'POST', `/client/v4/zones/${zoneId}/dns_records`, {
		type: 'CNAME',
		name: recordName,
		content,
		ttl: 3600,
		proxied: false,
	});
	if (!res.success || !res.result) {
		const err = res.errors?.map((e) => e.message).join('; ') || 'Unknown error';
		throw new Error(err);
	}
	return { id: res.result.id };
}
