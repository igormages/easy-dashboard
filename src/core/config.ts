import * as vscode from 'vscode';
import * as uuid from 'uuid';
import * as path from 'path';
import * as fs from 'fs';

import ProjectEntry from "./project-entry";
import Util from './util';
import ProjectFolder from './project-folder';
import * as RootSync from './projects-root-sync';

class Config {

	api: vscode.WorkspaceConfiguration;

	////////////////////////////////////////////////////////////////
	////////////////////////////////////////////////////////////////

	title!: string;
	debug!: boolean;
	database!: Array<ProjectEntry|ProjectFolder>;
	folderSizing!: string;
	columnSizing!: string;
	tabMode!: boolean;
	showPaths!: boolean;
	showProjectIcons!: boolean;
	openOnNewWindow!: boolean;
	openInNewWindow!: boolean;
	fontSize!: string;
	rounded!: boolean;
	sortMode!: string;
	/** Chemin absolu du dossier racine (projets et dossiers dashboard = disque). Vide = désactivé. */
	projectsRoot!: string;
	viewMode!: string;
	chartVisible!: boolean;
	filterMode!: string;
	/** Langue forcée de l’UI Easy Dashboard (auto | en | fr). */
	uiLocale!: string;
	/** Slug ou ID d’équipe Vercel (optionnel) pour la CLI `vercel link`. */
	vercelTeamSlug!: string;
	/** Organisation Neon optionnelle (`org_id`) pour les clés personnelles. */
	neonOrgId!: string;

	private _selfSaving = false;

	private keepers:
	Array<string> = [
		'title', 'debug', 'database', 'folderSizing', 'columnSizing',
		'tabMode', 'showPaths', 'showProjectIcons', 'fontSize', 'rounded',
		'openOnNewWindow', 'openInNewWindow', 'sortMode', 'projectsRoot',
		'viewMode', 'chartVisible', 'filterMode', 'uiLocale',
		'vercelTeamSlug', 'neonOrgId'
	];

	////////////////////////////////////////////////////////////////
	////////////////////////////////////////////////////////////////

	constructor() {

		this.api = vscode.workspace.getConfiguration('easy-dashboard');
		this.resetRuntimeDefaults();

		this.fillFromEditorConfig();
		return;
	};

	////////////////////////////////////////////////////////////////
	////////////////////////////////////////////////////////////////

	private resetRuntimeDefaults(): void {
		this.title = 'Easy Dashboard';
		this.debug = false;
		this.database = [];
		this.folderSizing = 'col-12';
		this.columnSizing = 'col-12 col-md-6';
		this.tabMode = true;
		this.showPaths = true;
		this.showProjectIcons = true;
		this.openOnNewWindow = true;
		this.openInNewWindow = false;
		this.fontSize = 'font-size-normal';
		this.rounded = true;
		this.sortMode = 'name-asc';
		this.projectsRoot = '';
		this.viewMode = 'grid';
		this.chartVisible = true;
		this.filterMode = 'all';
		this.uiLocale = 'auto';
		this.vercelTeamSlug = '';
		this.neonOrgId = '';
	}

	public fillFromEditorConfig():
	void {

		let self = this;

		// in this instance this self is quite specific because vsocde would
		// claim everything was fine, but manually running the compiler
		// bombed saying cannot find name this. even though for a while it
		// was working. but then this alias hack... whatever my dudes.

		for(const key of this.keepers) {
			if(key === 'database')
			continue;

			if(!this.api.has(key))
			continue;

			this[key as keyof this] = this.api.get(key) as (typeof self[(keyof this)]);
		}

		const { db, fromLegacy } = this.getDatabaseFromSettings();
		if (Array.isArray(db)) {
			for (const item of db) {
				if (typeof item.path === 'undefined')
					this.database.push(new ProjectFolder(item as any));
				else
					this.database.push(new ProjectEntry(item as any));
			}
			if (fromLegacy && this.database.length > 0) this.save();
		}

		return;
	};

	/** Racine normalisée ou `null` si la synchro disque est désactivée. */
	public normalizedProjectsRoot(): string | null {
		const r = (this.projectsRoot || '').trim();
		if (!r) {
			return null;
		}
		return Util.fixDriveLetters(path.resolve(r));
	}

	/**
	 * Crée l’arborescence de dossiers et déplace les projets locaux pour refléter l’arbre dashboard.
	 * À appeler après définition ou changement de `projectsRoot`.
	 */
	public applyProjectsRootLayout(): string[] {
		const root = this.normalizedProjectsRoot();
		if (!root) {
			return [];
		}
		if (!fs.existsSync(root)) {
			fs.mkdirSync(root, { recursive: true });
		}
		RootSync.ensureFolderDirectoriesExist(root, this.database);
		return RootSync.reconcileProjectPaths(root, this.database);
	}

	/** Crée un dossier projet sous la racine et l’ajoute au dashboard. Retourne `false` si pas de racine. */
	public addLocalProjectUnderDashboardRoot(
		name: string,
		folderSegment: string,
		parentId: string | null,
		description?: string | null,
		icon?: string | null,
		iconPngPath?: string | null
	): string | null {
		const root = this.normalizedProjectsRoot();
		if (!root) {
			return null;
		}
		const seg = RootSync.sanitizeDiskSegment(folderSegment || name);
		let parentAbs = root;
		if (parentId !== null) {
			const pa = RootSync.getExpectedFolderAbsPath(root, this.database, parentId);
			if (pa) {
				parentAbs = pa;
			}
		}
		const full = RootSync.uniqueChildDir(parentAbs, seg);
		fs.mkdirSync(full, { recursive: true });
		this.addProject(
			name,
			full,
			parentId,
			description ?? undefined,
			icon ?? undefined,
			iconPngPath ?? undefined,
			path.basename(full)
		);
		return full;
	}

	/** Lit la base depuis easy-dashboard, ou depuis dashyeah (ancienne extension) si vide. */
	private getDatabaseFromSettings(): { db: Array<{ id?: string; name?: string; path?: string }>; fromLegacy: boolean } {
		let db = this.api.get<Array<{ id?: string; name?: string; path?: string }>>('database');
		if (Array.isArray(db) && db.length > 0) return { db, fromLegacy: false };
		const legacyApi = vscode.workspace.getConfiguration('dashyeah');
		db = legacyApi.get<Array<{ id?: string; name?: string; path?: string }>>('database');
		return { db: Array.isArray(db) ? db : [], fromLegacy: Array.isArray(db) && db.length > 0 };
	}

	/** Recharge la base depuis les paramètres (pour synchroniser après changement dans une autre fenêtre).
	 *  Ignore les changements déclenchés par notre propre save(). */
	public reloadDatabase(): void {
		if (this._selfSaving) return;

		let self = this;
		this.api = vscode.workspace.getConfiguration('easy-dashboard');
		this.resetRuntimeDefaults();
		for(const key of this.keepers) {
			if(key === 'database')
			continue;

			if(!this.api.has(key))
			continue;

			this[key as keyof this] = this.api.get(key) as (typeof self[(keyof this)]);
		}
		const { db, fromLegacy } = this.getDatabaseFromSettings();
		if (Array.isArray(db)) {
			for (const item of db) {
				if (typeof item.path === 'undefined')
					this.database.push(new ProjectFolder(item as any));
				else
					this.database.push(new ProjectEntry(item as any));
			}
			if (fromLegacy && this.database.length > 0) this.save();
		}
	}

	public getMap():
	Map<string, any> {

		let output = new Map<string, any>();

		for(const key of this.keepers) {
			if(key === 'database')
			output.set(key, this.database.map((v)=> v));
			else
			output.set(key, this[key as keyof this]);
		}

		return output;
	};

	public getObject():
	object {

		let output: any = {};

		for(const key of this.keepers) {
			if(key === 'database')
			output[key] = this.database.map((v)=> v);
			else
			output[key] = this[key as keyof this];
		}

		return output;
	};

	public setObject(input: any):
	void {

		for(const key in input)
		if(this.keepers.indexOf(key) >= 0)
		this[key as keyof this] = input[key];

		this.save();

		return;
	};

	public get isSelfSaving(): boolean {
		return this._selfSaving;
	}

	public save():
	void {

		this._selfSaving = true;

		const promises: Thenable<void>[] = [];
		for(const key of this.keepers)
		if(this.api.has(key))
		promises.push(this.api.update(key, this[key as keyof this], true));

		Promise.all(promises).then(
			()=> { this._selfSaving = false; },
			()=> { this._selfSaving = false; }
		);

		return;
	};

	/** Replie tous les dossiers (vue Projets) et persiste l’état. */
	public collapseAllFolders(): void {
		const walk = (items: Array<ProjectEntry | ProjectFolder>): void => {
			for (const item of items) {
				if (item instanceof ProjectFolder) {
					item.open = false;
					walk(item.projects);
				}
			}
		};
		walk(this.database);
		this.save();
	}

	////////////////////////////////////////////////////////////////
	////////////////////////////////////////////////////////////////

	public addFolder(name: string, parentId: string|null = null):
	void {

		let folderName = name;
		const root = this.normalizedProjectsRoot();
		if (root) {
			const parentAbs = parentId !== null
				? RootSync.getExpectedFolderAbsPath(root, this.database, parentId)
				: root;
			if (parentAbs) {
				const full = RootSync.uniqueChildDir(parentAbs, RootSync.sanitizeDiskSegment(name));
				folderName = path.basename(full);
				fs.mkdirSync(full, { recursive: true });
			}
		}

		let project = new ProjectFolder({
			id: uuid.v4(),
			name: folderName
		});

		if (parentId !== null) {
			const parent = this.findProject(parentId);
			if (parent instanceof ProjectFolder) {
				parent.projects.push(project);
				this.save();
				return;
			}
		}

		project.open = false;

		this.database.push(project);
		this.save();
		return;
	};

	public addProject(
		name: string,
		path: string,
		parent: string|null,
		description?: string|null,
		icon?: string|null,
		iconPngPath?: string|null,
		diskSegment?: string|null,
		meta?: {
			neonProjectId?: string | null;
			vercelProjectName?: string | null;
			vercelEnvSyncScope?: string | null;
		}
	): ProjectEntry {

		let database = this.database;
		let folder = null;
		let accent = null;

		if (parent !== null) {
			folder = this.findProject(parent);
			if (folder instanceof ProjectFolder) {
				database = folder.projects;
				accent = folder.accent;
			}
		}

		const seg = (diskSegment ?? '').trim();
		const project = new ProjectEntry({
			id: uuid.v4(),
			name,
			path,
			accent,
			icon: icon ?? '',
			iconPngPath: iconPngPath ?? '',
			description: description ?? '',
			diskSegment: seg || undefined,
			neonProjectId: meta?.neonProjectId ?? '',
			vercelProjectName: meta?.vercelProjectName ?? '',
			vercelEnvSyncScope: meta?.vercelEnvSyncScope ?? 'all_targets',
		});
		database.push(project);

		this.save();
		return project;
	};

	public removeProject(id: string):
	void {

		this.findProject(id, true);
		this.save();

		return;
	};

	public updateProject(id: string, data: any):
	void {

		const item = this.findProject(id);

		if(item !== null) {
			const root = this.normalizedProjectsRoot();
			if (root && item instanceof ProjectFolder && typeof data.name === 'string' && data.name !== item.name) {
				RootSync.renameFolderOnDisk(root, this.database, id, item.name, data.name);
			}
			item.update(data);
			this.save();
		}

		return;
	};

	public moveProject(id: string, into: string|null, before: string|null):
	void {

		let database: Array<any>|null = null;
		let found = this.findProject(id);
		let folder = null;

		let shouldInsertAfter: boolean = false;
		let inset: boolean = false;
		let key: any = 0;

		if(found === null)
		return Util.println(
			`project ${id} not found`,
			'Config::moveProject'
		);

		const root = this.normalizedProjectsRoot();
		let folderOldAbs: string | null = null;
		let projectOldFs: string | null = null;
		if (root) {
			if (found instanceof ProjectFolder) {
				folderOldAbs = RootSync.getExpectedFolderAbsPath(root, this.database, found.id);
			} else if (found instanceof ProjectEntry && !RootSync.isRemoteOrNonLocalPath(found.path)) {
				projectOldFs = RootSync.toFsPath(found.path);
			}
		}

		// determine the thing to contain this project exists.

		database = this.database;

		if(into !== null) {
			folder = this.findProject(into);

			if(folder instanceof ProjectFolder)
			database = folder.projects;

			else
			return Util.println(
				`folder ${into} not found`,
				'Config::moveProject'
			);
		}

		if(!Array.isArray(database))
		return Util.println(
			'nothing happened',
			'Config::moveProject'
		);

		// determine if we dragged this to a project that came before or
		// after the one to move. this makes drag drop feel better when
		// dragging things farther down a list. but don't do anything
		// if we dragged it upon ourselves.

		if(before !== null) {
			if(found.id === before)
			return;

			for(key in database) {
				if(database[key].id === before) {
					shouldInsertAfter = false;
					break;
				}

				if(database[key].id === found.id) {
					shouldInsertAfter = true;
					break;
				}
			}
		}

		// pull the thing we are moving out and reset our database
		// references for later manipulation since this find/remove method
		// ends up returning new arrays i think.

		this.findProject(found.id, true);

		if(folder instanceof ProjectFolder)
		database = folder.projects;
		else
		database = this.database;

		// then determine if it needs to go into a specific spot into the
		// the final dataset finding the array offset now that the original
		// item has been removed.

		key = 0;

		if(before !== null) {
			for(key in database) {
				if(database[key].id === before) {
					inset = true;
					break;
				}
			}
		}

		key = parseInt(key);

		if(shouldInsertAfter)
		key += 1;

		// summarize what we've determined.

		if(inset)
		Util.println(
			`insert before ${before}`,
			'Config::moveProject'
		);

		Util.println(
			`seating project in slot ${key}`,
			'Config::moveProject'
		);

		// and do it mang.

		if(inset)
		database.splice(key, 0, found);
		else
		database.push(found);

		if (root) {
			if (found instanceof ProjectFolder && folderOldAbs) {
				RootSync.moveFolderOnDisk(root, this.database, found.id, folderOldAbs);
			} else if (found instanceof ProjectEntry && projectOldFs) {
				RootSync.moveLocalProjectOnDisk(root, this.database, found, projectOldFs);
			}
		}

		this.save();
		return;
	};

	private findInTree(
		arr: Array<ProjectFolder|ProjectEntry>,
		id: string,
		parentFolderId: string|null = null
	): { found: ProjectFolder|ProjectEntry; parentArray: Array<ProjectFolder|ProjectEntry>; index: number; parentFolderId: string|null } | null {

		for (let i = 0; i < arr.length; i++) {
			const item = arr[i];
			if (item.id === id) {
				return { found: item, parentArray: arr, index: i, parentFolderId };
			}
			if (item instanceof ProjectFolder) {
				const r = this.findInTree(item.projects, id, item.id);
				if (r) return r;
			}
		}
		return null;
	}

	/** Id du dossier parent (null si à la racine) */
	public findParentId(id: string): string|null {
		const r = this.findInTree(this.database, id, null);
		return r ? r.parentFolderId : null;
	}

	public findProjectByPath(projectPath: string): ProjectEntry|null {
		const target = Util.fixDriveLetters(projectPath);
		const walk = (items: Array<ProjectFolder|ProjectEntry>): ProjectEntry|null => {
			for (const item of items) {
				if (item instanceof ProjectEntry && Util.fixDriveLetters(item.path) === target) {
					return item;
				}
				if (item instanceof ProjectFolder) {
					const found = walk(item.projects);
					if (found) return found;
				}
			}
			return null;
		};
		return walk(this.database);
	}

	/** Vérifie qu’on peut déplacer l’élément id dans le dossier intoId (évite boucles) */
	public canMoveInto(id: string, intoFolderId: string|null): boolean {
		if (intoFolderId === null) return true;
		if (id === intoFolderId) return false;
		let cur: string|null = intoFolderId;
		while (cur !== null) {
			if (cur === id) return false;
			cur = this.findParentId(cur);
		}
		return true;
	}

	public findProject(id: string, removeAsWell: boolean = false):
	ProjectFolder|ProjectEntry|null {

		const r = this.findInTree(this.database, id);
		if (!r) return null;
		if (removeAsWell) {
			r.parentArray.splice(r.index, 1);
		}
		return r.found;
	};

};

export default Config;
