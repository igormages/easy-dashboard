import * as vscode from 'vscode';

import Config from './config';
import { uiT } from './ui-locale';
import Dashboard from './dashboard';
import DashboardTreeProvider, { TreeItem } from './dashboard-tree-provider';
import ProjectEntry from './project-entry';
import ProjectFolder from './project-folder';

const TREE_MIME_TYPE = 'application/vnd.code.tree.easy-dashboard-projects-tree';

/** Vue arborescence principale (dossiers + projets) */
export const PROJECTS_VIEW_ID = 'easy-dashboard-projects-tree';
/** Vue « derniers projets ouverts » */
export const RECENT_VIEW_ID = 'easy-dashboard-recent-tree';

class DashboardDragAndDropController implements vscode.TreeDragAndDropController<TreeItem> {

	readonly dragMimeTypes = [TREE_MIME_TYPE];
	readonly dropMimeTypes = [TREE_MIME_TYPE];

	constructor(
		private conf: Config,
		private refresh: () => void
	) {}

	handleDrag(source: TreeItem[], dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): void {
		const ids = source
			.filter((e): e is ProjectFolder | ProjectEntry => typeof e === 'object' && e !== null && 'id' in e)
			.map(e => e.id);
		if (ids.length > 0) {
			dataTransfer.set(TREE_MIME_TYPE, new vscode.DataTransferItem(JSON.stringify(ids)));
		}
	}

	handleDrop(target: TreeItem, dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): void {
		const raw = dataTransfer.get(TREE_MIME_TYPE)?.value;
		if (typeof raw !== 'string') return;
		let ids: string[];
		try {
			ids = JSON.parse(raw) as string[];
		} catch {
			return;
		}
		if (!Array.isArray(ids) || ids.length === 0) return;

		let intoId: string | null = null;
		let beforeId: string | null = null;

		if (target instanceof ProjectFolder) {
			intoId = target.id;
		} else if (target instanceof ProjectEntry) {
			intoId = this.conf.findParentId(target.id);
			beforeId = target.id;
		} else {
			return;
		}

		let before: string | null = beforeId;
		for (const id of ids) {
			if (!this.conf.canMoveInto(id, intoId)) continue;
			this.conf.moveProject(id, intoId, before);
			before = id;
		}
		this.refresh();
	}
}

class Sidebar {

	protected api: Dashboard;
	protected recentProvider: DashboardTreeProvider;
	protected projectsProvider: DashboardTreeProvider;
	protected recentTreeView: vscode.TreeView<TreeItem>;
	protected projectsTreeView: vscode.TreeView<TreeItem>;

	private searchFilter = '';
	private _filterRefreshDebounce: ReturnType<typeof setTimeout> | undefined;
	private _onDidChangeSearchFilter = new vscode.EventEmitter<string>();
	readonly onDidChangeSearchFilter = this._onDidChangeSearchFilter.event;

	constructor(api: Dashboard) {
		this.api = api;
		const getFilter = () => this.searchFilter;
		this.recentProvider = new DashboardTreeProvider(this.api.conf, 'recent', getFilter);
		this.projectsProvider = new DashboardTreeProvider(this.api.conf, 'projects', getFilter);
		const dnd = new DashboardDragAndDropController(
			this.api.conf,
			() => this.projectsProvider.refresh()
		);

		this.recentTreeView = vscode.window.createTreeView(RECENT_VIEW_ID, {
			treeDataProvider: this.recentProvider,
			showCollapseAll: false
		});

		this.projectsTreeView = vscode.window.createTreeView(PROJECTS_VIEW_ID, {
			treeDataProvider: this.projectsProvider,
			dragAndDropController: dnd,
			showCollapseAll: false
		});

		this.api.ext.subscriptions.push(
			this.onDidChangeSearchFilter(q => {
				const t = q.trim();
				const desc = !t ? undefined : uiT('Filter:') + (t.length > 48 ? `${t.slice(0, 45)}…` : t);
				this.recentTreeView.description = desc;
				this.projectsTreeView.description = desc;
			})
		);

		this.projectsTreeView.onDidExpandElement(e => {
			if (e.element instanceof ProjectFolder) {
				e.element.open = true;
				this.api.conf.save();
			}
		});

		this.projectsTreeView.onDidCollapseElement(e => {
			if (e.element instanceof ProjectFolder) {
				e.element.open = false;
				this.api.conf.save();
			}
		});

		this.api.ext.subscriptions.push(this.recentTreeView, this.projectsTreeView);
	}

	getSearchFilter(): string {
		return this.searchFilter;
	}

	setSearchFilter(query: string): void {
		this.searchFilter = query;
		this._onDidChangeSearchFilter.fire(query);
		if (this._filterRefreshDebounce) {
			clearTimeout(this._filterRefreshDebounce);
		}
		this._filterRefreshDebounce = setTimeout(() => {
			this._filterRefreshDebounce = undefined;
			this.refreshTrees();
		}, 150);
	}

	flushSearchFilterTreeRefresh(): void {
		if (this._filterRefreshDebounce) {
			clearTimeout(this._filterRefreshDebounce);
			this._filterRefreshDebounce = undefined;
		}
		this.refreshTrees();
	}

	/** Rafraîchit les vues (recherche, config, données). */
	refreshTrees(): void {
		this.recentProvider.refresh();
		this.projectsProvider.refresh();
	}

	getSelection(): TreeItem[] {
		const fromProjects = [...this.projectsTreeView.selection];
		if (fromProjects.length > 0) {
			return fromProjects;
		}
		return [...this.recentTreeView.selection];
	}
}

export default Sidebar;
