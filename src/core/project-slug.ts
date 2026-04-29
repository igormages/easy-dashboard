/** URL-safe folder/repo slug from a display name (accents → ASCII). E.g. "c'est Très Bien" → "c-est-tres-bien". */
export function slugifyFromDisplayName(raw: string): string {
	const base = raw
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/æ/g, 'ae')
		.replace(/œ/g, 'oe')
		.replace(/ß/g, 'ss')
		.replace(/ø/g, 'o')
		.replace(/đ/g, 'd')
		.replace(/ł/g, 'l');
	return base
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}
