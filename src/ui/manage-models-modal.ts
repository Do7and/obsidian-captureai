import { Modal, Setting, Notice, ButtonComponent } from 'obsidian';
import ImageCapturePlugin from '../main';
import { ModelConfig, ModelSettings, LLM_PROVIDERS, DEFAULT_MODEL_SETTINGS } from '../types';

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
		headerEl.createEl('h2', { text: 'Manage Models' });
		headerEl.createEl('p', { 
			text: 'Configure and manage your AI model configurations.',
			cls: 'modal-description'
		});

		// Models container
		const modelsEl = contentEl.createEl('div', { cls: 'models-container' });

		if (this.plugin.settings.modelConfigs.length === 0) {
			// Empty state
			const emptyEl = modelsEl.createEl('div', { cls: 'empty-state' });
			emptyEl.createEl('div', { text: '🤖', cls: 'empty-icon' });
			emptyEl.createEl('h3', { text: 'No Models Configured' });
			emptyEl.createEl('p', { text: 'Use "Set Keys" to add API keys and configure models.' });
		} else {
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
			metaEl.createEl('span', { text: provider.displayName, cls: 'provider-badge' });
		}
		if (modelConfig.isVisionCapable) {
			metaEl.createEl('span', { text: 'Vision', cls: 'vision-badge' });
		}
		if (modelConfig.id === this.plugin.settings.defaultModelConfigId) {
			metaEl.createEl('span', { text: 'Default', cls: 'default-badge' });
		}

		// Action buttons
		const actionsEl = headerEl.createEl('div', { cls: 'model-actions' });
		
		// Set as default button
		if (modelConfig.id !== this.plugin.settings.defaultModelConfigId && modelConfig.isVisionCapable) {
			const defaultBtn = actionsEl.createEl('button', { text: 'Set Default', cls: 'default-btn' });
			defaultBtn.addEventListener('click', async () => {
				this.plugin.settings.defaultModelConfigId = modelConfig.id;
				await this.plugin.saveSettings();
				new Notice(`✅ Set ${modelConfig.name} as default model`);
				this.refresh();
			});
		}

		// Delete button
		const deleteBtn = actionsEl.createEl('button', { text: '🗑️', cls: 'delete-btn' });
		deleteBtn.title = 'Delete this model configuration';
		deleteBtn.addEventListener('click', () => this.confirmDelete(modelConfig, index));

		// Settings toggle button
		const toggleBtn = actionsEl.createEl('button', { text: '⚙️', cls: 'toggle-settings-btn' });
		toggleBtn.title = 'Configure model settings';

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
			.setName('Max Tokens')
			.setDesc('Maximum number of tokens for responses')
			.addText(text => text
				.setPlaceholder('4000')
				.setValue(modelConfig.settings.maxTokens.toString())
				.onChange(async (value) => {
					const numValue = parseInt(value);
					if (!isNaN(numValue) && numValue > 0) {
						modelConfig.settings.maxTokens = numValue;
						await this.plugin.saveSettings();
					}
				}));

		// Temperature
		new Setting(settingsForm)
			.setName('Temperature')
			.setDesc('Controls randomness (0.0 = deterministic, 1.0 = very creative)')
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
				.setName('Top P')
				.setDesc('Nucleus sampling parameter')
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
				.setName('Frequency Penalty')
				.setDesc('Reduces repetition of tokens')
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
				.setName('Presence Penalty')
				.setDesc('Reduces repetition of topics')
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
			.setName('Max Response Time')
			.setDesc('Maximum time to wait for response (seconds)')
			.addText(text => text
				.setPlaceholder('30')
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
			.setName('System Prompt')
			.setDesc('Custom system prompt for this model (optional)')
			.addTextArea(text => text
				.setPlaceholder('Enter custom system prompt...')
				.setValue(modelConfig.settings.systemPrompt || '')
				.onChange(async (value) => {
					modelConfig.settings.systemPrompt = value;
					await this.plugin.saveSettings();
				}));

		// Reset to defaults button
		const resetBtn = settingsForm.createEl('button', { 
			text: 'Reset to Defaults',
			cls: 'reset-btn'
		});
		resetBtn.addEventListener('click', async () => {
			modelConfig.settings = { ...DEFAULT_MODEL_SETTINGS };
			await this.plugin.saveSettings();
			new Notice('✅ Settings reset to defaults');
			this.renderModelSettings(container, modelConfig);
		});
	}

	private confirmDelete(modelConfig: ModelConfig, index: number) {
		const modal = new ConfirmDeleteModal(this.plugin, modelConfig, () => {
			// Remove from settings
			this.plugin.settings.modelConfigs.splice(index, 1);
			
			// If this was the default model, clear the default
			if (this.plugin.settings.defaultModelConfigId === modelConfig.id) {
				// Find another vision-capable model to set as default
				const nextDefault = this.plugin.settings.modelConfigs.find(mc => mc.isVisionCapable);
				this.plugin.settings.defaultModelConfigId = nextDefault?.id || '';
			}
			
			this.plugin.saveSettings();
			new Notice(`✅ Deleted ${modelConfig.name}`);
			this.refresh();
		});
		modal.open();
	}

	private refresh() {
		this.close();
		setTimeout(() => {
			const newModal = new ManageModelsModal(this.plugin);
			newModal.open();
		}, 100);
	}

	private addStyles() {
		if (!document.getElementById('manage-models-styles')) {
			const style = document.createElement('style');
			style.id = 'manage-models-styles';
			style.textContent = `
				.manage-models-modal {
					width: 800px;
					max-width: 90vw;
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
					overflow-y: auto;
					padding-right: 8px;
				}

				.empty-state {
					text-align: center;
					padding: 40px 20px;
					color: var(--text-muted);
				}

				.empty-icon {
					font-size: 48px;
					margin-bottom: 16px;
				}

				.empty-state h3 {
					margin: 0 0 8px 0;
					color: var(--text-normal);
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

				.model-info {
					flex: 1;
				}

				.model-name {
					margin: 0 0 8px 0;
					font-size: 16px;
					color: var(--text-normal);
				}

				.model-meta {
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
					background: var(--interactive-success);
					color: white;
				}

				.default-badge {
					background: var(--interactive-accent);
					color: white;
				}

				.model-actions {
					display: flex;
					gap: 8px;
				}

				.default-btn, .delete-btn {
					padding: 6px 12px;
					border: 1px solid var(--background-modifier-border);
					border-radius: 4px;
					background: var(--background-primary);
					color: var(--text-normal);
					cursor: pointer;
					font-size: 12px;
				}

				.default-btn:hover {
					background: var(--interactive-accent);
					color: var(--text-on-accent);
				}

				.delete-btn:hover {
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

				.reset-btn {
					padding: 8px 16px;
					border: 1px solid var(--interactive-critical);
					border-radius: 4px;
					background: var(--background-primary);
					color: var(--interactive-critical);
					cursor: pointer;
					font-size: 12px;
					align-self: flex-start;
					margin-top: 12px;
				}

				.reset-btn:hover {
					background: var(--interactive-critical);
					color: white;
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

		contentEl.createEl('h3', { text: 'Delete Model Configuration' });
		contentEl.createEl('p', { 
			text: `Are you sure you want to delete "${this.modelConfig.name}"? This action cannot be undone.`
		});

		const buttonsEl = contentEl.createEl('div', { cls: 'button-group' });
		
		const cancelBtn = buttonsEl.createEl('button', { text: 'Cancel', cls: 'cancel-btn' });
		cancelBtn.addEventListener('click', () => this.close());

		const deleteBtn = buttonsEl.createEl('button', { text: 'Delete', cls: 'delete-btn' });
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

				.cancel-btn, .delete-btn {
					padding: 8px 16px;
					border: 1px solid var(--background-modifier-border);
					border-radius: 4px;
					cursor: pointer;
					font-size: 13px;
				}

				.cancel-btn {
					background: var(--background-primary);
					color: var(--text-normal);
				}

				.cancel-btn:hover {
					background: var(--background-modifier-hover);
				}

				.delete-btn {
					background: var(--interactive-critical);
					color: white;
					border-color: var(--interactive-critical);
				}

				.delete-btn:hover {
					background: var(--interactive-critical-hover);
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