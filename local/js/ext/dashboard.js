import Folder from './folder.js';
import Project from './project.js';
import Message from './message.js';
import ProjectNew from './project-new.js';
import FolderNew from './folder-new.js';
import DashboardConfig from './dashboard-config.js';
import { setI18nMap, t } from './i18n.js';

class Dashboard {

	elMain = null;
	elMessageDebug = null;
	elToolbar = null;
	elProjectBox = null;
	body = null;
	template = {};

	// official config values.

	database = null;
	title = 'Easy Dashboard';
	debug = false;
	database = [];
	folderSizing = 'col-12';
	columnSizing = 'col-12 col-sm-6';
	tabMode = true;
	showPaths = true;
	showProjectIcons = true;
	openOnNewWindow = true;
	openInNewWindow = false;
	fontSize = 'font-size-normal';
	rounded = true;
	projectsRoot = '';
	/** Filtre affichage vue complète (même logique que la barre latérale) */
	searchQuery = '';

	////////////////////////////////////////////////////////////////
	////////////////////////////////////////////////////////////////

	constructor() {
		this.init();
		return;
	};

	////////////////////////////////////////////////////////////////
	////////////////////////////////////////////////////////////////

	init() {

		this.vscode = acquireVsCodeApi();
		this.body = jQuery('body');
		this.elMain = jQuery('#Dashboard')
		this.elProjectBox = jQuery('#ProjectBox');
		this.elToolbar = jQuery('#Toolbar');
		this.elSearch = jQuery('#DashboardSearch');
		this.elMessageDebug = jQuery('#Debug');
		this.elApp = jQuery('#App');
		this.setDebug(this.debug);

		this.elSearch.attr('placeholder', t('Search for a project…'));
		this.elSearch.attr('aria-label', t('Search for a project'));

		this.template.folder = (
			(this.elProjectBox)
			.find('.FolderTemplate')
			.remove()
			.clone()
			.removeClass('d-none')
			.removeClass('FolderTemplate')
		);

		this.template.project = (
			(this.elProjectBox)
			.find('.ProjectTemplate')
			.remove()
			.clone()
			.removeClass('d-none')
			.removeClass('ProjectTemplate')
		);

		jQuery(window)
		.on('message', this.onMessage.bind(this));

		this.prepareUI();

		(this.vscode)
		.postMessage(new Message('hey'));

		return;
	};

	render() {

		if(!this.database)
		return;

		////////

		let self = this;

		(this.elApp)
		.removeClassEx(/^font-size-/)
		.removeClass('Rounded Squared')
		.addClass(this.fontSize ?? 'font-size-normal')
		.addClass(this.rounded ? 'Rounded' : 'Squared');


		this.renderProjectEntries();

		return;
	};

	normalizeFilter(raw) {
		return String(raw || '').trim().toLowerCase();
	}

	entryMatchesQuery(entry, qNorm) {
		if(!qNorm)
		return true;
		const name = (entry.name || '').toLowerCase();
		const path = (entry.path || '').toLowerCase();
		const desc = (entry.description || '').trim().toLowerCase();
		return name.includes(qNorm) || path.includes(qNorm) || (desc && desc.includes(qNorm));
	}

	folderNameMatchesQuery(folder, qNorm) {
		if(!qNorm)
		return true;
		return (folder.name || '').toLowerCase().includes(qNorm);
	}

	/** @param {any[]} items */
	filterItemsRaw(items, qNorm) {
		if(!qNorm)
		return items;
		const out = [];
		for(const item of items) {
			if(typeof item.path !== 'undefined') {
				if(this.entryMatchesQuery(item, qNorm))
				out.push(item);
			} else {
				const projects = item.projects || [];
				const childFiltered = this.filterItemsRaw(projects, qNorm);
				if(this.folderNameMatchesQuery(item, qNorm)) {
					out.push(item);
				} else if(childFiltered.length > 0) {
					out.push({ ...item, projects: childFiltered, open: true });
				}
			}
		}
		return out;
	}

	renderProjectEntries() {

		this.elProjectBox.empty();

		const qNorm = this.normalizeFilter(this.searchQuery);
		let items = this.database || [];

		if(qNorm)
		items = this.filterItemsRaw(items, qNorm);

		if(items.length === 0 && qNorm) {
			this.elProjectBox.append(
				jQuery('<div class="col-12 mb-3 text-muted">')
				.append(jQuery('<div class="font-weight-bold">').text(t('No results')))
				.append(jQuery('<div class="font-size-smallerer mt-1">').text(t('Try changing or clearing the search')))
			);
			return;
		}

		if(items.length === 0) {
			this.elProjectBox.append(
				jQuery('<div class="col-12 mb-3 text-muted">')
				.append(jQuery('<div class="font-weight-bold">').text(t('No projects yet')))
				.append(jQuery('<div class="font-size-smallerer mt-1">').text(t('Create a project or folder to get started.')))
			);
			return;
		}

		for(const item of items) {
			if(typeof item.path === 'undefined')
			this.elProjectBox.append((new Folder(this, item)).el);
			else
			this.elProjectBox.append((new Project(this, item)).el);
		}

		if(qNorm)
		this.elProjectBox.find('.Folder').addClass('Open');

		return;
	};

	send(msg) {

		(this.vscode)
		.postMessage(msg);

		return;
	};

	////////////////////////////////////////////////////////////////
	////////////////////////////////////////////////////////////////

	debugMessage(msg) {

		(this.elMessageDebug)
		.find('code')
		.empty()
		.text(JSON.stringify(msg, null, "\t"));

		console.log(msg);
		return;
	};

	setDebug(state) {

		this.debug = state;

		if(this.debug) {
			(this.elMessageDebug)
			.removeClass('d-none');
		}

		else {
			(this.elMessageDebug)
			.addClass('d-none');
		}

		return this;
	};

	prepareUI() {

		let self = this;

		jQuery('.CmdProjectNew')
		.on('click', function(){
			new ProjectNew(self);
			return false;
		});

		jQuery('.CmdFolderNew')
		.on('click', function(){
			new FolderNew(self);
			return false;
		});

		jQuery('.CmdDashboardConfig')
		.on('click', function(){
			new DashboardConfig(self);
			return false;
		});

		jQuery('.CmdCloseAll')
		.on('click', function(){
			//jQuery('.Folder')
			//.removeClass('Open');
			self.send(new Message('foldercloseall',{}));
			return false;
		});

		jQuery('.CmdOpenFullDashboard')
		.on('click', function(){
			self.send(new Message('openfulldashboard', {}));
			return false;
		});

		jQuery('.CmdOpenAll')
		.on('click', function(){
			//jQuery('.Folder')
			//.addClass('Open');
			self.send(new Message('folderopenall',{}));
			return false;
		});

		let searchDebounce;
		self.elSearch.on('input', function(){
			if(searchDebounce)
			clearTimeout(searchDebounce);
			searchDebounce = setTimeout(function(){
				self.searchQuery = self.elSearch.val() || '';
				self.renderProjectEntries();
			}, 150);
			return;
		});

		return;
	};

	////////////////////////////////////////////////////////////////
	////////////////////////////////////////////////////////////////

	onMessage(ev) {

		const raw = ev?.originalEvent?.data;
		if(!raw || typeof raw !== 'object' || typeof raw.type !== 'string') {
			return;
		}

		let msg = new Message(
			raw.type,
			raw.data
		);

		if(this.debug)
		this.debugMessage(msg);

		switch(msg.type) {
			case 'sup': this.onHeySup(msg); break;
			case 'render': this.onRender(msg); break;
			case 'dirpick': this.onDirPicked(msg); break;
			case 'projectsrootpick': this.onProjectsRootPicked(msg); break;
			case 'openprojectnew': this.onOpenProjectNew(msg); break;
			case 'projecticonpick': this.onProjectIconPicked(msg); break;
		}

		return;
	};

	onRender(msg) {

		this.render();
		return;
	};

	onHeySup(msg) {

		// copy in config info.

		for(const key in msg.data)
		if(key === 'i18n') {
			if(msg.data.i18n && typeof msg.data.i18n === 'object') {
				setI18nMap(msg.data.i18n);
				if(this.elSearch && this.elSearch.length) {
					this.elSearch.attr('placeholder', t('Search for a project…'));
					this.elSearch.attr('aria-label', t('Search for a project'));
				}
			}
		}
		else if(typeof this[key] !== 'undefined') {
			//console.log(`${key} = ${msg.data[key]}`);
			this[key] = msg.data[key];
		}

		// set debug.

		this.setDebug(msg.data.debug);

		if(this.debug)
		this.debugMessage(msg);

		// proceed.

		this.render();
		return;
	};

	onDirPicked(msg) {

		jQuery(document)
		.trigger('dirpick', msg.data);

		return;
	};

	onProjectsRootPicked(msg) {

		jQuery(document)
		.trigger('projectsrootpick', msg.data);

		return;
	};

	onOpenProjectNew(msg) {

		const parent = typeof msg.data?.parent === 'string' ? msg.data.parent : null;
		new ProjectNew(this, parent);

		return;
	};

	onProjectIconPicked(msg) {

		jQuery(document)
		.trigger('projecticonpick', [msg.data]);

		return;
	};

	////////////////////////////////////////////////////////////////
	////////////////////////////////////////////////////////////////

	static readableURI(input) {

		if(typeof input !== 'string')
		return '';

		if(input.match(/^file:/)) {
			let output = input.replace(/^file:\/\/\/?/,'');

			try {
				output = decodeURIComponent(output);
			} catch {
				// Keep the raw path if the URI contains an invalid percent escape.
			}

			if(navigator.platform.match(/^Win/))
			output = output.replace(/\//g,'\\');

			return output;
		}

		if(input.match(/^vscode-remote:/))
		return input.replace(/vscode-remote:\/\/(?:[a-z0-9\-]*\+)?/,'');

		return input;
	};

	static arrayFindById(input, whatYouSeek) {

		for(const item of input)
		if(typeof item.id !== 'undefined')
		if(item.id === whatYouSeek)
		return item;

		return null;
	};

	static findProject(input, whatYouSeek) {

		for(const item of input) {
			if(item.id === whatYouSeek)
			return item;

			if(typeof item.projects !== 'undefined') {
				let sub = Dashboard.findProject(
					item.projects,
					whatYouSeek
				);

				if(sub !== null)
				return sub;
			}
		}

		return null;
	};

};

export default Dashboard;
