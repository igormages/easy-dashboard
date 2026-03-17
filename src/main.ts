import * as vscode from 'vscode';

import Util from './core/util';
import Dashboard from './core/dashboard';
import Sidebar from './core/sidebar';
import ProjectEntry from './core/project-entry';
import ProjectFolder from './core/project-folder';
import { pickProjectIcon } from './core/project-icons';
import { isRecentEntryWrapper } from './core/dashboard-tree-provider';

export function activate(context: vscode.ExtensionContext) {
	Util.println('Activating Easy Dashboard');

	const dashboard = new Dashboard(context);
	const sidebar = new Sidebar(dashboard);

	context.subscriptions.push(
		vscode.commands.registerCommand('easy-dashboard.openProject', (projectId: string) => {
			dashboard.openProject(projectId, dashboard.conf.openInNewWindow);
			sidebar.getTreeProvider().refresh();
		})
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (!e.affectsConfiguration('easy-dashboard')) return;
			dashboard.conf.reloadDatabase();
			sidebar.getTreeProvider().refresh();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('easy-dashboard.addFolder', async () => {
			const selection = sidebar.getSelection();
			const parentId = (selection.length === 1 && selection[0] instanceof ProjectFolder)
				? selection[0].id
				: null;
			const name = await vscode.window.showInputBox({
				prompt: parentId ? "Nom du sous-dossier" : "Nom du dossier",
				title: "Easy Dashboard - Nouveau dossier"
			});
			if (name) {
				dashboard.conf.addFolder(name, parentId);
				sidebar.getTreeProvider().refresh();
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('easy-dashboard.addProject', async () => {
			const selection = sidebar.getSelection();
			const parentId = (selection.length === 1 && selection[0] instanceof ProjectFolder)
				? selection[0].id
				: null;

			const selected = await vscode.window.showOpenDialog({
				canSelectFiles: false,
				canSelectFolders: true,
				canSelectMany: false
			});
			if (!selected || selected.length === 0) return;

			const path = Util.fixDriveLetters(selected[0].fsPath);
			const name = path.split(/[/\\]/).filter(Boolean).pop() || selected[0].fsPath;

			const description = await vscode.window.showInputBox({
				title: 'Easy Dashboard - Nouveau projet',
				prompt: 'Description (optionnel)',
				value: '',
			});
			const descriptionVal = typeof description === 'string' ? description.trim() : '';

			const icon = await pickProjectIcon('');

			dashboard.conf.addProject(name, path, parentId, descriptionVal || undefined, icon || undefined);
			sidebar.getTreeProvider().refresh();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('easy-dashboard.editProject', async (node?: ProjectEntry | import('./core/dashboard-tree-provider').RecentEntryWrapper) => {
			const raw = (node && (node instanceof ProjectEntry || isRecentEntryWrapper(node))) ? node : sidebar.getSelection()[0];
			const entry = raw && isRecentEntryWrapper(raw) ? raw.entry : (raw instanceof ProjectEntry ? raw : null);
			if (!entry) return;

			const description = await vscode.window.showInputBox({
				title: 'Easy Dashboard - Modifier le projet',
				prompt: 'Description',
				value: entry.description || '',
			});
			const descriptionVal = typeof description === 'string' ? description.trim() : entry.description;

			const icon = await pickProjectIcon(entry.icon);

			dashboard.conf.updateProject(entry.id, { description: descriptionVal, icon: icon || '' });
			sidebar.getTreeProvider().refresh();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('easy-dashboard.removeEntry', async (node?: ProjectFolder | ProjectEntry | import('./core/dashboard-tree-provider').RecentEntryWrapper) => {
			const raw = (node && typeof node === 'object') ? node : sidebar.getSelection()[0];
			const item = raw && isRecentEntryWrapper(raw) ? raw.entry : (raw && typeof raw === 'object' && raw !== null && 'id' in raw ? raw as ProjectFolder | ProjectEntry : null);
			if (!item || typeof item !== 'object' || !('id' in item)) return;
			const confirm = await vscode.window.showWarningMessage(
				`Supprimer "${item.name}" ?`,
				{ modal: true },
				"Supprimer"
			);
			if (confirm === "Supprimer") {
				dashboard.conf.removeProject(item.id);
				sidebar.getTreeProvider().refresh();
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('easy-dashboard.openFullDashboard', () => {
			dashboard.open();
		})
	);

	const SORT_OPTIONS: { id: string; label: string }[] = [
		{ id: 'name-asc', label: 'Nom (A → Z)' },
		{ id: 'name-desc', label: 'Nom (Z → A)' },
		{ id: 'lastOpen', label: 'Dernière ouverture' },
		{ id: 'createdAt-desc', label: 'Date de création (récent d’abord)' },
		{ id: 'createdAt-asc', label: 'Date de création (ancien d’abord)' },
	];

	context.subscriptions.push(
		vscode.commands.registerCommand('easy-dashboard.changeSortMode', async () => {
			const current = dashboard.conf.sortMode || 'name-asc';
			const pick = await vscode.window.showQuickPick(SORT_OPTIONS, {
				title: 'Trier par',
				placeHolder: current ? SORT_OPTIONS.find(o => o.id === current)?.label : 'Choisir un tri',
			});
			if (pick) {
				await vscode.workspace.getConfiguration('easy-dashboard').update('sortMode', pick.id, true);
				dashboard.conf.sortMode = pick.id;
				sidebar.getTreeProvider().refresh();
			}
		})
	);

	Util.println('Easy Dashboard Activated');
}

export function deactivate() {
}
