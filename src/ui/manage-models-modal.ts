import { Modal, Setting, Notice, ButtonComponent } from 'obsidian';
import ImageCapturePlugin from '../main';
import { ModelConfig, ModelSettings, LLM_PROVIDERS, DEFAULT_MODEL_SETTINGS } from '../types';
import { t } from '../i18n';

export class ManageModelsModal extends Modal {
	private plugin: ImageCapturePlugin;

	constructor(plugin: ImageCapturePlugin) {
		super(plugin.app);
		this.plugin = plugin;
		this.modalEl.addClass('manage-models-modal');
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// Modal header
		const headerEl = contentEl.createEl('div', { cls: 'modal-header' });
		headerEl.createEl('h2', { text: t('ui.manageModels') });
		headerEl.createEl('p', { 
			text: t('manageModels.description'),
			cls: 'modal-description'
		});

		// Models container
		const modelsEl = contentEl.createEl('div', { cls: 'models-container' });

		if (this.plugin.settings.modelConfigs.length === 0) {
			// Simplified empty state
			const emptyEl = modelsEl.createEl('div', { cls: 'empty-state' });
			
			// Icon container
			const iconEl = emptyEl.createEl('div', { cls: 'empty-icon' });
			iconEl.innerHTML = `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;
			
			// Title and description
			emptyEl.createEl('h3', { text: t('ui.noModelsConfigured') });
			emptyEl.createEl('p', { text: t('ui.useSetKeysToAdd') });
		} else {
			// Add class for styling when there are models
			modelsEl.addClass('has-models');
			// Render model configs
			this.plugin.settings.modelConfigs.forEach((modelConfig, index) => {
				this.createModelConfigItem(modelsEl, modelConfig, index);
			});
		}

		// Add custom styles
		this.addStyles();
	}

	private createModelConfigItem(container: HTMLElement, modelConfig: ModelConfig, index: number) {
		const itemEl = container.createEl('div', { cls: 'model-config-item' });
		
		// Header with model info and actions
		const headerEl = itemEl.createEl('div', { cls: 'model-header' });
		
		const infoEl = headerEl.createEl('div', { cls: 'model-info' });
		infoEl.createEl('h3', { text: modelConfig.name, cls: 'model-name' });
		
		const metaEl = infoEl.createEl('div', { cls: 'model-meta' });
		const provider = LLM_PROVIDERS.find(p => p.id === modelConfig.providerId);
		if (provider) {
			let providerDisplayName = provider.displayName;
			
			// For custom providers, always show "Custom" as the source in the badge
			// The actual provider name is stored in the model's display name
			if (provider.id === 'custom') {
				providerDisplayName = 'Custom';
			}
			
			metaEl.createEl('span', { text: t('manageModels.providerBadge', { providerName: providerDisplayName }), cls: 'provider-badge' });
		}
		if (modelConfig.isVisionCapable) {
			const visionIcon = metaEl.createEl('span', { cls: 'vision-badge vision-icon' });
			// Using Lucide Eye icon with purple color
			visionIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
		}
		if (modelConfig.id === this.plugin.settings.defaultModelConfigId) {
			metaEl.createEl('span', { text: t('manageModels.defaultBadge'), cls: 'default-badge' });
		}

		// Action buttons
		const actionsEl = headerEl.createEl('div', { cls: 'model-actions' });
		
		// Set as default button
		if (modelConfig.id !== this.plugin.settings.defaultModelConfigId) {
			const defaultBtn = actionsEl.createEl('button', { text: t('manageModels.setDefaultButton'), cls: 'default-btn' });
			defaultBtn.addEventListener('click', async () => {
				this.plugin.settings.defaultModelConfigId = modelConfig.id;
				await this.plugin.saveSettings();
				new Notice(t('manageModels.setAsDefaultSuccess', { modelName: modelConfig.name }));
				this.refresh();
			});
		}

		// Delete button
		const deleteBtn = actionsEl.createEl('button', { text: t('manageModels.deleteButton'), cls: 'delete-btn' });
		deleteBtn.title = t('manageModels.deleteButtonTitle');
		deleteBtn.addEventListener('click', () => this.confirmDelete(modelConfig, index));

		// Settings toggle button
		const toggleBtn = actionsEl.createEl('button', { text: t('manageModels.configureButton'), cls: 'toggle-settings-btn' });
		toggleBtn.title = t('manageModels.configureButtonTitle');

		// Expandable settings section
		const settingsEl = itemEl.createEl('div', { cls: 'model-settings' });
		
		let isExpanded = false;
		toggleBtn.addEventListener('click', () => {
			isExpanded = !isExpanded;
			if (isExpanded) {
				settingsEl.style.display = 'block';
				toggleBtn.textContent = '⚙️';
				toggleBtn.classList.add('expanded');
				this.renderModelSettings(settingsEl, modelConfig);
			} else {
				settingsEl.style.display = 'none';
				toggleBtn.textContent = '⚙️';
				toggleBtn.classList.remove('expanded');
			}
		});

		settingsEl.style.display = 'none';
	}

	private renderModelSettings(container: HTMLElement, modelConfig: ModelConfig) {
		container.empty();

		const settingsForm = container.createEl('div', { cls: 'settings-form' });

		// Max Tokens
		new Setting(settingsForm)
			.setName(t('manageModels.maxTokensLabel'))
			.setDesc(t('manageModels.maxTokensDescription'))
			.addText(text => text
				.setPlaceholder(t('manageModels.maxTokensPlaceholder'))
				.setValue(modelConfig.settings.maxTokens.toString())
				.onChange(async (value) => {
					const numValue = parseInt(value);
					if (!isNaN(numValue) && numValue > 0) {
						console.log(`Updating maxTokens for model ${modelConfig.id} from ${modelConfig.settings.maxTokens} to ${numValue}`);
						modelConfig.settings.maxTokens = numValue;
						await this.plugin.saveSettings();
						console.log(`MaxTokens saved successfully for model ${modelConfig.id}`);
					}
				}));

		// Temperature
		new Setting(settingsForm)
			.setName(t('manageModels.temperatureLabel'))
			.setDesc(t('manageModels.temperatureDescription'))
			.addSlider(slider => slider
				.setLimits(0, 1, 0.1)
				.setValue(modelConfig.settings.temperature)
				.setDynamicTooltip()
				.onChange(async (value) => {
					modelConfig.settings.temperature = value;
					await this.plugin.saveSettings();
				}));

		// Top P
		if (modelConfig.settings.topP !== undefined) {
			new Setting(settingsForm)
				.setName(t('manageModels.topPLabel'))
				.setDesc(t('manageModels.topPDescription'))
				.addSlider(slider => slider
					.setLimits(0, 1, 0.1)
					.setValue(modelConfig.settings.topP || 1)
					.setDynamicTooltip()
					.onChange(async (value) => {
						modelConfig.settings.topP = value;
						await this.plugin.saveSettings();
					}));
		}

		// Frequency Penalty
		if (modelConfig.settings.frequencyPenalty !== undefined) {
			new Setting(settingsForm)
				.setName(t('manageModels.frequencyPenaltyLabel'))
				.setDesc(t('manageModels.frequencyPenaltyDescription'))
				.addSlider(slider => slider
					.setLimits(-2, 2, 0.1)
					.setValue(modelConfig.settings.frequencyPenalty || 0)
					.setDynamicTooltip()
					.onChange(async (value) => {
						modelConfig.settings.frequencyPenalty = value;
						await this.plugin.saveSettings();
					}));
		}

		// Presence Penalty
		if (modelConfig.settings.presencePenalty !== undefined) {
			new Setting(settingsForm)
				.setName(t('manageModels.presencePenaltyLabel'))
				.setDesc(t('manageModels.presencePenaltyDescription'))
				.addSlider(slider => slider
					.setLimits(-2, 2, 0.1)
					.setValue(modelConfig.settings.presencePenalty || 0)
					.setDynamicTooltip()
					.onChange(async (value) => {
						modelConfig.settings.presencePenalty = value;
						await this.plugin.saveSettings();
					}));
		}

		// Max Response Time
		new Setting(settingsForm)
			.setName(t('manageModels.maxResponseTimeLabel'))
			.setDesc(t('manageModels.maxResponseTimeDescription'))
			.addText(text => text
				.setPlaceholder(t('manageModels.maxResponseTimePlaceholder'))
				.setValue(modelConfig.settings.maxResponseTime.toString())
				.onChange(async (value) => {
					const numValue = parseInt(value);
					if (!isNaN(numValue) && numValue > 0) {
						modelConfig.settings.maxResponseTime = numValue;
						await this.plugin.saveSettings();
					}
				}));

		// System Prompt
		new Setting(settingsForm)
			.setName(t('manageModels.systemPromptLabel'))
			.setDesc(t('manageModels.systemPromptDescription'))
			.addTextArea(text => text
				.setPlaceholder(t('manageModels.systemPromptPlaceholder'))
				.setValue(modelConfig.settings.systemPrompt || '')
				.onChange(async (value) => {
					modelConfig.settings.systemPrompt = value;
					await this.plugin.saveSettings();
				}));

		// Reset to defaults button
		const resetBtn = settingsForm.createEl('button', { 
			text: t('manageModels.resetToDefaultsButton'),
			cls: 'reset-btn'
		});
		resetBtn.addEventListener('click', async () => {
			modelConfig.settings = { ...DEFAULT_MODEL_SETTINGS };
			await this.plugin.saveSettings();
			new Notice(t('manageModels.settingsResetSuccess'));
			this.renderModelSettings(container, modelConfig);
		});
	}

	private confirmDelete(modelConfig: ModelConfig, index: number) {
		const modal = new ConfirmDeleteModal(this.plugin, modelConfig, () => {
			// Remove from settings
			this.plugin.settings.modelConfigs.splice(index, 1);
			
			// If this was the default model, clear the default or set to first available model
			if (this.plugin.settings.defaultModelConfigId === modelConfig.id) {
				// Find another model to set as default (prefer vision-capable, but any will do)
				const visionModel = this.plugin.settings.modelConfigs.find(mc => mc.isVisionCapable);
				const anyModel = this.plugin.settings.modelConfigs[0];
				this.plugin.settings.defaultModelConfigId = visionModel?.id || anyModel?.id || '';
			}
			
			this.plugin.saveSettings();
			new Notice(t('manageModels.deletedSuccessfully', { modelName: modelConfig.name }));
			
			// Only refresh other components after a delete operation (when it's necessary)
			this.refreshModelDependentComponents();
			this.refresh();
		});
		modal.open();
	}

	private refresh() {
		// Just refresh this modal without affecting other components
		this.close();
		setTimeout(() => {
			const newModal = new ManageModelsModal(this.plugin);
			newModal.open();
		}, 100);
	}

	private refreshModelDependentComponents() {
		// Refresh settings tab by finding the settings tab instance and calling display()
		const app = this.plugin.app as any;
		if (app.setting && app.setting.pluginTabs) {
			const pluginTab = app.setting.pluginTabs.find((tab: any) => 
				tab.id === this.plugin.manifest.id
			);
			if (pluginTab && typeof pluginTab.display === 'function') {
				// Refresh the settings tab if it's currently active
				pluginTab.display();
			}
		}

		// Refresh AI chat views - use gentle update without forcing full rebuild
		const aiChatLeaves = this.plugin.app.workspace.getLeavesOfType('ai-chat');
		aiChatLeaves.forEach(leaf => {
			const view = leaf.view as any;
			if (view && typeof view.updateContent === 'function') {
				// Just call updateContent without clearing the container
				// This will preserve existing structure and only update necessary parts
				view.updateContent();
			}
		});
	}

	private addStyles() {
		if (!document.getElementById('manage-models-styles')) {
			const style = document.createElement('style');
			style.id = 'manage-models-styles';
			style.textContent = `
				.manage-models-modal {
					width: 700px;
					max-width: 90vw;
					min-height: 300px;
					max-height: 80vh;
				}

				.manage-models-modal .modal-content {
					padding: 24px;
					position: relative;
				}

				.modal-header {
					margin-bottom: 20px;
					text-align: center;
				}

				.modal-header h2 {
					margin: 0 0 8px 0;
					font-size: 24px;
				}

				.modal-description {
					margin: 0;
					color: var(--text-muted);
					font-size: 14px;
				}

				.models-container {
					max-height: 600px;
				}

				.models-container.has-models {
					overflow-y: auto;
					padding-right: 8px;
				}

				.empty-state {
					text-align: center;
					padding: 60px 20px;
					color: var(--text-muted);
					margin: 40px 0;
				}

				.empty-icon {
					display: flex;
					justify-content: center;
					align-items: center;
					margin-bottom: 20px;
					color: var(--text-muted);
					opacity: 0.6;
				}

				.empty-icon svg {
					width: 48px;
					height: 48px;
					stroke: var(--text-muted);
				}

				.empty-state h3 {
					margin: 0 0 12px 0;
					color: var(--text-normal);
					font-size: 18px;
					font-weight: 600;
				}

				.empty-state p {
					margin: 0;
					font-size: 14px;
					line-height: 1.4;
					color: var(--text-muted);
				}

				.model-config-item {
					border: 1px solid var(--background-modifier-border);
					border-radius: 8px;
					padding: 16px;
					margin-bottom: 16px;
					background: var(--background-secondary);
				}

				.model-header {
					display: flex;
					justify-content: space-between;
					align-items: flex-start;
					margin-bottom: 12px;
				}

				.manage-models-modal .model-info {
					flex: 1;
				}

				.manage-models-modal .model-name {
					margin: 0 0 8px 0;
					font-size: 16px;
					color: var(--text-normal);
				}

				.manage-models-modal .model-meta {
					display: flex;
					gap: 8px;
					flex-wrap: wrap;
				}

				.provider-badge, .vision-badge, .default-badge {
					font-size: 11px;
					padding: 2px 6px;
					border-radius: 3px;
					background: var(--background-modifier-border);
					color: var(--text-muted);
				}

				.vision-badge {
					background: transparent;
					color: #8b5cf6;
					border: none;
					padding: 2px;
					display: inline-flex;
					align-items: center;
				}

				.vision-badge.vision-icon svg {
					width: 14px;
					height: 14px;
					stroke: #8b5cf6;
				}

				.default-badge {
					background: var(--interactive-accent);
					color: white;
				}

				.manage-models-modal .model-actions {
					display: flex;
					gap: 8px;
				}

				.manage-models-modal .default-btn, .manage-models-modal .delete-btn .reset-btn{
					padding: 6px 12px;
					border: 1px solid var(--background-modifier-border);
					border-radius: 4px;
					background: var(--background-primary);
					color: var(--text-normal);
					cursor: pointer;
					font-size: 12px;
				}

				.manage-models-modal .default-btn:hover {
					background: var(--interactive-accent);
					color: var(--text-on-accent);
				}

				.manage-models-modal .delete-btn .reset-btn:hover {
					background: var(--interactive-critical);
					color: white;
				}

				.toggle-settings-btn {
					width: 100%;
					padding: 8px;
					border: 1px solid var(--background-modifier-border);
					border-radius: 4px;
					background: var(--background-primary);
					color: var(--text-normal);
					cursor: pointer;
					font-size: 13px;
					margin-bottom: 12px;
				}

				.toggle-settings-btn:hover {
					background: var(--background-modifier-hover);
				}

				.model-settings {
					border-top: 1px solid var(--background-modifier-border);
					padding-top: 16px;
				}

				.settings-form {
					display: flex;
					flex-direction: column;
					gap: 8px;
				}

			`;
			document.head.appendChild(style);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		
		// Refresh AI chat views when modal closes
		const aiChatLeaves = this.plugin.app.workspace.getLeavesOfType('ai-chat');
		aiChatLeaves.forEach(leaf => {
			const view = leaf.view as any;
			if (view && typeof view.updateContent === 'function') {
				view.updateContent();
			}
		});
	}
}

class ConfirmDeleteModal extends Modal {
	private plugin: ImageCapturePlugin;
	private modelConfig: ModelConfig;
	private onConfirm: () => void;

	constructor(plugin: ImageCapturePlugin, modelConfig: ModelConfig, onConfirm: () => void) {
		super(plugin.app);
		this.plugin = plugin;
		this.modelConfig = modelConfig;
		this.onConfirm = onConfirm;
		this.modalEl.addClass('confirm-delete-modal');
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h3', { text: t('manageModels.confirmDeleteTitle') });
		contentEl.createEl('p', { 
			text: t('manageModels.confirmDeleteMessage', { modelName: this.modelConfig.name })
		});

		const buttonsEl = contentEl.createEl('div', { cls: 'button-group' });
		
		const cancelBtn = buttonsEl.createEl('button', { text: t('manageModels.confirmDeleteCancel'), cls: 'cancel-btn' });
		cancelBtn.addEventListener('click', () => this.close());

		const deleteBtn = buttonsEl.createEl('button', { text: t('manageModels.confirmDeleteConfirm'), cls: 'delete-btn' });
		deleteBtn.addEventListener('click', () => {
			this.onConfirm();
			this.close();
		});

		// Add styles
		if (!document.getElementById('confirm-delete-styles')) {
			const style = document.createElement('style');
			style.id = 'confirm-delete-styles';
			style.textContent = `
				.confirm-delete-modal {
					width: 400px;
				}

				.button-group {
					display: flex;
					gap: 12px;
					justify-content: flex-end;
					margin-top: 20px;
				}

				.confirm-delete-modal .cancel-btn, .confirm-delete-modal .delete-btn {
					padding: 8px 16px;
					border: 1px solid var(--background-modifier-border);
					border-radius: 4px;
					cursor: pointer;
					font-size: 13px;
				}

				.confirm-delete-modal .cancel-btn {
					background: var(--background-primary);
					color: var(--text-normal);
				}

				.confirm-delete-modal .cancel-btn:hover {
					background: var(--background-modifier-hover);
				}

				.confirm-delete-modal .delete-btn {
					background: #dc3545;
					color: #ffffff;
					border: 1px solid #dc3545;
				}

				.confirm-delete-modal .delete-btn:hover {
					background: #c82333;
					border-color: #c82333;
					color: #ffffff;
				}

				/* Dark theme specific overrides */
				.theme-dark .confirm-delete-modal .delete-btn {
					background: #e74c3c;
					color: #ffffff;
					border-color: #e74c3c;
				}

				.theme-dark .confirm-delete-modal .delete-btn:hover {
					background: #c0392b;
					border-color: #c0392b;
					color: #ffffff;
				}
			`;
			document.head.appendChild(style);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}