import * as vscode from 'vscode';

/** Codicons proposés pour les projets (id, libellé) */
export const PROJECT_ICONS: { id: string; label: string }[] = [
	{ id: '', label: 'Aucune' },
	{ id: 'folder', label: 'Dossier' },
	{ id: 'folder-opened', label: 'Dossier ouvert' },
	{ id: 'project', label: 'Projet' },
	{ id: 'file', label: 'Fichier' },
	{ id: 'file-code', label: 'Code' },
	{ id: 'repo', label: 'Dépôt' },
	{ id: 'remote-explorer', label: 'Distant' },
	{ id: 'book', label: 'Livre' },
	{ id: 'package', label: 'Package' },
	{ id: 'globe', label: 'Globe' },
	{ id: 'home', label: 'Accueil' },
	{ id: 'star-full', label: 'Étoile' },
	{ id: 'heart', label: 'Cœur' },
	{ id: 'briefcase', label: 'Mallette' },
	{ id: 'device-desktop', label: 'Ordinateur' },
	{ id: 'code', label: 'Code' },
	{ id: 'terminal', label: 'Terminal' },
	{ id: 'database', label: 'Base de données' },
	{ id: 'server', label: 'Serveur' },
];

export async function pickProjectIcon(currentId: string = ''): Promise<string> {
	const pick = await vscode.window.showQuickPick(
		PROJECT_ICONS.map(({ id, label }) => ({
			label: label,
			description: id || undefined,
			iconPath: id ? new vscode.ThemeIcon(id) : undefined,
			id,
		})),
		{
			title: 'Icône du projet',
			placeHolder: 'Choisir une icône (optionnel)',
			matchOnDescription: true,
		}
	);
	return pick?.id ?? currentId;
}
