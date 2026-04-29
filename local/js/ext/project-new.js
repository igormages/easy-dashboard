import TemplatedDialog from "./templated-dialog.js";
import Message from "./message.js";
import { t } from './i18n.js';

let iconReqSeq = 0;

class ProjectNew
extends TemplatedDialog {

	constructor(api, parent=null) {
		super(api, '#TemplateProjectNew');
		this.parent = parent;
		this.iconId = '';
		this.iconPngPath = '';
		this.iconPngUri = '';
		this.iconPickRequestId = '';
		this.bindElements();
		this.bindTypeSelector();
		this.bindSaveButton();
		this.bindFolderChooser();
		this.bindIconPickListener();
		this.bindPickIconButton();
		this.show();
		return;
	};

	bindElements() {

		this.typeSelector = this.el.find('.TypeSelector');
		this.inputName = this.el.find('.Name');
		this.inputDescription = this.el.find('.Description');
		this.rowDiskFolder = this.el.find('.RowDiskFolderName');
		this.inputDiskFolder = this.el.find('.DiskFolderName');
		this.inputSshUser = this.el.find('.ShellUser');
		this.inputSshHost = this.el.find('.ShellHost');
		this.inputSshPath = this.el.find('.ShellPath');
		this.inputPromode = this.el.find('.Promode');
		this.btnChooser = this.el.find('.Chooser');
		this.btnSave = this.el.find('.Save');
		this.btnPickIcon = this.el.find('.PickIcon');
		this.elIconSummary = this.el.find('.IconSummary');
		this.elIconPreview = this.el.find('.IconPreview');

		return;
	};

	bindIconPickListener() {

		let self = this;

		jQuery(document)
		.on('projecticonpick.pndlg', function(_ev, data){

			if(!self.el || !self.el.length || !jQuery.contains(document.documentElement, self.el[0]))
			return;

			if(typeof data?.requestId !== 'string' || data.requestId !== self.iconPickRequestId)
			return;

			self.iconId = data.icon || '';
			self.iconPngPath = data.iconPngPath || '';
			self.iconPngUri = data.iconPngUri || '';
			self.updateIconSummary();
			return;
		});

		return;
	};

	bindPickIconButton() {

		let self = this;

		this.btnPickIcon
		.on('click', function(){
			self.iconPickRequestId = String(++iconReqSeq);
			self.api.send(new Message('pickprojecticon', { requestId: self.iconPickRequestId }));
			return;
		});

		return;
	};

	updateIconSummary() {

		this.elIconPreview.addClass('d-none').empty();

		if(this.iconPngPath && this.iconPngUri) {
			this.elIconSummary.text(t('PNG image'));
			this.elIconPreview
			.removeClass('d-none')
			.append(
				jQuery('<img />')
				.attr('src', this.iconPngUri)
				.attr('alt', '')
				.css({ width: '1.25em', height: '1.25em', objectFit: 'contain' })
			);
			return;
		}

		if(this.iconId) {
			this.elIconSummary.text(`${t('Icon')}: ${this.iconId}`);
			return;
		}

		this.elIconSummary.text(t('No icon'));
		return;
	};

	destroy() {

		jQuery(document).off('projecticonpick.pndlg');
		super.destroy();
		return;
	};

	bindTypeSelector() {

		let self = this;

		this.typeSelector
		.find('.btn')
		.on('click', function(){

			let that = jQuery(this);
			let type = that.attr('data-type');

			// dedcide which button is lit.

			self.typeSelector
			.find('.btn')
			.addClass('btn-dark')
			.removeClass('btn-primary');

			that
			.addClass('btn-primary')
			.removeClass('btn-dark');

			// display the selected type input form.

			(self.el.find('.TypeNewForm'))
			.addClass('d-none');

			(self.el.find(that.attr('data-show')))
			.removeClass('d-none');

			// allow progress when type is selected and make note of.

			(self.el.find('footer'))
			.removeClass('d-none');

			self.typeSelector
			.attr('data-selected', type);

			// reset the file chooser.

			self.setDirectory(null);

			self.syncDiskFolderRow();

			return;
		});

		this.inputName.on('input', () => {
			self.syncDiskFolderFromName();
		});

		this.inputDiskFolder.on('input', () => {
			self.inputDiskFolder.data('userEdited', true);
		});

		return;
	};

	syncDiskFolderFromName() {
		if (!this.api.projectsRoot) {
			return;
		}
		if (this.inputDiskFolder.data('userEdited')) {
			return;
		}
		const n = this.inputName.tval();
		if (n) {
			this.inputDiskFolder.val(n);
		}
	}

	syncDiskFolderRow() {
		const type = this.typeSelector.attr('data-selected');
		const show = !!this.api.projectsRoot && type === 'local';
		this.rowDiskFolder.toggleClass('d-none', !show);
		if (show) {
			this.syncDiskFolderFromName();
		}
	}

	bindSaveButton() {

		let self = this;

		this.btnSave
		.on('click',function(){

			let type = self.typeSelector.attr('data-selected');
			let name = self.inputName.tval();
			let uri = null;
			let parent = self.parent;
			let createUnderRoot = false;
			let diskFolderName = '';

			switch(type) {
				case 'local':
					uri = jQuery.trim(self.btnChooser.attr('data-uri'));
					if (!uri && self.api.projectsRoot) {
						createUnderRoot = true;
						diskFolderName = self.inputDiskFolder.tval() || name;
					}
				break;
				case 'ssh':
					let host = self.inputSshHost.tval();
					let user = self.inputSshUser.tval();
					let path = self.inputSshPath.tval();
					uri = `vscode-remote://ssh-remote+${user}@${host}${path}`;
				break;
				case 'promode':
					uri = self.inputPromode.tval();
				break;
			}

			if((uri === null || uri === '') && !createUnderRoot)
			return;

			if(!name)
			return;

			let description = self.inputDescription.tval().trim();

			(self.el.find('.Close'))
			.trigger('click');

			let payload = { name, parent };
			if (description) {
				payload.description = description;
			}
			if (self.iconPngPath) {
				payload.iconPngPath = self.iconPngPath;
			}
			if (self.iconId) {
				payload.icon = self.iconId;
			}

			if (createUnderRoot) {
				self.api.send(new Message('projectnew', {
					...payload,
					createUnderRoot: true,
					diskFolderName,
				}));
			} else {
				self.api.send(new Message('projectnew', {
					...payload,
					uri,
				}));
			}
			return;
		});

		return;
	};

	bindFolderChooser() {

		let self = this;

		jQuery(document)
		.on('dirpick', function(ev, data){

			if(typeof data.label !== 'string')
			return;

			if(typeof data.uri !== 'string')
			return;

			self.setDirectory(data);
			return;
		});

		self.btnChooser
		.on('click', function(){
			self.api.send(new Message('pickdir'));
			return;
		});

		return;
	};

	setDirectory(input) {

		if(input === null) {
			this.btnChooser
			.removeClass('cased')
			.text(this.btnChooser.attr('data-default'))
			.attr('data-uri', '');

			this.inputDiskFolder.removeData('userEdited');
			this.syncDiskFolderFromName();

			return;
		}

		if(this.inputName.tval() === '')
		this.inputName.val(input.uri.split(/[\/\\]/).pop());

		this.inputDiskFolder.data('userEdited', true);

		this.btnChooser
		.addClass('cased')
		.text(input.label)
		.attr('data-uri', input.uri);

		return;
	};

	show() {

		this.setDirectory(null);
		this.inputName.val('');
		this.inputDescription.val('');
		this.inputDiskFolder.val('');
		this.inputDiskFolder.removeData('userEdited');
		this.inputSshHost.val('');
		this.inputSshUser.val('');
		this.inputSshPath.val('');
		this.inputPromode.val('');
		this.iconId = '';
		this.iconPngPath = '';
		this.iconPngUri = '';
		this.iconPickRequestId = '';
		this.updateIconSummary();

		super.show();
		this.syncDiskFolderRow();
		return;
	};
};

export default ProjectNew;
