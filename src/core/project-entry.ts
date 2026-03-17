import * as vscode from 'vscode';
import Util from './util';

type ProjectEntryArgv = {
	id: string,
	name: string,
	path: string,
	accent?: string|null,
	icon?: string|null,
	description?: string|null,
	createdAt?: number|null,
	lastOpenedAt?: number|null
};

class ProjectEntry {

	public id: string;
	public icon: string;
	public name: string;
	public path: string;
	public accent: string;
	public description: string;
	/** Timestamp de création (pour tri) */
	public createdAt: number;
	/** Dernière ouverture (pour tri) */
	public lastOpenedAt: number;

	constructor(input: ProjectEntryArgv) {

		this.id = input.id;
		this.name = input.name;
		this.path = input.path;
		this.icon = input.icon ?? '';
		this.accent = input.accent ?? '#dc143c';
		this.description = (input.description ?? '').trim();
		this.createdAt = input.createdAt ?? Date.now();
		this.lastOpenedAt = input.lastOpenedAt ?? 0;

		return;
	};

	public getUriObject():
	vscode.Uri {

		// local filepaths can just be their path.
		// ssh tho, vscode-remote://ssh-remote+USER@HOST/PATH

		if(this.path.match(/:\/\//))
		return vscode.Uri.parse(this.path, true);

		return vscode.Uri.file(this.path);
	};

	public update(input: any):
	this {

		if (typeof input.id !== 'undefined') this.id = input.id;
		if (typeof input.name !== 'undefined') this.name = input.name;
		if (typeof input.path !== 'undefined') this.path = input.path;
		if (typeof input.accent !== 'undefined') this.accent = input.accent;
		if (typeof input.icon !== 'undefined') this.icon = input.icon;
		if (typeof input.description !== 'undefined') this.description = (input.description ?? '').trim();
		if (typeof input.createdAt !== 'undefined') this.createdAt = input.createdAt;
		if (typeof input.lastOpenedAt !== 'undefined') this.lastOpenedAt = input.lastOpenedAt;

		return this;
	};

};

export default ProjectEntry;
