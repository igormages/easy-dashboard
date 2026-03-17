import * as vscode from 'vscode';

import Config from './config';
import Dashboard from './dashboard';
import { DashboardTreeProvider, TreeItem } from './dashboard-tree-provider';
import ProjectEntry from './project-entry';
import ProjectFolder from './project-folder';

const TREE_MIME_TYPE = 'application/vnd.code.tree.easy-dashboard-projects-tree';

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

	/** Id de la vue (doit correspondre à package.json views[].id) */
	public static readonly VIEW_ID = "easy-dashboard-projects-tree";

	protected api: Dashboard;
	protected treeProvider: DashboardTreeProvider;
	protected treeView: vscode.TreeView<TreeItem>;

	constructor(api: Dashboard) {
		this.api = api;
		this.treeProvider = new DashboardTreeProvider(this.api.conf);
		const dnd = new DashboardDragAndDropController(
			this.api.conf,
			() => this.treeProvider.refresh()
		);

		this.treeView = vscode.window.createTreeView(Sidebar.VIEW_ID, {
			treeDataProvider: this.treeProvider,
			dragAndDropController: dnd,
			showCollapseAll: true
		});

		this.treeView.onDidExpandElement(e => {
			if (e.element instanceof ProjectFolder) {
				e.element.open = true;
				this.api.conf.save();
			}
		});

		this.treeView.onDidCollapseElement(e => {
			if (e.element instanceof ProjectFolder) {
				e.element.open = false;
				this.api.conf.save();
			}
		});

		this.api.ext.subscriptions.push(this.treeView);
	}

	getTreeProvider(): DashboardTreeProvider {
		return this.treeProvider;
	}

	getSelection(): TreeItem[] {
		return [...this.treeView.selection];
	}
}

export default Sidebar;
