import * as vscode from 'vscode';

import Config from './config';
import ProjectEntry from './project-entry';
import ProjectFolder from './project-folder';
import { uiT } from './ui-locale';

/** Placeholder affiché quand il n’y a aucun projet / aucun récent */
export const EMPTY_PLACEHOLDER = Symbol('empty');

/** Wrapper pour afficher un projet dans « Derniers projets ouverts » avec un id unique (évite déduplication) */
export interface RecentEntryWrapper {
	readonly _recent: true;
	entry: ProjectEntry;
}

export type TreePane = 'recent' | 'projects';

export type TreeItem = ProjectFolder | ProjectEntry | RecentEntryWrapper | typeof EMPTY_PLACEHOLDER;

const RECENT_MAX = 10;

export function isRecentEntryWrapper(e: TreeItem): e is RecentEntryWrapper {
	return typeof e === 'object' && e !== null && '_recent' in e && (e as RecentEntryWrapper)._recent === true;
}

export class DashboardTreeProvider implements vscode.TreeDataProvider<TreeItem> {

	private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(
		private conf: Config,
		private readonly pane: TreePane,
		private readonly getSearchFilter: () => string
	) {}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	private normalizeFilter(raw: string): string {
		return raw.trim().toLowerCase();
	}

	private entryMatchesQuery(entry: ProjectEntry, qNorm: string): boolean {
		if (!qNorm) {
			return true;
		}
		if (entry.name.toLowerCase().includes(qNorm)) {
			return true;
		}
		if (entry.path.toLowerCase().includes(qNorm)) {
			return true;
		}
		if (entry.description && entry.description.toLowerCase().includes(qNorm)) {
			return true;
		}
		return false;
	}

	private folderNameMatchesQuery(folder: ProjectFolder, qNorm: string): boolean {
		if (!qNorm) {
			return true;
		}
		return folder.name.toLowerCase().includes(qNorm);
	}

	/** Sous-arborescence filtrée (qNorm déjà normalisé, non vide) */
	private filterItemsRaw(items: (ProjectFolder | ProjectEntry)[], qNorm: string): (ProjectFolder | ProjectEntry)[] {
		const out: (ProjectFolder | ProjectEntry)[] = [];
		for (const item of items) {
			if (item instanceof ProjectEntry) {
				if (this.entryMatchesQuery(item, qNorm)) {
					out.push(item);
				}
			} else {
				const childFiltered = this.filterItemsRaw(item.projects, qNorm);
				if (this.folderNameMatchesQuery(item, qNorm) || childFiltered.length > 0) {
					out.push(item);
				}
			}
		}
		return out;
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
		const qNorm = this.normalizeFilter(this.getSearchFilter());
		if (this.pane === 'recent') {
			if (element !== undefined) {
				return [];
			}
			let recent = this.getRecentEntries();
			if (qNorm) {
				recent = recent.filter(w => this.entryMatchesQuery(w.entry, qNorm));
			}
			if (recent.length === 0) {
				return [EMPTY_PLACEHOLDER];
			}
			return recent;
		}

		// projects
		if (element === undefined) {
			const db = this.conf.database;
			if (!qNorm) {
				return db.length === 0 ? [EMPTY_PLACEHOLDER] : this.sortItems(db);
			}
			const filtered = this.filterItemsRaw(db, qNorm);
			return filtered.length === 0 ? [EMPTY_PLACEHOLDER] : this.sortItems(filtered);
		}
		if (element instanceof ProjectFolder) {
			if (!qNorm) {
				return this.sortItems(element.projects);
			}
			if (this.folderNameMatchesQuery(element, qNorm)) {
				return this.sortItems(element.projects);
			}
			return this.sortItems(this.filterItemsRaw(element.projects, qNorm));
		}
		return [];
	}

	getTreeItem(element: TreeItem): vscode.TreeItem {
		if (element === EMPTY_PLACEHOLDER) {
			const qNorm = this.normalizeFilter(this.getSearchFilter());
			const searching = Boolean(qNorm);
			if (this.pane === 'recent') {
				const item = new vscode.TreeItem(
					searching ? uiT('No results') : uiT('No recent projects yet'),
					vscode.TreeItemCollapsibleState.None
				);
				item.id = searching ? 'easy-dashboard-empty-recent-search' : 'easy-dashboard-empty-recent';
				item.description = searching
					? uiT('Try changing or clearing the search')
					: uiT('Open a project from the Projects view');
				item.iconPath = new vscode.ThemeIcon(searching ? 'search' : 'history');
				return item;
			}
			const item = new vscode.TreeItem(
				searching ? uiT('No results') : uiT('No projects yet'),
				vscode.TreeItemCollapsibleState.None
			);
			item.id = searching ? 'easy-dashboard-empty-search' : 'easy-dashboard-empty-projects';
			item.description = searching
				? uiT('Try changing or clearing the search')
				: uiT('Use the toolbar or context menu to add a folder or project');
			item.iconPath = new vscode.ThemeIcon(searching ? 'search' : 'folder-library');
			return item;
		}
		if (isRecentEntryWrapper(element)) {
			const entry = element.entry;
			const item = new vscode.TreeItem(entry.name, vscode.TreeItemCollapsibleState.None);
			item.id = `recent-${entry.id}`;
			item.contextValue = 'easy-dashboard-project';
			item.command = { command: 'easy-dashboard.openProject', title: entry.name, arguments: [entry.id] };
			if (entry.description) item.description = entry.description;
			if (this.conf.showProjectIcons) {
				if (entry.iconPngPath) item.iconPath = vscode.Uri.file(entry.iconPngPath);
				else if (entry.icon) item.iconPath = new vscode.ThemeIcon(entry.icon);
			}
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
		if (this.conf.showProjectIcons) {
			if (entry.iconPngPath) item.iconPath = vscode.Uri.file(entry.iconPngPath);
			else if (entry.icon) item.iconPath = new vscode.ThemeIcon(entry.icon);
		}
		return item;
	}
}

export default DashboardTreeProvider;
