import * as vscode from 'vscode';

import ProjectEntry from './project-entry';
import Util from './util';

type ProjectFolderArgv = {
	id: string,
	name: string,
	accent?: string|null,
	icon?: string|null,
	open?: boolean,
	projects?: Array<Record<string, unknown>>,
	createdAt?: number|null
};

class ProjectFolder {

	public id: string;
	public name: string;
	public accent: string;
	public icon: string;
	public open: boolean;
	public projects: Array<ProjectFolder | ProjectEntry>;
	public createdAt: number;

	constructor(input: ProjectFolderArgv) {

		this.id = input.id;
		this.name = input.name;
		this.icon = input.icon ?? this.getIcon();
		this.accent = input.accent ?? 'var(--EasyDashboardProjectAccent)';
		this.open = input.open ?? false;
		this.createdAt = input.createdAt ?? Date.now();
		this.projects = Array.isArray(input.projects)
			? input.projects.map((v) => ProjectFolder.parseItem(v))
			: [];

		return;
	}

	/** Parse un élément brut (dossier ou projet) pour l’arbre imbriqué */
	static parseItem(v: Record<string, unknown>): ProjectFolder | ProjectEntry {
		if (typeof (v as any).path !== 'undefined') {
			return new ProjectEntry(v as any);
		}
		return new ProjectFolder(v as any);
	}

	public getIcon():
	string {

		return 'codicon-folder';
	};

	public update(input: any):
	typeof this {

		if(typeof input.id !== 'undefined')
		this.id = input.id;

		if(typeof input.name !== 'undefined')
		this.name = input.name;

		if(typeof input.accent !== 'undefined')
		this.accent = input.accent;

		if(typeof input.icon !== 'undefined')
		this.icon = input.icon;

		if(typeof input.open !== 'undefined')
		this.open = input.open;

		if (typeof input.createdAt !== 'undefined') this.createdAt = input.createdAt;

		return this;
	};

};

export default ProjectFolder;
