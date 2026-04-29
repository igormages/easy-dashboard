import TemplatedDialog from './templated-dialog.js';
import Dashboard from './dashboard.js';
import Message from './message.js';
import Colours from './colours.js';
import Icons from './icons.js';
import { t } from './i18n.js';

let iconReqSeq = 0;

class ProjectConfig
extends TemplatedDialog {

	constructor(api, item) {
		super(api, '#TemplateProjectConfig');
		this.item = item;
		this.isProject = typeof item.path !== 'undefined';
		this.iconId = '';
		this.iconPngPath = '';
		this.iconPngUri = '';
		this.iconPickRequestId = '';
		this.bindElements();
		this.bindAccentPreset();
		if (this.isProject) {
			this.bindIconPickListener();
			this.bindPickIconButton();
		} else {
			this.bindIconPreset();
		}
		this.bindAcceptButton();
		this.bindCancelButton();
		this.fillConfigValues();
		this.show();
		return;
	};

	bindElements() {

		this.inputName = this.el.find('.Name');
		this.inputPath = this.el.find('.Path');
		this.inputDescription = this.el.find('.Description');
		this.inputAccent = this.el.find('.Accent');
		this.inputIcon = this.el.find('.FolderIconOptions .Icon');

		this.textTitlebar = this.el.find('.Titlebar');
		this.binAccent = this.el.find('.AccentPresets > optgroup');
		this.binIcon = this.el.find('.FolderIconOptions .IconPresets > optgroup');
		this.binFolderOptions = this.el.find('.FolderOptions');
		this.binProjectOptions = this.el.find('.ProjectOptions');
		this.binProjectExtras = this.el.find('.ProjectExtras');
		this.binFolderIconOptions = this.el.find('.FolderIconOptions');
		this.previewAccent = this.el.find('.AccentPreview');
		this.previewIcon = this.el.find('.FolderIconOptions .IconPreview');

		this.btnAccept = this.el.find('.Save');
		this.btnCancel = this.el.find('.Cancel');
		this.btnPickIcon = this.el.find('.PickIcon');
		this.elIconSummary = this.el.find('.IconSummary');
		this.elIconPreview = this.el.find('.PickIconPreview');

		return;
	};

	bindIconPickListener() {

		let self = this;

		jQuery(document)
		.on('projecticonpick.pcfgdlg', function(_ev, data){

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

		jQuery(document).off('projecticonpick.pcfgdlg');
		super.destroy();
		return;
	};

	bindAcceptButton() {

		let self = this;

		self.btnAccept
		.on('click',function(){
			let id = self.item.id;
			let name = self.inputName.tval();
			let accent = self.inputAccent.tval();
			let payload = { id, name, accent };

			if (self.isProject) {
				let path = self.inputPath.tval();
				payload.path = path;
				payload.description = self.inputDescription.tval().trim();
				if (self.iconPngPath) {
					payload.iconPngPath = self.iconPngPath;
					payload.icon = '';
				} else if (self.iconId) {
					payload.icon = self.iconId;
					payload.iconPngPath = '';
				} else {
					payload.icon = '';
					payload.iconPngPath = '';
				}
			} else {
				let icon = self.inputIcon.tval();
				payload.icon = icon;
			}

			self.api.send(new Message(
				'projectset',
				payload
			));

			self.destroy();
			return false;
		});

		return;
	};

	bindCancelButton() {

		this.btnCancel
		.on('click', this.destroy.bind(this));

		return;
	};

	bindAccentPreset() {

		let self = this;

		(self.binAccent.parent())
		.on('change', function(){
			let colour = jQuery(this).val();

			self.inputAccent.val(colour);
			self.previewAccent.css('color', colour);

			return;
		});

		(self.inputAccent)
		.on('keyup', function(){
			let colour = self.inputAccent.val();
			self.binAccent.parent().val('');
			self.previewAccent.css('color', colour);
			return;
		});

		return;
	};

	bindIconPreset() {

		let self = this;

		this.binIcon.parent()
		.on('change', function(){
			let icon = jQuery(this).val();

			self.inputIcon.val(icon);
			self.previewIcon.find('i').removeClassEx(/^codicon-/);
			self.previewIcon.find('i').addClass(icon);

			return;
		});

		this.inputIcon
		.on('keyup', function(){
			let icon = self.inputIcon.val();
			self.binIcon.parent().val('');
			self.previewIcon.find('i').removeClassEx(/^codicon-/);
			self.previewIcon.find('i').addClass(icon);
			return;
		});

		return;
	};

	fillConfigValues() {

		let config = Dashboard.findProject(
			this.api.database,
			this.item.id
		);

		if(config === null) {
			return;
		}

		this.inputName.val(config.name);
		this.inputPath.val(config.path ?? '');
		this.inputDescription.val(config.description ?? '');
		this.inputAccent.val(config.accent);
		if (!this.isProject) {
			this.inputIcon.val(config.icon);
		}

		this.binAccent.empty();
		if (!this.isProject) {
			this.binIcon.empty();
		}

		for(const colour in Colours)
		this.binAccent.append(
			jQuery('<option />')
			.text(colour)
			.val(Colours[colour])
			.css('color', Colours[colour])
		);

		if (!this.isProject) {
			for(const icon in Icons)
			this.binIcon.append(
				jQuery('<option />')
				.html(`<i class="codicon ${icon}"></i> ${icon}`)
				.val(Icons[icon])
			);
		} else {
			this.iconId = config.icon || '';
			this.iconPngPath = config.iconPngPath || '';
			this.iconPngUri = config.iconPngUri || '';
			this.updateIconSummary();
		}

		return;
	};

	show() {

		this.inputAccent
		.trigger('keyup');

		if (!this.isProject) {
			this.inputIcon.trigger('keyup');
		}

		if(!this.isProject) {
			this.binProjectOptions.hide();
			this.binProjectExtras.hide();
			this.textTitlebar.text(t('Folder settings'));
		}

		else {
			this.binFolderIconOptions.hide();
		}

		super.show();
		return;
	};

};

export default ProjectConfig;
