import { App, PluginSettingTab, Setting } from 'obsidian';
import ImageCapturePlugin from '../main';
import { LLM_PROVIDERS, LLMProvider, LLMModel } from '../types';
import { SetKeysModal } from '../ui/set-keys-modal';
import { ManageModelsModal } from '../ui/manage-models-modal';

export class ImageCaptureSettingTab extends PluginSettingTab {
	plugin: ImageCapturePlugin;

	constructor(app: App, plugin: ImageCapturePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Image Capture Settings' });

		// Basic Settings
		new Setting(containerEl)
			.setName('Default save location')
			.setDesc('Directory where captured images will be saved. Leave empty to use vault root.')
			.addText(text => text
				.setPlaceholder('Enter folder path (e.g., attachments/screenshots)')
				.setValue(this.plugin.settings.defaultSaveLocation)
				.onChange(async (value) => {
					this.plugin.settings.defaultSaveLocation = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Image format')
			.setDesc('Choose the format for saved images')
			.addDropdown(dropdown => dropdown
				.addOption('png', 'PNG (lossless)')
				.addOption('jpg', 'JPG (compressed)')
				.setValue(this.plugin.settings.imageFormat)
				.onChange(async (value: 'png' | 'jpg') => {
					this.plugin.settings.imageFormat = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Enable region selection')
			.setDesc('Allow selecting specific regions of the screen to capture')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableRegionSelect)
				.onChange(async (value) => {
					this.plugin.settings.enableRegionSelect = value;
					await this.plugin.saveSettings();
				}));

		// AI Analysis Section
		containerEl.createEl('h3', { text: 'AI Analysis' });

		const aiAnalysisSetting = new Setting(containerEl)
			.setName('Enable AI analysis')
			.setDesc('Enable AI-powered image analysis features')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableAIAnalysis)
				.onChange(async (value) => {
					this.plugin.settings.enableAIAnalysis = value;
					await this.plugin.saveSettings();
					this.display(); // Refresh the display to show/hide AI settings
				}));

		// AI Configuration Section
		if (this.plugin.settings.enableAIAnalysis) {
			// Quick access to AI Chat
			new Setting(containerEl)
				.setName('AI Chat Panel')
				.setDesc('Open the AI chat panel to interact with your configured models')
				.addButton(button => button
					.setButtonText('Open AI Chat')
					.onClick(async () => {
						try {
							await this.plugin.showAIChatPanel();
							new Notice('✅ AI Chat panel opened');
						} catch (error) {
							new Notice(`❌ Failed to open AI Chat: ${error.message}`);
						}
					}));

			// API Keys management
			const apiKeysContainer = containerEl.createEl('div', { cls: 'api-keys-section' });
			
			new Setting(apiKeysContainer)
				.setName('API Keys')
				.setDesc('Configure API keys for different AI providers')
				.addButton(button => button
					.setButtonText('Set Keys')
					.setCta()
					.onClick(() => {
						const modal = new SetKeysModal(this.plugin);
						modal.open();
					}));

			// Model management
			new Setting(apiKeysContainer)
				.setName('Model Configurations')
				.setDesc(`Manage your AI models (${this.plugin.settings.modelConfigs.length} configured)`)
				.addButton(button => button
					.setButtonText('Manage Models')
					.onClick(() => {
						const modal = new ManageModelsModal(this.plugin);
						modal.open();
					}));

			// Default model selection
			if (this.plugin.settings.modelConfigs.length > 0) {
				const visionModels = this.plugin.settings.modelConfigs.filter(mc => mc.isVisionCapable);
				
				if (visionModels.length > 0) {
					new Setting(apiKeysContainer)
						.setName('Default Model')
						.setDesc('Select the default model for image analysis')
						.addDropdown(dropdown => {
							visionModels.forEach(modelConfig => {
								dropdown.addOption(modelConfig.id, modelConfig.name);
							});
							dropdown.setValue(this.plugin.settings.defaultModelConfigId || visionModels[0].id)
							.onChange(async (value) => {
								this.plugin.settings.defaultModelConfigId = value;
								await this.plugin.saveSettings();
							});
						});
				} else {
					// Warning if no vision models
					const warningEl = apiKeysContainer.createEl('div', { 
						cls: 'setting-item-description',
						text: '⚠️ No vision-capable models configured. Use "Set Keys" to add models that support image analysis.'
					});
					warningEl.style.color = 'var(--text-warning)';
					warningEl.style.fontWeight = 'bold';
				}

				// Prompt Settings Section
				containerEl.createEl('h3', { text: 'AI Prompt Settings' });
				
				// Create a container for prompts to ensure consistent styling
				const promptsContainer = containerEl.createEl('div', { cls: 'prompts-settings-container' });
				
				// Global System Prompt
				new Setting(promptsContainer)
					.setName('Global System Prompt')
					.setDesc('This system prompt will be used for all AI conversations. It defines the AI\'s personality and behavior.')
					.addTextArea(text => text
						.setPlaceholder('You are a helpful AI assistant...')
						.setValue(this.plugin.settings.globalSystemPrompt || '')
						.onChange(async (value) => {
							this.plugin.settings.globalSystemPrompt = value;
							await this.plugin.saveSettings();
						}))
					.then(setting => {
						// Adjust textarea size and styling
						const textArea = setting.controlEl.querySelector('textarea') as HTMLTextAreaElement;
						if (textArea) {
							textArea.rows = 4;
							textArea.style.width = '100%';
							textArea.style.minHeight = '100px';
							textArea.style.resize = 'vertical';
							textArea.style.fontFamily = 'var(--font-monospace)';
							textArea.style.fontSize = '13px';
						}
					});

				// Screenshot Prompt
				new Setting(promptsContainer)
					.setName('Screenshot Analysis Prompt')
					.setDesc('This prompt will be automatically added when analyzing screenshots. It guides the AI on how to analyze images.')
					.addTextArea(text => text
						.setPlaceholder('Please analyze this screenshot and provide detailed insights...')
						.setValue(this.plugin.settings.screenshotPrompt || '')
						.onChange(async (value) => {
							this.plugin.settings.screenshotPrompt = value;
							await this.plugin.saveSettings();
						}))
					.then(setting => {
						// Adjust textarea size and styling to match global prompt
						const textArea = setting.controlEl.querySelector('textarea') as HTMLTextAreaElement;
						if (textArea) {
							textArea.rows = 4;
							textArea.style.width = '100%';
							textArea.style.minHeight = '100px';
							textArea.style.resize = 'vertical';
							textArea.style.fontFamily = 'var(--font-monospace)';
							textArea.style.fontSize = '13px';
						}
					});
			} else {
				// Guide to add models
				const guideEl = apiKeysContainer.createEl('div', { 
					cls: 'setting-item-description',
					text: '💡 Get started by clicking "Set Keys" to configure your AI providers and add models.'
				});
				guideEl.style.color = 'var(--text-muted)';
				guideEl.style.fontStyle = 'italic';
				guideEl.style.marginTop = '10px';
			}
		}

		// Shortcuts Section
		containerEl.createEl('h3', { text: 'Shortcuts' });
		
		const shortcutsDesc = containerEl.createEl('div', { cls: 'setting-item-description' });
		shortcutsDesc.innerHTML = `
			<p>Available keyboard shortcuts:</p>
			<ul>
				<li><kbd>Escape</kbd> - Cancel region selection</li>
				<li><kbd>Ctrl/Cmd + Z</kbd> - Undo last edit</li>
				<li><kbd>Ctrl/Cmd + Y</kbd> - Redo last edit</li>
			</ul>
		`;

		// Usage Section
		containerEl.createEl('h3', { text: 'Usage' });
		
		const usageDesc = containerEl.createEl('div', { cls: 'setting-item-description' });
		usageDesc.innerHTML = `
			<p>How to use the screenshot capture plugin:</p>
			<ol>
				<li>Click the camera icon in the ribbon or use the command palette</li>
				<li>Select "Capture selected area" or "Capture full screen"</li>
				<li>For region capture: drag to select the area you want to capture</li>
				<li>Use the editing tools to annotate your screenshot</li>
				<li>Click "Save" to save the image or "Send to AI" for analysis</li>
			</ol>
			<p><strong>Note:</strong> This plugin requires Obsidian to be running on a desktop platform with Electron support.</p>
		`;

		// Troubleshooting Section
		containerEl.createEl('h3', { text: 'Troubleshooting' });
		
		const troubleshootingDesc = containerEl.createEl('div', { cls: 'setting-item-description' });
		troubleshootingDesc.innerHTML = `
			<p>If screenshots are not working:</p>
			<ul>
				<li>Make sure you're running Obsidian on desktop (not mobile)</li>
				<li>Try restarting Obsidian</li>
				<li>Check that you have proper screen recording permissions on macOS</li>
				<li>Use the "Test desktopCapturer API" command to diagnose issues</li>
			</ul>
			<p>If AI analysis is not working:</p>
			<ul>
				<li>Check that your API keys are correctly configured using "Set Keys"</li>
				<li>Ensure you have at least one vision-capable model configured</li>
				<li>Verify your internet connection</li>
				<li>Check the Console (Ctrl+Shift+I) for error messages</li>
			</ul>
		`;

		// Add custom styles for the settings page
		this.addStyles();
	}

	private addStyles() {
		if (!document.getElementById('image-capture-settings-styles')) {
			const style = document.createElement('style');
			style.id = 'image-capture-settings-styles';
			style.textContent = `
				.api-keys-section {
					background: var(--background-secondary);
					border: 1px solid var(--background-modifier-border);
					border-radius: 6px;
					padding: 16px;
					margin: 16px 0;
				}

				.api-keys-section .setting-item {
					border: none;
					padding: 8px 0;
				}

				.api-keys-section .setting-item:not(:last-child) {
					border-bottom: 1px solid var(--background-modifier-border-hover);
				}

				.prompts-settings-container {
					background: var(--background-secondary);
					border: 1px solid var(--background-modifier-border);
					border-radius: 6px;
					padding: 16px;
					margin: 16px 0;
				}

				.prompts-settings-container .setting-item {
					border: none;
					padding: 8px 0;
				}

				.prompts-settings-container .setting-item:not(:last-child) {
					border-bottom: 1px solid var(--background-modifier-border-hover);
				}

				.prompts-settings-container .setting-item-control textarea {
					font-family: var(--font-monospace) !important;
					font-size: 13px !important;
					line-height: 1.4 !important;
				}
			`;
			document.head.appendChild(style);
		}
	}
}