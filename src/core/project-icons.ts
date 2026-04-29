import * as vscode from 'vscode';

import { uiT } from './ui-locale';

/** Codicons proposés pour les projets (id, libellé anglais = clé l10n) */
export const PROJECT_ICONS: { id: string; label: string }[] = [
	{ id: '', label: 'None' },
	{ id: 'folder', label: 'Folder' },
	{ id: 'folder-opened', label: 'Open folder' },
	{ id: 'project', label: 'Project' },
	{ id: 'file', label: 'File' },
	{ id: 'file-code', label: 'Code' },
	{ id: 'repo', label: 'Repository' },
	{ id: 'remote-explorer', label: 'Remote' },
	{ id: 'book', label: 'Book' },
	{ id: 'package', label: 'Package' },
	{ id: 'globe', label: 'Globe' },
	{ id: 'home', label: 'Home' },
	{ id: 'star-full', label: 'Star' },
	{ id: 'heart', label: 'Heart' },
	{ id: 'briefcase', label: 'Briefcase' },
	{ id: 'device-desktop', label: 'Computer' },
	{ id: 'code', label: 'Code' },
	{ id: 'terminal', label: 'Terminal' },
	{ id: 'database', label: 'Database' },
	{ id: 'server', label: 'Server' },
];

const PNG_PICK_ID = '__png__';

export type ProjectIconPick = { icon: string; iconPngPath: string };

export async function pickProjectIcon(currentId: string = '', currentPngPath: string = ''): Promise<ProjectIconPick> {
	const items = [
		...PROJECT_ICONS.map(({ id, label }) => ({
			label: uiT(label),
			description: id || undefined,
			iconPath: id ? new vscode.ThemeIcon(id) : undefined,
			id,
		})),
		{
			label: uiT('PNG file...'),
			description: currentPngPath || undefined,
			iconPath: new vscode.ThemeIcon('file-media'),
			id: PNG_PICK_ID,
		},
	];
	const pick = await vscode.window.showQuickPick(items, {
		title: uiT('Project icon'),
		placeHolder: uiT('Pick an icon or PNG file (optional)'),
		matchOnDescription: true,
	});
	if (!pick) return { icon: currentId, iconPngPath: currentPngPath };
	if (pick.id === PNG_PICK_ID) {
		const uris = await vscode.window.showOpenDialog({
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: false,
			filters: { [uiT('PNG images')]: ['png'] },
		});
		if (uris && uris.length > 0) return { icon: '', iconPngPath: uris[0].fsPath };
		return { icon: currentId, iconPngPath: currentPngPath };
	}
	return { icon: pick.id, iconPngPath: '' };
}
