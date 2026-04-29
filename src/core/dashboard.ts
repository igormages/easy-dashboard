import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';

import Util from './util';
import { createCloudflareCnameToVercel, listCloudflareZones } from './cloudflare-api';
import { listVercelProjectNames } from './vercel-api';
import { createNeonProject, getNeonProjectConnection, listNeonProjects } from './neon-api';
import { syncVercelEnvWithLocal, VercelEnvSyncScope, writeLocalNeonEnv } from './vercel-env-sync';

const execFileAsync = promisify(execFile);
import { buildWebviewJsI18n, escapeHtml } from './i18n-catalog';
import { getUiLangForHtml, uiT } from './ui-locale';
import Config from './config';
import Message from './message';
import ProjectEntry from './project-entry';
import ProjectFolder from './project-folder';
import { pickProjectIcon } from './project-icons';
import { ActivityTracker } from './activity-tracker';
import { LineCounter } from './line-counter';
import { slugifyFromDisplayName } from './project-slug';

type ProjectLike = ProjectEntry|ProjectFolder|null;

/** Données optionnelles post-création (GitHub, Vercel, Cloudflare). */
type NewProjectPostData = {
	projectId?: string;
	gitAction?: string;
	githubSlug?: string;
	gitCloneUrl?: string;
	vercelEnabled?: boolean;
	vercelProjectName?: string;
	vercelEnvSyncScope?: VercelEnvSyncScope;
	neonEnabled?: boolean;
	neonMode?: string;
	neonProjectId?: string;
	neonProjectName?: string;
	neonRegionId?: string;
	domainEnabled?: boolean;
	cloudflareZoneId?: string;
	cloudflareZoneName?: string;
	subdomain?: string;
};

class Dashboard {

	public panel:
	vscode.WebviewPanel|undefined;

	/** Vue latérale « Activité » (même graphique que le dashboard). */
	private activityWebviewView: vscode.WebviewView | undefined;

	public ext:
	vscode.ExtensionContext;

	public conf:
	Config;

	private tracker?: ActivityTracker;
	private lineCounter?: LineCounter;

	/** Après chargement initial du webview, ouvre le dialogue « nouveau projet » (parent = dossier ou racine). */
	private pendingOpenProjectNewParent: string | null | false = false;

	private onTreeDataChanged?: () => void;

	////////////////////////////////////////////////////////////////
	////////////////////////////////////////////////////////////////

	public constructor(ext: vscode.ExtensionContext) {

		this.ext = ext;
		this.conf = new Config;

		// If a new window opens with no folder opened, show the dashboard when enabled.
		// Deferred so the check runs after the window is ready (avoids welcome tab etc.).
		if (this.conf.openOnNewWindow) {
			setTimeout(() => this.tryOpenOnNewWindow(), 600);
		}

		return;
	}

	public setActivityTracker(tracker: ActivityTracker) {
		this.tracker = tracker;
	}

	public setLineCounter(lineCounter: LineCounter) {
		this.lineCounter = lineCounter;
	}

	public setOnTreeDataChanged(handler: () => void): void {
		this.onTreeDataChanged = handler;
	}

	public setActivityWebviewView(view: vscode.WebviewView | undefined): void {
		this.activityWebviewView = view;
	}

	/**
	 * Ouvre le dashboard complet et affiche le même dialogue de création de projet que dans la vue web.
	 */
	public openNewProjectDialog(parent: string | null = null): void {
		const hadPanel = !!this.panel;
		this.open();
		if (hadPanel && this.panel) {
			this.sendv('openprojectnew', { parent });
		} else {
			this.pendingOpenProjectNewParent = parent;
		}
	}

	private tryOpenOnNewWindow(): void {
		if (!this.conf.openOnNewWindow) return;
		// No folder opened = blank/new window
		if (typeof vscode.workspace.name !== 'undefined') return;
		this.open({ preserveFocus: true });
		vscode.commands.executeCommand('workbench.view.extension.easy-dashboard-sidebar');
	}

	////////////////////////////////////////////////////////////////
	////////////////////////////////////////////////////////////////

	/**
	 * @param opts.preserveFocus Si true, le focus reste sur l’élément actif (ex. auto-open fenêtre vide).
	 *                           Par défaut false : l’onglet dashboard reçoit le focus (commande / raccourci).
	 */
	public open(opts?: { preserveFocus?: boolean }):
	void {

		// settings changed via the settings ui do not take effect unless
		// we reload them. im sure its not that big of a deal but most
		// users are not going to need this happening every time.
		// this.conf = new Config;

		const preserveFocus = opts?.preserveFocus === true;

		if (this.panel) {
			try {
				this.panel.reveal(vscode.ViewColumn.One, preserveFocus);
			} catch {
				delete this.panel;
			}
			if (this.panel) {
				return;
			}
		}

		const bundleJs = path.join(this.ext.extensionPath, 'local', 'dist', 'index.js');
		if (!fs.existsSync(bundleJs)) {
			void vscode.window.showErrorMessage(
				uiT(
					'Easy Dashboard: the web UI bundle is missing (local/dist). Run npm run build:webview then reload the window.'
				)
			);
			return;
		}

		this.panel = vscode.window.createWebviewPanel(
			'easy-dashboard-dashboard-main',
			uiT('Easy Dashboard'),
			{
				viewColumn: vscode.ViewColumn.One,
				preserveFocus
			},
			{
				retainContextWhenHidden: true,
				enableScripts: true,
				localResourceRoots: [
					vscode.Uri.file(this.ext.extensionPath)
				]
			}
		);

		this.panel.iconPath = vscode.Uri.file(path.join(
			this.ext.extensionPath, 'local', 'gfx', 'icon.svg'
		));

		(this.panel)
		.onDidDispose(this.onClosed.bind(this));

		(this.panel.webview)
		.onDidReceiveMessage(this.onMessage.bind(this));

		(this.panel.webview)
		.html = this.generateContent();

		return;
	};

	public send(msg: Message):
	void {

		if(!this.panel)
		return;

		(this.panel.webview)
		.postMessage(msg);

		return;
	};

	public sendv(type: string, data: object|null=null):
	void {

		if(!this.panel)
		return;

		let msg = new Message(type, data);
		Util.println(
			type,
			'Easy Dashboard::sendv'
		);

		(this.panel.webview)
		.postMessage(msg);

		return;
	};

	/** Après changement de `easy-dashboard.uiLocale` : titre du panel et carte i18n du webview. */
	public refreshWebviewAfterLocaleChange(): void {
		if (!this.panel) {
			return;
		}
		this.panel.title = uiT('Easy Dashboard');
		void this.onHey(new Message('hey', null));
	}

	////////////////////////////////////////////////////////////////
	////////////////////////////////////////////////////////////////

	public generateContent():
	string {

		if(!this.panel)
		return '';

		return this.buildWebviewPageHtml(this.panel.webview, { activityMode: false });
	}

	/** Document HTML pour la vue latérale Activité (bundle avec <code>?mode=activity</code>). */
	public generateActivityViewContent(webview: vscode.Webview): string {
		return this.buildWebviewPageHtml(webview, { activityMode: true });
	}

	private getNonce(): string {
		return crypto.randomBytes(16).toString('hex');
	}

	private buildWebviewPageHtml(webview: vscode.Webview, opts: { activityMode: boolean }): string {
		const cspSource = webview.cspSource;
		const nonce = this.getNonce();
		const cssUri = this.webviewFileUri(webview, path.join(this.ext.extensionPath, 'local', 'dist', 'index.css'));
		const jsBase = this.webviewFileUri(webview, path.join(this.ext.extensionPath, 'local', 'dist', 'index.js'));
		const jsUri = opts.activityMode ? `${jsBase}?mode=activity` : jsBase;
		const codiconsUri = this.webviewFileUri(
			webview,
			path.join(this.ext.extensionPath, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')
		);

		const pageTitle = escapeHtml(opts.activityMode ? uiT('Activity') : uiT('Easy Dashboard'));
		const pageLang = escapeHtml(getUiLangForHtml());
		return `<!DOCTYPE html>
<html lang="${pageLang}">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${cspSource}; font-src ${cspSource}; img-src ${cspSource} data: https:;">
	<title>${pageTitle}</title>
	<link href="${codiconsUri}" rel="stylesheet" />
	<link href="${cssUri}" rel="stylesheet" />
</head>
<body>
	<div id="root"></div>
	<script nonce="${nonce}" type="module" src="${jsUri}"></script>
</body>
</html>`;
	}

	public generateDatabase():
	object {


		return {

		};
	};

	////////////////////////////////////////////////////////////////
	////////////////////////////////////////////////////////////////

	public onClosed():
	void {

		Util.println('Easy Dashboard Closed');
		delete this.panel;

		return;
	};

	////////////////////////////////////////////////////////////////
	////////////////////////////////////////////////////////////////

	public onMessage(input: unknown):
	void {

		if (!input || typeof input !== 'object') {
			return;
		}

		const raw = input as { type?: unknown; data?: unknown };
		if (typeof raw.type !== 'string') {
			return;
		}

		let msg = Message.FromObject(raw);

		if(this.conf.debug)
		Util.println(
			JSON.stringify({ type: msg.type }),
			'Easy Dashboard::onMessage'
		);

		switch(msg.type) {
			case 'hey':
				void this.onHey(msg);
			break;
			case 'pickdir':
				this.onPickDir(msg);
			break;
			case 'pickprojecticon':
				this.onPickProjectIcon(msg);
			break;
			case 'pickprojectsroot':
				this.onPickProjectsRoot(msg);
			break;
			case 'foldernew':
				this.onFolderNew(msg);
			break;
			case 'projectopen':
				this.onProjectOpen(msg);
			break;
			case 'projectnew':
				this.onProjectNew(msg);
			break;
			case 'projectdel':
				this.onProjectDel(msg);
			break;
			case 'projectset':
				this.onProjectSet(msg);
			break;
			case 'projectmove':
				this.onProjectMove(msg);
			break;
			case 'configset':
				this.onConfigSet(msg);
			break;
			case 'folderopen':
				this.onFolderOpen(msg);
			break;
			case 'folderopenall':
				this.onFolderOpenAll(msg);
			break;
			case 'folderclose':
				this.onFolderClose(msg);
			break;
			case 'foldercloseall':
				this.onFolderCloseAll(msg);
			break;
			case 'openfulldashboard':
				this.open();
			break;
			case 'foldercolourset':
				this.onFolderColourSet(msg);
			break;
			case 'foldercolourrng':
				this.onFolderColourRng(msg);
			break;
			case 'foldersort':
				this.onFolderSort(msg);
			break;
			case 'viewmodeset':
				this.conf.setObject({ viewMode: msg.data.viewMode });
				void this.onHey(msg);
			break;
			case 'chartvisibleset':
				this.conf.setObject({ chartVisible: msg.data.chartVisible });
				void this.onHey(msg);
			break;
			case 'filtermode':
				this.conf.setObject({ filterMode: msg.data.filterMode });
				void this.onHey(msg);
			break;
			case 'statsrequest':
				this.onStatsRequest(msg);
			break;
			case 'integrationsettings':
				void this.onIntegrationSettings(msg);
			break;
			case 'cloudflarelistzones':
				void this.onCloudflareListZones(msg);
			break;
			case 'vercellistprojects':
				void this.onVercelListProjects(msg);
			break;
			case 'neonlistprojects':
				void this.onNeonListProjects(msg);
			break;
		}

		return;
	};

	private async onStatsRequest(msg: Message) {
		if (!this.lineCounter) return;
		
		const projectPath = typeof msg.data?.path === 'string' ? msg.data.path : '';
		const project = this.findProjectEntryByPath(projectPath);
		if (project) {
			if (project.path.includes('://') && !project.path.startsWith('file:')) {
				this.sendv('stats', { path: project.path, lines: 0 });
				return;
			}
			const fsPath = project.getUriObject().fsPath;
			const lines = await this.lineCounter.countLines(fsPath);
			this.sendv('stats', { path: project.path, lines });
		}
	}

	private mapDatabaseForWebview(arr: any[], webview: vscode.Webview | undefined): any[] {
		if (!webview) return arr;
		return arr.map((v: any) => {
			if (!v || typeof v !== 'object') return v;
			const out = { ...v };
			if (out.projects) out.projects = this.mapDatabaseForWebview(out.projects, webview);
			if (out.iconPngPath) {
				out.iconPngUri = webview.asWebviewUri(vscode.Uri.file(out.iconPngPath)).toString();
			}
			return out;
		});
	}

	private anyWebviewForUriMapping(): vscode.Webview | undefined {
		return this.panel?.webview ?? this.activityWebviewView?.webview;
	}

	private postSupToWebviews(config: object): void {
		const msg = new Message('sup', config);
		if (this.panel) {
			this.panel.webview.postMessage(msg);
		}
		if (this.activityWebviewView) {
			this.activityWebviewView.webview.postMessage(msg);
		}
		if (this.conf.debug) {
		Util.println('sup', 'Easy Dashboard::postSupToWebviews');
		}
	}

	public async onHey(msg: Message):
	Promise<void> {

		this.onTreeDataChanged?.();

		const config = this.conf.getObject() as any;
		const mapWv = this.anyWebviewForUriMapping();
		if (Array.isArray(config.database)) {
			config.database = this.mapDatabaseForWebview(config.database, mapWv);
		}
		config.i18n = buildWebviewJsI18n((m) => uiT(m));

		if (this.tracker) {
			config.activityData = this.tracker.getDataForWebview();
		}

		config.vercelTeamSlug = this.conf.vercelTeamSlug ?? '';
		config.neonOrgId = this.conf.neonOrgId ?? '';
		const cfTok = await this.ext.secrets.get('easyDashboard.cloudflareApiToken');
		const vTok = await this.ext.secrets.get('easyDashboard.vercelToken');
		const neonTok = await this.ext.secrets.get('easyDashboard.neonApiKey');
		(config as any).cloudflareTokenConfigured = !!(cfTok && cfTok.trim());
		(config as any).vercelTokenConfigured = !!(vTok && vTok.trim());
		(config as any).neonTokenConfigured = !!(neonTok && neonTok.trim());

		this.postSupToWebviews(config);

		if (this.pendingOpenProjectNewParent !== false) {
			const parent = this.pendingOpenProjectNewParent;
			this.pendingOpenProjectNewParent = false;
			this.sendv('openprojectnew', { parent });
		}

		return;
	};

	public onPickDir(msg: Message):
	void {

		let self = this;

		(vscode.window)
		.showOpenDialog({
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false
		})
		.then(function(Selected: vscode.Uri[] | undefined){

			if(typeof Selected === 'undefined')
			return;

			if(typeof Selected[0] === 'undefined')
			return;

			let fsp = Util.fixDriveLetters(Selected[0].fsPath);
			let uri = Util.fixDriveLetters(Selected[0].toString());

			self.sendv('dirpick',{
				label: fsp,
				uri: uri
			});

			return;
		});

		return;
	};

	public onPickProjectIcon(msg: Message):
	void {

		const self = this;
		const rid =
			msg.data &&
			typeof (msg.data as { requestId?: string }).requestId === 'string'
				? (msg.data as { requestId: string }).requestId
				: '';

		void pickProjectIcon('', '').then(function (picked) {
			const payload: {
				requestId: string;
				icon: string;
				iconPngPath: string;
				iconPngUri?: string;
			} = {
				requestId: rid,
				icon: picked.icon,
				iconPngPath: picked.iconPngPath,
			};
			if (picked.iconPngPath && self.panel) {
				payload.iconPngUri = self.panel.webview
					.asWebviewUri(vscode.Uri.file(picked.iconPngPath))
					.toString();
			}
			self.sendv('projecticonpick', payload);
		});

		return;
	};

	public onPickProjectsRoot(_msg: Message):
	void {

		const self = this;

		(vscode.window)
		.showOpenDialog({
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false
		})
		.then(function(Selected: vscode.Uri[] | undefined){

			if(typeof Selected === 'undefined')
			return;

			if(typeof Selected[0] === 'undefined')
			return;

			let fsp = Util.fixDriveLetters(Selected[0].fsPath);

			self.sendv('projectsrootpick',{
				label: fsp,
				uri: Selected[0].toString()
			});

			return;
		});

		return;
	};

	public onFolderNew(msg: Message):
	void {

		this.conf.addFolder(msg.data.name);
		void this.onHey(msg);

		return;
	};

	public onProjectOpen(msg: Message):
	void {

		this.openProject(msg.data.id, msg.data.openNewWindow ?? false);
		return;
	};

	public openProject(projectId: string, openNewWindow: boolean = false):
	void {

		let project = this.conf.findProject(projectId);

		if(project instanceof ProjectEntry) {
			Util.println(
				`open ${projectId} ${openNewWindow}`,
				'Easy Dashboard::openProject'
			);

			vscode.commands.executeCommand(
				'vscode.openFolder',
				project.getUriObject(),
				{ forceNewWindow: openNewWindow }
			);

			this.conf.updateProject(projectId, { lastOpenedAt: Date.now() });
			
			if (this.tracker) {
				this.tracker.recordOpen(project.getUriObject().fsPath);
			}
		}
		return;
	};

	public onProjectNew(msg: Message):
	void {

		const data = msg.data as {
			name: string;
			uri?: string;
			parent?: string | null;
			createUnderRoot?: boolean;
			diskFolderName?: string;
			description?: string;
			icon?: string;
			iconPngPath?: string;
			gitAction?: string;
			githubSlug?: string;
			gitCloneUrl?: string;
			vercelEnabled?: boolean;
			vercelProjectName?: string;
			vercelEnvSyncScope?: VercelEnvSyncScope;
			neonEnabled?: boolean;
			neonMode?: string;
			neonProjectId?: string;
			neonProjectName?: string;
			neonRegionId?: string;
			domainEnabled?: boolean;
			cloudflareZoneId?: string;
			cloudflareZoneName?: string;
			subdomain?: string;
		};

		let localCwd: string | null = null;
		let createdProject: ProjectEntry | null = null;
		const vercelProjectName = (data.vercelProjectName || '').trim();
		const vercelEnvSyncScope = data.vercelEnvSyncScope === 'development_only' ? 'development_only' : 'all_targets';

		if (data.createUnderRoot) {
			const diskFolder =
				(data.diskFolderName && data.diskFolderName.trim()) ||
				slugifyFromDisplayName(data.name) ||
				'project';
			const createdPath = this.conf.addLocalProjectUnderDashboardRoot(
				data.name,
				diskFolder,
				data.parent ?? null,
				data.description,
				data.icon,
				data.iconPngPath
			);
			if (!createdPath) {
				vscode.window.showWarningMessage(
					uiT('Set a projects root folder in Easy Dashboard settings first.')
				);
			} else {
				localCwd = createdPath;
				createdProject = this.conf.findProjectByPath(createdPath);
			}
		} else {
			let fsPath = (data.uri ?? '').trim();
			if (fsPath.startsWith('file:')) {
				fsPath = Util.fixDriveLetters(vscode.Uri.parse(fsPath, true).fsPath);
			} else {
				fsPath = Util.fixDriveLetters(fsPath);
			}
			createdProject = this.conf.addProject(
				data.name,
				fsPath,
				data.parent ?? null,
				data.description,
				data.icon,
				data.iconPngPath,
				undefined,
				{
					vercelProjectName,
					vercelEnvSyncScope,
					neonProjectId: data.neonProjectId,
				}
			);

			if (!fsPath.includes('://')) {
				localCwd = fsPath;
			}
		}

		if (createdProject) {
			this.conf.updateProject(createdProject.id, {
				vercelProjectName,
				vercelEnvSyncScope,
				neonProjectId: data.neonProjectId ?? '',
			});
		}

		void this.onHey(msg);

		if (localCwd) {
			const post: NewProjectPostData = {
				projectId: createdProject?.id,
				gitAction: data.gitAction,
				githubSlug: data.githubSlug,
				gitCloneUrl: data.gitCloneUrl,
				vercelEnabled: data.vercelEnabled,
				vercelProjectName,
				vercelEnvSyncScope,
				neonEnabled: data.neonEnabled,
				neonMode: data.neonMode,
				neonProjectId: data.neonProjectId,
				neonProjectName: data.neonProjectName,
				neonRegionId: data.neonRegionId,
				domainEnabled: data.domainEnabled,
				cloudflareZoneId: data.cloudflareZoneId,
				cloudflareZoneName: data.cloudflareZoneName,
				subdomain: data.subdomain,
			};
			void this.runNewProjectPostSetup(localCwd, post);
		}

		return;
	};

	private async execVercelCli(args: string[], cwd: string): Promise<void> {
		const stored = (await this.ext.secrets.get('easyDashboard.vercelToken'))?.trim() ?? '';
		const env: NodeJS.ProcessEnv = { ...process.env };
		if (stored) {
			env.VERCEL_TOKEN = stored;
		}
		const candidates = process.platform === 'win32' ? ['vercel.cmd', 'vercel'] : ['vercel'];
		for (const cmd of candidates) {
			try {
				await execFileAsync(cmd, args, { cwd, env });
				return;
			} catch (e: unknown) {
				const err = e as { code?: string };
				if (err.code !== 'ENOENT') {
					throw e;
				}
			}
		}
		await execFileAsync('npx', ['--yes', 'vercel', ...args], { cwd, env });
	}

	private async runGitClone(cwd: string, cloneUrl: string): Promise<void> {
		await execFileAsync('git', ['clone', cloneUrl, '.'], { cwd });
	}

	private async runGithubCreateRepo(cwd: string, slug: string): Promise<void> {
		await execFileAsync('git', ['init'], { cwd });
		await execFileAsync('git', ['add', '.'], { cwd });
		await execFileAsync('git', ['commit', '--allow-empty', '-m', 'Initial commit'], { cwd });
		await execFileAsync(
			'gh',
			['repo', 'create', slug, '--private', '--source', '.', '--remote', 'origin', '--push'],
			{ cwd }
		);
	}

	private async runVercelLink(cwd: string, projectName: string): Promise<void> {
		const team = (this.conf.vercelTeamSlug || '').trim();
		const args = ['link', '--yes', '--non-interactive', '--project', projectName];
		if (team) {
			args.push('--team', team);
		}
		await this.execVercelCli(args, cwd);
	}

	private async runVercelDomainAdd(cwd: string, fqdn: string, projectName: string): Promise<void> {
		const args = ['domains', 'add', fqdn, projectName, '--non-interactive'];
		await this.execVercelCli(args, cwd);
	}

	private async writeNeonEnvForProject(
		project: ProjectEntry,
		neonProjectId: string,
		scope: VercelEnvSyncScope
	): Promise<void> {
		if (project.path.includes('://') && !project.path.startsWith('file:')) {
			throw new Error(uiT('Environment sync requires a local project path.'));
		}
		const token = (await this.ext.secrets.get('easyDashboard.neonApiKey'))?.trim() ?? '';
		if (!token) {
			throw new Error(uiT('Set Neon API key in Easy Dashboard settings.'));
		}
		const connection = await getNeonProjectConnection(token, neonProjectId.trim());
		writeLocalNeonEnv(project.getUriObject().fsPath, {
			DATABASE_URL: connection.databaseUrl,
			...(connection.databaseUrlUnpooled ? { DATABASE_URL_UNPOOLED: connection.databaseUrlUnpooled } : {}),
		}, scope);
		this.conf.updateProject(project.id, { neonProjectId: connection.projectId });
	}

	private async runNewProjectPostSetup(cwd: string, data: NewProjectPostData): Promise<void> {
		const needsGitHub =
			data.gitAction === 'create_github' && !!(data.githubSlug && data.githubSlug.trim());
		const needsClone = data.gitAction === 'clone_git' && !!(data.gitCloneUrl && data.gitCloneUrl.trim());
		const needsVercel = !!(data.vercelEnabled && data.vercelProjectName && data.vercelProjectName.trim());
		const needsNeon = !!(data.neonEnabled && (data.neonMode === 'create' || data.neonProjectId));
		const sub = (data.subdomain || '').trim().replace(/\.$/, '');
		const apex = (data.cloudflareZoneName || '').trim().replace(/\.$/, '');
		const needsDomain = !!(
			data.domainEnabled &&
			data.cloudflareZoneId &&
			sub &&
			apex &&
			data.vercelProjectName &&
			data.vercelProjectName.trim()
		);

		if (!needsGitHub && !needsClone && !needsVercel && !needsDomain && !needsNeon) {
			return;
		}

		try {
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: uiT('Setting up project…'),
					cancellable: false,
				},
				async (progress) => {
					if (needsGitHub) {
						progress.report({ increment: 0, message: uiT('Creating GitHub repository...') });
						await this.runGithubCreateRepo(cwd, data.githubSlug!.trim());
					}
					if (needsClone) {
						progress.report({ increment: 0, message: uiT('Cloning Git repository...') });
						await this.runGitClone(cwd, data.gitCloneUrl!.trim());
					}
					if (needsVercel) {
						progress.report({ increment: 0, message: uiT('Linking Vercel project...') });
						await this.runVercelLink(cwd, data.vercelProjectName!.trim());
					}
					let neonEnv: Record<string, string> | null = null;
					if (needsNeon) {
						progress.report({ increment: 0, message: uiT('Setting up Neon database...') });
						const token = (await this.ext.secrets.get('easyDashboard.neonApiKey'))?.trim() ?? '';
						if (!token) {
							throw new Error(uiT('Set Neon API key in Easy Dashboard settings.'));
						}
						const scope = data.vercelEnvSyncScope ?? 'all_targets';
						const connection = data.neonMode === 'create'
							? await createNeonProject(
								token,
								(data.neonProjectName || data.vercelProjectName || path.basename(cwd)).trim(),
								(this.conf.neonOrgId || '').trim() || undefined,
								data.neonRegionId?.trim() || undefined
							)
							: await getNeonProjectConnection(token, data.neonProjectId!.trim());
						neonEnv = {
							DATABASE_URL: connection.databaseUrl,
							...(connection.databaseUrlUnpooled ? { DATABASE_URL_UNPOOLED: connection.databaseUrlUnpooled } : {}),
						};
						writeLocalNeonEnv(cwd, neonEnv, scope);
						if (data.projectId) {
							this.conf.updateProject(data.projectId, { neonProjectId: connection.projectId });
						}
					}
					if (needsDomain) {
						progress.report({ increment: 0, message: uiT('Creating Cloudflare DNS record...') });
						const token = (await this.ext.secrets.get('easyDashboard.cloudflareApiToken'))?.trim() ?? '';
						if (!token) {
							throw new Error(uiT('Set Cloudflare API token in Easy Dashboard settings.'));
						}
						await createCloudflareCnameToVercel(token, data.cloudflareZoneId!, sub, 'cname.vercel-dns.com');
						const fqdn = `${sub}.${apex}`;
						progress.report({ increment: 0, message: uiT('Adding domain to Vercel...') });
						await this.runVercelDomainAdd(cwd, fqdn, data.vercelProjectName!.trim());
					}
					if (needsVercel) {
						progress.report({ increment: 0, message: uiT('Synchronizing environment variables...') });
						const token = (await this.ext.secrets.get('easyDashboard.vercelToken'))?.trim() ?? '';
						if (!token) {
							throw new Error(uiT('Set Vercel API token in Easy Dashboard settings to list projects.'));
						}
						if (neonEnv) {
							writeLocalNeonEnv(cwd, neonEnv, data.vercelEnvSyncScope ?? 'all_targets');
						}
						await syncVercelEnvWithLocal({
							token,
							projectName: data.vercelProjectName!.trim(),
							teamSlugOrId: (this.conf.vercelTeamSlug || '').trim() || undefined,
							cwd,
							scope: data.vercelEnvSyncScope ?? 'all_targets',
						});
					}
				}
			);
			void vscode.window.showInformationMessage(uiT('Project setup completed.'));
		} catch (e) {
			const detail = e instanceof Error ? e.message : String(e);
			Util.println(`Post-setup failed: ${detail}`, 'Easy Dashboard::runNewProjectPostSetup');
			void vscode.window.showErrorMessage(uiT('Project setup failed: {0}', detail));
		}
	}

	private async onIntegrationSettings(msg: Message): Promise<void> {
		const d = msg.data as {
			cloudflareToken?: string;
			vercelToken?: string;
			neonToken?: string;
			neonOrgId?: string;
			clearCloudflareToken?: boolean;
			clearVercelToken?: boolean;
			clearNeonToken?: boolean;
		};
		if (d.clearCloudflareToken) {
			await this.ext.secrets.delete('easyDashboard.cloudflareApiToken');
		}
		if (d.clearVercelToken) {
			await this.ext.secrets.delete('easyDashboard.vercelToken');
		}
		if (d.clearNeonToken) {
			await this.ext.secrets.delete('easyDashboard.neonApiKey');
		}
		if (typeof d.cloudflareToken === 'string' && d.cloudflareToken.trim()) {
			await this.ext.secrets.store('easyDashboard.cloudflareApiToken', d.cloudflareToken.trim());
		}
		if (typeof d.vercelToken === 'string' && d.vercelToken.trim()) {
			await this.ext.secrets.store('easyDashboard.vercelToken', d.vercelToken.trim());
		}
		if (typeof d.neonToken === 'string' && d.neonToken.trim()) {
			await this.ext.secrets.store('easyDashboard.neonApiKey', d.neonToken.trim());
		}
		if (typeof d.neonOrgId === 'string') {
			this.conf.setObject({ neonOrgId: d.neonOrgId.trim() });
		}
		await this.onHey(msg);
	}

	private async onCloudflareListZones(_msg: Message): Promise<void> {
		const token = (await this.ext.secrets.get('easyDashboard.cloudflareApiToken'))?.trim() ?? '';
		if (!token) {
			this.sendv('cloudflarezones', {
				zones: [] as { id: string; name: string }[],
				error: uiT('Set Cloudflare API token in Easy Dashboard settings.'),
			});
			return;
		}
		try {
			const zones = await listCloudflareZones(token);
			this.sendv('cloudflarezones', { zones });
		} catch (e) {
			const detail = e instanceof Error ? e.message : String(e);
			if (this.conf.debug) {
				Util.println(`Cloudflare zones failed: ${detail}`, 'Easy Dashboard::onCloudflareListZones');
			}
			this.sendv('cloudflarezones', { zones: [], error: uiT('Could not list Cloudflare zones. Check the token and network connection.') });
		}
	}

	private async onVercelListProjects(_msg: Message): Promise<void> {
		const token = (await this.ext.secrets.get('easyDashboard.vercelToken'))?.trim() ?? '';
		if (!token) {
			this.sendv('vercelprojects', {
				projects: [] as { name: string }[],
				error: uiT('Set Vercel API token in Easy Dashboard settings to list projects.'),
			});
			return;
		}
		const team = (this.conf.vercelTeamSlug || '').trim();
		try {
			const names = await listVercelProjectNames(token, team || undefined);
			this.sendv('vercelprojects', { projects: names.map((name) => ({ name })) });
		} catch (e) {
			const detail = e instanceof Error ? e.message : String(e);
			if (this.conf.debug) {
				Util.println(`Vercel projects failed: ${detail}`, 'Easy Dashboard::onVercelListProjects');
			}
			this.sendv('vercelprojects', { projects: [], error: uiT('Could not list Vercel projects. Check the token, team scope, and network connection.') });
		}
	}

	private async onNeonListProjects(_msg: Message): Promise<void> {
		const token = (await this.ext.secrets.get('easyDashboard.neonApiKey'))?.trim() ?? '';
		if (!token) {
			this.sendv('neonprojects', {
				projects: [] as { id: string; name: string }[],
				error: uiT('Set Neon API key in Easy Dashboard settings.'),
			});
			return;
		}
		try {
			const projects = await listNeonProjects(token, (this.conf.neonOrgId || '').trim() || undefined);
			this.sendv('neonprojects', { projects });
		} catch (e) {
			const detail = e instanceof Error ? e.message : String(e);
			if (this.conf.debug) {
				Util.println(`Neon projects failed: ${detail}`, 'Easy Dashboard::onNeonListProjects');
			}
			this.sendv('neonprojects', { projects: [], error: uiT('Could not list Neon projects. Check the API key, organization ID, and network connection.') });
		}
	}

	private allProjectEntries(): ProjectEntry[] {
		const out: ProjectEntry[] = [];
		const walk = (items: Array<ProjectEntry | ProjectFolder>) => {
			for (const item of items) {
				if (item instanceof ProjectEntry) {
					out.push(item);
				} else {
					walk(item.projects);
				}
			}
		};
		walk(this.conf.database);
		return out;
	}

	private findProjectEntryByPath(projectPath: string): ProjectEntry | null {
		const wanted = projectPath.trim();
		if (!wanted) {
			return null;
		}

		for (const project of this.allProjectEntries()) {
			if (project.path === wanted) {
				return project;
			}
			try {
				if (project.getUriObject().fsPath === wanted) {
					return project;
				}
			} catch {
				// Ignore malformed stored URIs while validating a webview request.
			}
		}
		return null;
	}

	public async syncEnvWithVercel(project?: ProjectEntry): Promise<void> {
		let target = project ?? null;
		if (!target) {
			const pick = await vscode.window.showQuickPick(
				this.allProjectEntries().map((p) => ({
					label: p.name,
					description: p.vercelProjectName || p.path,
					project: p,
				})),
				{
					title: uiT('Synchronize environment variables'),
					placeHolder: uiT('Choose a project'),
				}
			);
			target = pick?.project ?? null;
		}
		if (!target) {
			return;
		}
		if (target.path.includes('://')) {
			void vscode.window.showWarningMessage(uiT('Environment sync requires a local project path.'));
			return;
		}
		const token = (await this.ext.secrets.get('easyDashboard.vercelToken'))?.trim() ?? '';
		if (!token) {
			void vscode.window.showWarningMessage(uiT('Set Vercel API token in Easy Dashboard settings to list projects.'));
			return;
		}
		const projectName = (target.vercelProjectName || target.name).trim();
		if (!projectName) {
			void vscode.window.showWarningMessage(uiT('Set a Vercel project name before syncing environment variables.'));
			return;
		}

		try {
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: uiT('Synchronizing environment variables...'),
					cancellable: false,
				},
				async () => {
					await syncVercelEnvWithLocal({
						token,
						projectName,
						teamSlugOrId: (this.conf.vercelTeamSlug || '').trim() || undefined,
						cwd: target!.path,
						scope: (target!.vercelEnvSyncScope === 'development_only' ? 'development_only' : 'all_targets'),
					});
				}
			);
			void vscode.window.showInformationMessage(uiT('Environment variables synchronized.'));
		} catch (e) {
			const detail = e instanceof Error ? e.message : String(e);
			Util.println(`Env sync failed: ${detail}`, 'Easy Dashboard::syncEnvWithVercel');
			void vscode.window.showErrorMessage(uiT('Environment sync failed: {0}', detail));
		}
	}

	public onProjectDel(msg: Message):
	void {

		this.conf.removeProject(msg.data.id);

		void this.onHey(msg);

		return;
	};

	public onProjectMove(msg: Message):
	void {

		if(typeof msg.data.into !== 'undefined')
		this.onProjectMove_Into(msg);

		else if(typeof msg.data.before !== 'undefined')
		this.onProjectMove_Before(msg);

		void this.onHey(msg);

		return;
	};

	protected onProjectMove_Into(msg: Message):
	void {

		this.conf.moveProject(
			msg.data.id,
			msg.data.into ?? null,
			msg.data.before ?? null
		);

		return;
	};

	protected onProjectMove_Before(msg: Message):
	void {

		this.conf.moveProject(
			msg.data.id,
			msg.data.into ?? null,
			msg.data.before ?? null
		);

		return;
	};

	public onProjectSet(msg: Message):
	void {

		const nextNeonProjectId = typeof msg.data.neonProjectId === 'string' ? msg.data.neonProjectId.trim() : '';

		this.conf.updateProject(msg.data.id, msg.data);

		const after = this.conf.findProject(msg.data.id);
		if (
			after instanceof ProjectEntry &&
			nextNeonProjectId
		) {
			void this.writeNeonEnvForProject(
				after,
				nextNeonProjectId,
				after.vercelEnvSyncScope === 'development_only' ? 'development_only' : 'all_targets'
			).then(
				() => { void this.onHey(msg); },
				(e) => {
					const detail = e instanceof Error ? e.message : String(e);
					Util.println(`Neon env write failed: ${detail}`, 'Easy Dashboard::onProjectSet');
					void vscode.window.showErrorMessage(uiT('Environment sync failed: {0}', detail));
				}
			);
		}

		void this.onHey(msg);

		return;
	};

	public onConfigSet(msg: Message):
	void {

		const prevNorm = this.conf.normalizedProjectsRoot();
		this.conf.setObject(msg.data);
		const nextNorm = this.conf.normalizedProjectsRoot();

		if (nextNorm && nextNorm !== prevNorm) {
			const errs = this.conf.applyProjectsRootLayout();
			if (errs.length > 0) {
				vscode.window.showWarningMessage(
					uiT('Partial disk sync: {0}', errs.slice(0, 3).join(' — '))
				);
			} else {
				vscode.window.showInformationMessage(
					uiT('Projects and folders matched the root folder.')
				);
			}
			this.conf.save(); // Save the updated paths after syncing
		}

		void this.onHey(msg);

		return;
	};

	public onFolderOpen(msg: Message):
	void {

		this.conf.updateProject(msg.data.id, { open: true });

		void this.onHey(msg);

		return;
	};

	public onFolderOpenAll(msg: Message):
	void {

		for(const item of this.conf.database)
		if(item instanceof ProjectFolder)
		item.open = true;

		this.conf.save();
		void this.onHey(msg);

		return;
	};

	public onFolderClose(msg: Message):
	void {

		this.conf.updateProject(msg.data.id, { open: false });

		void this.onHey(msg);

		return;
	};

	public onFolderCloseAll(msg: Message):
	void {

		for(const item of this.conf.database)
		if(item instanceof ProjectFolder)
		item.open = false;

		this.conf.save();
		void this.onHey(msg);

		return;
	};

	public onFolderColourSet(msg: Message):
	void {

		let folder = this.conf.findProject(msg.data.id);

		if(folder instanceof ProjectFolder)
		for(const project of folder.projects)
		project.accent = folder.accent;

		this.conf.save();
		void this.onHey(msg);

		return;
	};

	public onFolderColourRng(msg: Message):
	void {

		let folder: ProjectLike = this.conf.findProject(msg.data.id);
		let from: string|null = null;
		let severity: number = 8;

		if(!(folder instanceof ProjectFolder))
		return;

		// if the message contained a starting point then use that as the
		// base as thats what was in the text input but not commited to
		// the save yet.

		if(typeof msg.data.from === 'string')
		from = msg.data.from;

		if(folder.projects.length <= 3)
		severity *= 3.0;

		else if(folder.projects.length <= 2)
		severity *= 5.0;

		// produce a spread of colours.

		let colours = Util.arrayColoursFrom(
			(from ?? folder.accent),
			folder.projects.length,
			severity
		);

		// randomize the colours if asked.

		if(typeof msg.data.random === 'boolean')
		if(msg.data.random)
		colours.sort((a, b)=> Util.randomNegative());

		// distribute the colours across the projects.

		for(const project of folder.projects)
		project.accent = colours.pop() ?? folder.accent;

		this.conf.save();
		void this.onHey(msg);
		return;
	};

	public onFolderSort(msg: Message):
	void {

		let folder = this.conf.findProject(msg.data.id);
		let mode: string = 'desc';

		if(!(folder instanceof ProjectFolder))
		return;

		if(typeof msg.data.dir === 'string')
		mode = msg.data.dir;

		////////

		if(mode === 'asc')
		folder.projects.sort(Util.sortFuncByNameAsc);
		else
		folder.projects.sort(Util.sortFuncByNameDesc);

		console.log(folder.projects);

		this.conf.save();
		void this.onHey(msg);
		return;
	};

	////////////////////////////////////////////////////////////////
	////////////////////////////////////////////////////////////////

	public webviewFileUri(webview: vscode.Webview, filename: string): string {
		return webview.asWebviewUri(vscode.Uri.file(filename)).toString();
	}

	public localToWebpath(filename: string):
	string {

		if(!this.panel)
		return '';

		return this.webviewFileUri(this.panel.webview, filename);
	};

};

export default Dashboard;