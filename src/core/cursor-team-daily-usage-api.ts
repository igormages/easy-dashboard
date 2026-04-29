/**
 * API Cursor Admin — POST /teams/daily-usage-data (lignes ajoutées / supprimées par utilisateur et par jour).
 * Pour les agrégations sur plusieurs jours, préférer une requête par jour calendaire (plutôt qu’une seule
 * plage « 14 jours »), sur les 14 derniers jours locaux — aligné avec le graphique d’activité.
 */

import * as https from 'https';
import { uiT } from './ui-locale';

const CURSOR_API = 'api.cursor.com';
const DAILY_USAGE_PATH = '/teams/daily-usage-data';
const MAX_PAGES_PER_DAY = 100;
const HTTP_TIMEOUT_MS = 30000;

export type CursorDailyUsageRow = {
	userId: number;
	day: string;
	date: number;
	email?: string;
	isActive?: boolean;
	totalLinesAdded?: number;
	totalLinesDeleted?: number;
};

type CursorDailyUsageApiResponse = {
	data?: CursorDailyUsageRow[];
	pagination?: {
		page?: number;
		pageSize?: number;
		hasNextPage?: boolean;
	};
};

function basicAuthHeader(apiKey: string): string {
	const key = apiKey.trim();
	return `Basic ${Buffer.from(`${key}:`, 'utf8').toString('base64')}`;
}

function cursorPost<T>(apiKey: string, path: string, body: object): Promise<T> {
	const payload = JSON.stringify(body);
	return new Promise((resolve, reject) => {
		const req = https.request(
			{
				hostname: CURSOR_API,
				path,
				method: 'POST',
				headers: {
					Authorization: basicAuthHeader(apiKey),
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(payload, 'utf8'),
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
						reject(new Error(`Cursor API: invalid JSON (${res.statusCode ?? '?'})`));
						return;
					}
					if (res.statusCode && res.statusCode >= 400) {
						const errObj = parsed as { message?: string; error?: string };
						const msg =
							(typeof errObj?.message === 'string' ? errObj.message : undefined) ||
							(typeof errObj?.error === 'string' ? errObj.error : undefined) ||
							`HTTP ${res.statusCode}`;
						reject(new Error(msg));
						return;
					}
					resolve(parsed as T);
				});
			}
		);
		req.setTimeout(HTTP_TIMEOUT_MS, () => {
			req.destroy(new Error(uiT('Cursor API request timed out.')));
		});
		req.on('error', reject);
		req.write(payload);
		req.end();
	});
}

/** Identique au graphique « par jour » : les n derniers jours calendaires locaux se terminant aujourd’hui. */
export function localCalendarDayKeysFromEnd(periodEndMs: number, n: number): string[] {
	const end = new Date(periodEndMs);
	const keys: string[] = [];
	for (let i = n - 1; i >= 0; i--) {
		const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i);
		keys.push(
			`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
		);
	}
	return keys;
}

function localCalendarDayBoundsMs(ymd: string): { startMs: number; endMs: number } {
	const [y, mo, d] = ymd.split('-').map(Number);
	const startMs = new Date(y, mo - 1, d, 0, 0, 0, 0).getTime();
	const endMs = new Date(y, mo - 1, d, 23, 59, 59, 999).getTime();
	return { startMs, endMs };
}

async function fetchDailyUsageAllPagesForRange(
	apiKey: string,
	startMs: number,
	endMs: number,
	pageSize: number
): Promise<CursorDailyUsageRow[]> {
	const out: CursorDailyUsageRow[] = [];
	let page = 1;
	for (let p = 0; p < MAX_PAGES_PER_DAY; p++) {
		const res = await cursorPost<CursorDailyUsageApiResponse>(apiKey, DAILY_USAGE_PATH, {
			startDate: startMs,
			endDate: endMs,
			page,
			pageSize,
		});
		const batch = res.data ?? [];
		out.push(...batch);
		const pag = res.pagination;
		if (!pag?.hasNextPage || batch.length === 0) {
			break;
		}
		page += 1;
	}
	return out;
}

/**
 * Une requête POST par jour calendaire local : agrège sur toute l’équipe (somme des utilisateurs) les
 * lignes ajoutées et supprimées. `pageSize` doit être fourni avec pagination (équipe complète).
 */
export async function fetchTeamLinesModifiedByLocalDayLastNDays(
	apiKey: string,
	numDays: number,
	options?: { pageSizeForTeamMembers?: number }
): Promise<Array<{ date: string; added: number; removed: number }>> {
	const pageSize = options?.pageSizeForTeamMembers;
	const dayKeys = localCalendarDayKeysFromEnd(Date.now(), numDays);
	const results: Array<{ date: string; added: number; removed: number }> = [];

	for (const ymd of dayKeys) {
		const { startMs, endMs } = localCalendarDayBoundsMs(ymd);
		let rows: CursorDailyUsageRow[];
		if (pageSize && pageSize > 0) {
			rows = await fetchDailyUsageAllPagesForRange(apiKey, startMs, endMs, pageSize);
		} else {
			const res = await cursorPost<CursorDailyUsageApiResponse>(apiKey, DAILY_USAGE_PATH, {
				startDate: startMs,
				endDate: endMs,
			});
			rows = res.data ?? [];
		}
		let added = 0;
		let removed = 0;
		for (const r of rows) {
			added += r.totalLinesAdded ?? 0;
			removed += r.totalLinesDeleted ?? 0;
		}
		results.push({ date: ymd, added, removed });
	}

	return results;
}
