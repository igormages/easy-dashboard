import * as vscode from 'vscode';

import Util from './core/util';
import { clearUiLocaleBundleCache, setUiLocaleExtensionPath, uiT } from './core/ui-locale';
import Dashboard from './core/dashboard';
import Sidebar from './core/sidebar';
import ProjectEntry from './core/project-entry';
import ProjectFolder from './core/project-folder';
import { pickProjectIcon } from './core/project-icons';
import { isRecentEntryWrapper } from './core/dashboard-tree-provider';
import { ActivityTracker } from './core/activity-tracker';
import { LineCounter } from './core/line-counter';
import { ActivitySidebarWebviewViewProvider, ACTIVITY_WEBVIEW_VIEW_ID } from './core/activity-sidebar-webview';

/** Aligne le paramètre workbench sur l’option Easy Dashboard (pas d’API par-vue dans VS Code). */
function syncWorkbenchViewHeaderActionsVisibility(): void {
	const extCfg = vscode.workspace.getConfiguration('easy-dashboard');
	const want = extCfg.get<boolean>('alwaysShowViewHeaderActions', true);
	const wb = vscode.workspace.getConfiguration('workbench');
	const cur = wb.get<boolean>('view.alwaysShowHeaderActions', false);
	if (cur !== want) {
		void wb.update('view.alwaysShowHeaderActions', want, vscode.ConfigurationTarget.Global);
	}
}

export function activate(context: vscode.ExtensionContext) {
	Util.println('Activating Easy Dashboard');

	setUiLocaleExtensionPath(context.extensionPath);
	syncWorkbenchViewHeaderActionsVisibility();

	const dashboard = new Dashboard(context);
	const sidebar = new Sidebar(dashboard);
	const tracker = new ActivityTracker(context);
	const lineCounter = new LineCounter(context);
	
	dashboard.setActivityTracker(tracker);
	dashboard.setLineCounter(lineCounter);
	dashboard.setOnTreeDataChanged(() => sidebar.refreshTrees());

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			ACTIVITY_WEBVIEW_VIEW_ID,
			new ActivitySidebarWebviewViewProvider(dashboard),
			{ webviewOptions: { retainContextWhenHidden: true } }
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('easy-dashboard.filterProjects', () => {
			const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { project?: ProjectEntry }>();
			let accepted = false;
			qp.title = uiT('Easy Dashboard — Search projects');
			qp.placeholder = uiT('Search for a project…');
			qp.value = sidebar.getSearchFilter();
			qp.ignoreFocusOut = true;
			qp.matchOnDescription = true;
			qp.matchOnDetail = true;

			const allProjects: ProjectEntry[] = [];
			const walk = (items: Array<ProjectEntry | ProjectFolder>) => {
				for (const item of items) {
					if (item instanceof ProjectEntry) {
						allProjects.push(item);
					} else if (item instanceof ProjectFolder) {
						walk(item.projects);
					}
				}
			};
			walk(dashboard.conf.database);

			const projectItems = allProjects.map(p => {
				let icon = p.icon || 'codicon-window';
				if (icon.startsWith('codicon-')) {
					icon = icon.replace('codicon-', '');
				}
				return {
					label: `$(${icon}) ${p.name}`,
					description: p.path,
					detail: p.description || undefined,
					project: p
				};
			});

			qp.items = projectItems;

			qp.onDidChangeValue(v => {
				sidebar.setSearchFilter(v);
			});

			qp.onDidAccept(() => {
				accepted = true;
				const selected = qp.selectedItems[0] as any;
				if (selected && selected.project) {
					// Ouvre le projet dans une nouvelle fenêtre par défaut
					dashboard.openProject(selected.project.id, true);
					sidebar.refreshTrees();
				}
				qp.hide();
			});

			qp.onDidHide(() => {
				if (!accepted) {
					sidebar.setSearchFilter('');
				}
				sidebar.flushSearchFilterTreeRefresh();
				qp.dispose();
			});

			qp.show();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('easy-dashboard.openProject', (projectId: string) => {
			dashboard.openProject(projectId, false);
			sidebar.refreshTrees();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('easy-dashboard.openProjectInNewWindow', (node?: ProjectEntry | import('./core/dashboard-tree-provider').RecentEntryWrapper) => {
			const raw = (node && (node instanceof ProjectEntry || isRecentEntryWrapper(node))) ? node : sidebar.getSelection()[0];
			const entry = raw && isRecentEntryWrapper(raw) ? raw.entry : (raw instanceof ProjectEntry ? raw : null);
			if (entry) {
				dashboard.openProject(entry.id, true);
				sidebar.refreshTrees();
			}
		})
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (!e.affectsConfiguration('easy-dashboard')) return;
			syncWorkbenchViewHeaderActionsVisibility();
			if (e.affectsConfiguration('easy-dashboard.uiLocale')) {
				clearUiLocaleBundleCache();
				dashboard.refreshWebviewAfterLocaleChange();
			}
			dashboard.conf.reloadDatabase();
			sidebar.refreshTrees();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('easy-dashboard.addFolder', async () => {
			const selection = sidebar.getSelection();
			const parentId = (selection.length === 1 && selection[0] instanceof ProjectFolder)
				? selection[0].id
				: null;
			const name = await vscode.window.showInputBox({
				prompt: parentId ? uiT('Subfolder name') : uiT('Folder name'),
				title: uiT('Easy Dashboard — New folder')
			});
			if (name) {
				dashboard.conf.addFolder(name, parentId);
				sidebar.refreshTrees();
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('easy-dashboard.addProject', (node?: ProjectFolder) => {
			// Clic droit sur un dossier : node est le dossier passé par le menu contextuel.
			const parentId = (node instanceof ProjectFolder)
				? node.id
				: (sidebar.getSelection().length === 1 && sidebar.getSelection()[0] instanceof ProjectFolder)
					? (sidebar.getSelection()[0] as ProjectFolder).id
					: null;

			dashboard.openNewProjectDialog(parentId);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('easy-dashboard.editProject', async (node?: ProjectEntry | import('./core/dashboard-tree-provider').RecentEntryWrapper) => {
			const raw = (node && (node instanceof ProjectEntry || isRecentEntryWrapper(node))) ? node : sidebar.getSelection()[0];
			const entry = raw && isRecentEntryWrapper(raw) ? raw.entry : (raw instanceof ProjectEntry ? raw : null);
			if (!entry) return;

			const description = await vscode.window.showInputBox({
				title: uiT('Easy Dashboard — Edit project'),
				prompt: uiT('Description'),
				value: entry.description || '',
			});
			const descriptionVal = typeof description === 'string' ? description.trim() : entry.description;

			const { icon, iconPngPath } = await pickProjectIcon(entry.icon, entry.iconPngPath || '');

			dashboard.conf.updateProject(entry.id, { description: descriptionVal, icon: icon || '', iconPngPath: iconPngPath || '' });
			sidebar.refreshTrees();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('easy-dashboard.removeEntry', async (node?: ProjectFolder | ProjectEntry | import('./core/dashboard-tree-provider').RecentEntryWrapper) => {
			const raw = (node && typeof node === 'object') ? node : sidebar.getSelection()[0];
			const item = raw && isRecentEntryWrapper(raw) ? raw.entry : (raw && typeof raw === 'object' && raw !== null && 'id' in raw ? raw as ProjectFolder | ProjectEntry : null);
			if (!item || typeof item !== 'object' || !('id' in item)) return;
			const removeLabel = uiT('Remove');
			const confirm = await vscode.window.showWarningMessage(
				uiT('Remove "{0}"?', item.name),
				{ modal: true },
				removeLabel
			);
			if (confirm === removeLabel) {
				dashboard.conf.removeProject(item.id);
				sidebar.refreshTrees();
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('easy-dashboard.openFullDashboard', () => {
			try {
				dashboard.open();
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				void vscode.window.showErrorMessage(
					uiT('Easy Dashboard could not open: {0}', msg)
				);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('easy-dashboard.switchCursorWindow', () => {
			void vscode.commands.executeCommand('workbench.action.quickSwitchWindow');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('easy-dashboard.collapseAllProjects', () => {
			dashboard.conf.collapseAllFolders();
			sidebar.refreshTrees();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('easy-dashboard.syncEnvWithVercel', async (node?: ProjectEntry | import('./core/dashboard-tree-provider').RecentEntryWrapper) => {
			const raw = (node && (node instanceof ProjectEntry || isRecentEntryWrapper(node))) ? node : sidebar.getSelection()[0];
			const entry = raw && isRecentEntryWrapper(raw) ? raw.entry : (raw instanceof ProjectEntry ? raw : null);
			await dashboard.syncEnvWithVercel(entry ?? undefined);
			sidebar.refreshTrees();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('easy-dashboard.changeSortMode', async () => {
			const sortOptions: { id: string; label: string }[] = [
				{ id: 'name-asc', label: uiT('Name (A → Z)') },
				{ id: 'name-desc', label: uiT('Name (Z → A)') },
				{ id: 'lastOpen', label: uiT('Last opened') },
				{ id: 'createdAt-desc', label: uiT('Created (newest first)') },
				{ id: 'createdAt-asc', label: uiT('Created (oldest first)') },
			];
			const current = dashboard.conf.sortMode || 'name-asc';
			const pick = await vscode.window.showQuickPick(sortOptions, {
				title: uiT('Sort by'),
				placeHolder: current ? sortOptions.find(o => o.id === current)?.label : uiT('Choose sort order'),
			});
			if (pick) {
				await vscode.workspace.getConfiguration('easy-dashboard').update('sortMode', pick.id, true);
				dashboard.conf.sortMode = pick.id;
				sidebar.refreshTrees();
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('easy-dashboard.toggleProjectIcons', async () => {
			const cfg = vscode.workspace.getConfiguration('easy-dashboard');
			const next = !cfg.get<boolean>('showProjectIcons', true);
			await cfg.update('showProjectIcons', next, null);
			dashboard.conf.showProjectIcons = next;
			sidebar.refreshTrees();
		})
	);

	Util.println('Easy Dashboard Activated');
}

export function deactivate() {
}
