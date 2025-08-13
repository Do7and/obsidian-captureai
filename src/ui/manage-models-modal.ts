import { Modal, Setting, Notice, setIcon  } from 'obsidian';
import ImageCapturePlugin from '../main';
import { ModelConfig, ModelSettings, LLM_PROVIDERS, DEFAULT_MODEL_SETTINGS } from '../types';
import { t } from '../i18n';
import { getLogger } from '../utils/logger';

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

		// Create fixed header modal structure
		contentEl.addClass('modal-with-fixed-header');
		
		// Create fixed header
		const headerEl = contentEl.createEl('div', { cls: 'modal-fixed-header' });
		
		// Header content
		const headerContent = headerEl.createEl('div', { cls: 'modal-header' });
		headerContent.createEl('h2', { text: t('ui.manageModels') });
		headerContent.createEl('p', { 
			text: t('manageModels.description'),
			cls: 'modal-description'
		});
		
		// Create scrollable content area
		const scrollableContent = contentEl.createEl('div', { cls: 'modal-scrollable-content' });
		
		// Models container (now in scrollable area)
		const modelsEl = scrollableContent.createEl('div', { cls: 'models-container' });

		if (this.plugin.settings.modelConfigs.length === 0) {
			// Simplified empty state
			const emptyEl = modelsEl.createEl('div', { cls: 'empty-state' });
			
			// Icon container
			const iconEl = emptyEl.createEl('div', { cls: 'empty-icon' });
			setIcon(iconEl, 'settings');
			
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
			setIcon(visionIcon, 'eye');
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
		const deleteBtn = actionsEl.createEl('button', { cls: 'delete-btn' });
		setIcon(deleteBtn, 'trash-2');
		deleteBtn.title = t('manageModels.deleteButtonTitle');
		deleteBtn.addEventListener('click', () => this.confirmDelete(modelConfig, index));

		// Settings toggle button
		const toggleBtn = actionsEl.createEl('button', { cls: 'toggle-settings-btn' });
		setIcon(toggleBtn, 'settings');
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
						getLogger().log(`Updating maxTokens for model ${modelConfig.id} from ${modelConfig.settings.maxTokens} to ${numValue}`);
						modelConfig.settings.maxTokens = numValue;
						await this.plugin.saveSettings();
						getLogger().log(`MaxTokens saved successfully for model ${modelConfig.id}`);
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

		// Create fixed header modal structure
		contentEl.addClass('modal-with-fixed-header');
		
		// Create fixed header
		const headerEl = contentEl.createEl('div', { cls: 'modal-fixed-header' });
		
		// Header content
		const headerContent = headerEl.createEl('div', { cls: 'modal-header' });
		headerContent.createEl('h3', { text: t('manageModels.confirmDeleteTitle') });
		
		// Create scrollable content area
		const scrollableContent = contentEl.createEl('div', { cls: 'modal-scrollable-content' });
		
		scrollableContent.createEl('p', { 
			text: t('manageModels.confirmDeleteMessage', { modelName: this.modelConfig.name })
		});

		const buttonsEl = scrollableContent.createEl('div', { cls: 'button-group' });
		
		const cancelBtn = buttonsEl.createEl('button', { text: t('manageModels.confirmDeleteCancel'), cls: 'cancel-btn' });
		cancelBtn.addEventListener('click', () => this.close());

		const deleteBtn = buttonsEl.createEl('button', { text: t('manageModels.confirmDeleteConfirm'), cls: 'delete-btn' });
		deleteBtn.addEventListener('click', () => {
			this.onConfirm();
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}