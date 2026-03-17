import * as vscode from 'vscode';

import Config from './config';
import ProjectEntry from './project-entry';
import ProjectFolder from './project-folder';

/** Titre toujours affiché en tête de la vue */
export const TITLE_ITEM = Symbol('title');
/** Section des 10 derniers projets ouverts */
export const RECENT_SECTION = Symbol('recent');
/** Placeholder affiché quand il n’y a aucun projet */
export const EMPTY_PLACEHOLDER = Symbol('empty');

/** Wrapper pour afficher un projet dans "Derniers ouverts" avec un id unique (évite déduplication) */
export interface RecentEntryWrapper {
	readonly _recent: true;
	entry: ProjectEntry;
}

export type TreeItem = ProjectFolder | ProjectEntry | RecentEntryWrapper | typeof TITLE_ITEM | typeof RECENT_SECTION | typeof EMPTY_PLACEHOLDER;

const RECENT_MAX = 10;

export function isRecentEntryWrapper(e: TreeItem): e is RecentEntryWrapper {
	return typeof e === 'object' && e !== null && '_recent' in e && (e as RecentEntryWrapper)._recent === true;
}

export class DashboardTreeProvider implements vscode.TreeDataProvider<TreeItem> {

	private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(private conf: Config) {}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	/** Dossiers avant projets, puis tri selon sortMode */
	private sortItems(items: TreeItem[]): TreeItem[] {
		const folders = items.filter((e): e is ProjectFolder => e instanceof ProjectFolder);
		const entries = items.filter((e): e is ProjectEntry => e instanceof ProjectEntry);
		const mode = this.conf.sortMode || 'name-asc';

		const cmp = (a: ProjectFolder | ProjectEntry, b: ProjectFolder | ProjectEntry): number => {
			if (mode === 'name-asc') return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
			if (mode === 'name-desc') return (b.name || '').localeCompare(a.name || '', undefined, { sensitivity: 'base' });
			if (mode === 'lastOpen') {
				const ta = (a instanceof ProjectEntry ? a.lastOpenedAt : 0) || 0;
				const tb = (b instanceof ProjectEntry ? b.lastOpenedAt : 0) || 0;
				return tb - ta;
			}
			if (mode === 'createdAt-desc') return (b.createdAt ?? 0) - (a.createdAt ?? 0);
			if (mode === 'createdAt-asc') return (a.createdAt ?? 0) - (b.createdAt ?? 0);
			return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
		};

		return [...folders.sort(cmp), ...entries.sort(cmp)];
	}

	/** Tous les projets (ProjectEntry) de la base, récursivement */
	private getAllEntries(arr: (ProjectFolder | ProjectEntry)[]): ProjectEntry[] {
		const out: ProjectEntry[] = [];
		for (const item of arr) {
			if (item instanceof ProjectEntry) out.push(item);
			else if (item instanceof ProjectFolder) out.push(...this.getAllEntries(item.projects));
		}
		return out;
	}

	/** Les 10 derniers projets ouverts (lastOpenedAt > 0, tri desc), en wrappers pour id unique */
	private getRecentEntries(): RecentEntryWrapper[] {
		const all = this.getAllEntries(this.conf.database);
		return all
			.filter(e => e.lastOpenedAt > 0)
			.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
			.slice(0, RECENT_MAX)
			.map(entry => ({ _recent: true as const, entry }));
	}

	getChildren(element?: TreeItem): TreeItem[] {
		if (element === undefined) {
			const db = this.conf.database;
			const rest: TreeItem[] = db.length === 0 ? [EMPTY_PLACEHOLDER] : this.sortItems(db);
			return [TITLE_ITEM, RECENT_SECTION, ...rest];
		}
		if (element === RECENT_SECTION) {
			return this.getRecentEntries();
		}
		if (element instanceof ProjectFolder) {
			return this.sortItems(element.projects);
		}
		return [];
	}

	getTreeItem(element: TreeItem): vscode.TreeItem {
		if (element === TITLE_ITEM) {
			const item = new vscode.TreeItem("Easy Dashboard", vscode.TreeItemCollapsibleState.None);
			item.description = "Projets et dossiers";
			item.iconPath = new vscode.ThemeIcon("project");
			return item;
		}
		if (element === RECENT_SECTION) {
			const recent = this.getRecentEntries();
			const item = new vscode.TreeItem(
				"Derniers ouverts",
				recent.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None
			);
			item.description = recent.length > 0 ? `${recent.length} projet${recent.length > 1 ? 's' : ''}` : "Aucune ouverture récente";
			item.iconPath = new vscode.ThemeIcon("history");
			return item;
		}
		if (isRecentEntryWrapper(element)) {
			const entry = element.entry;
			const item = new vscode.TreeItem(entry.name, vscode.TreeItemCollapsibleState.None);
			item.id = `recent-${entry.id}`;
			item.contextValue = 'easy-dashboard-project';
			item.command = { command: 'easy-dashboard.openProject', title: entry.name, arguments: [entry.id] };
			if (entry.description) item.description = entry.description;
			if (entry.icon) item.iconPath = new vscode.ThemeIcon(entry.icon);
			return item;
		}
		if (element === EMPTY_PLACEHOLDER) {
			const item = new vscode.TreeItem("Aucun projet", vscode.TreeItemCollapsibleState.None);
			item.description = "Cliquez sur + pour ajouter un dossier ou un projet";
			item.iconPath = new vscode.ThemeIcon("folder-library");
			return item;
		}
		if (element instanceof ProjectFolder) {
			const item = new vscode.TreeItem(
				element.name,
				element.open ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
			);
			item.id = element.id;
			item.contextValue = 'easy-dashboard-folder';
			item.iconPath = new vscode.ThemeIcon('folder');
			return item;
		}
		// ProjectEntry (element n’est plus ProjectFolder, RECENT_SECTION, wrapper ni EMPTY_PLACEHOLDER)
		const entry = element as ProjectEntry;
		const item = new vscode.TreeItem(
			entry.name,
			vscode.TreeItemCollapsibleState.None
		);
		item.id = entry.id;
		item.contextValue = 'easy-dashboard-project';
		item.command = {
			command: 'easy-dashboard.openProject',
			title: entry.name,
			arguments: [entry.id]
		};
		if (entry.description) item.description = entry.description;
		if (entry.icon) item.iconPath = new vscode.ThemeIcon(entry.icon);
		return item;
	}
}

export default DashboardTreeProvider;
