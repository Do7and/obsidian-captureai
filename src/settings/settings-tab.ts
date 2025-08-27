import { App, PluginSettingTab, Setting, Notice, WorkspaceLeaf } from 'obsidian';
import ImageCapturePlugin from '../main';
import { LLM_PROVIDERS, LLMProvider, LLMModel, AIChatMode } from '../types';
import { SetKeysModal } from '../ui/set-keys-modal';
import { ManageModelsModal } from '../ui/manage-models-modal';
import { i18n, t } from '../i18n';
import { getLogger } from '../utils/logger';

// Interface for AI Chat View
interface AIChatView {
	updateContent?(): void;
	updateSendOnlyButtonVisibility?(): void;
}

export class ImageCaptureSettingTab extends PluginSettingTab {
	plugin: ImageCapturePlugin;

	constructor(app: App, plugin: ImageCapturePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();


		// Register listener for plugin settings changes
		this.registerSettingsListener();


		// 通用设置分类
		containerEl.createEl('h3', { text: t('settings.general') });

		// 语言设置
		new Setting(containerEl)
			.setName(t('settings.language.name'))
			.setDesc(t('settings.language.desc'))
			.addDropdown(dropdown => dropdown
				.addOption('en', 'English')
				.addOption('zh', '中文')
				.setValue(this.plugin.settings.language)
				.onChange(async (value) => {
					this.plugin.settings.language = value;
					await this.plugin.saveSettings();
					// Update i18n immediately
					i18n.setLanguage(value);
					// Update prompts for the new language
					this.plugin.updatePromptsForLanguage(value);
					// Refresh the settings display to show new language
					this.display();
				}));

		// 使用相对路径设置
		new Setting(containerEl)
			.setName(t('settings.useRelativePath.name'))
			.setDesc(t('settings.useRelativePath.desc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useRelativePath)
				.onChange(async (value) => {
					this.plugin.settings.useRelativePath = value;
					await this.plugin.saveSettings();
				}));

		// 启用调试日志设置
		new Setting(containerEl)
			.setName(t('settings.enableDebugLogging.name'))
			.setDesc(t('settings.enableDebugLogging.desc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableDebugLogging)
				.onChange(async (value) => {
					this.plugin.settings.enableDebugLogging = value;
					await this.plugin.saveSettings();
				}));


		// Screenshot功能设置分类
		containerEl.createEl('h3', { text: t('settings.screenshotFunction') });

		// 显示普通截图按钮设置
		new Setting(containerEl)
			.setName(t('settings.showNormalCaptureButton.name'))
			.setDesc(t('settings.showNormalCaptureButton.desc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showNormalCaptureButton)
				.onChange(async (value) => {
					this.plugin.settings.showNormalCaptureButton = value;
					await this.plugin.saveSettings();
				}));

		// 启用最小化截图功能设置
		new Setting(containerEl)
			.setName(t('settings.enableMinimizedCapture.name'))
			.setDesc(t('settings.enableMinimizedCapture.desc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableMinimizedCapture)
				.onChange(async (value) => {
					this.plugin.settings.enableMinimizedCapture = value;
					// 如果关闭了最小化截图功能，也关闭相关按钮
					if (!value) {
						this.plugin.settings.showMinimizedCaptureButton = false;
					}
					await this.plugin.saveSettings();
					// 刷新设置页面以显示/隐藏子选项
					this.display();
				}));

		// 显示最小化截图按钮设置（仅在启用最小化截图功能时显示）
		if (this.plugin.settings.enableMinimizedCapture) {
			new Setting(containerEl)
				.setName(t('settings.showMinimizedCaptureButton.name'))
				.setDesc(t('settings.showMinimizedCaptureButton.desc'))
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.showMinimizedCaptureButton)
					.onChange(async (value) => {
						this.plugin.settings.showMinimizedCaptureButton = value;
						await this.plugin.saveSettings();
					}));
		}

		new Setting(containerEl)
			.setName(t('settings.defaultSaveLocation.name'))
			.setDesc(t('settings.defaultSaveLocation.desc'))
			.addText(text => text
				.setPlaceholder(t('settings.defaultSaveLocation.placeholder'))
				.setValue(this.plugin.settings.defaultSaveLocation)
				.onChange(async (value) => {
					this.plugin.settings.defaultSaveLocation = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('settings.imageFormat.name'))
			.setDesc(t('settings.imageFormat.desc'))
			.addDropdown(dropdown => dropdown
				.addOption('png', 'PNG (lossless)')
				.addOption('jpg', 'JPG (compressed)')
				.setValue(this.plugin.settings.imageFormat)
				.onChange(async (value: 'png' | 'jpg') => {
					this.plugin.settings.imageFormat = value;
					await this.plugin.saveSettings();
				}));

		// AI Chat功能设置分类
		containerEl.createEl('h3', { text: t('settings.aiFunction') });

		const aiAnalysisSetting = new Setting(containerEl)
			.setName(t('settings.enableAI.name'))
			.setDesc(t('settings.enableAI.desc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableAIAnalysis)
				.onChange(async (value) => {
					this.plugin.settings.enableAIAnalysis = value;
					// 如果关闭了AI功能，也关闭相关按钮
					if (!value) {
						this.plugin.settings.showAIChatPanelButton = false;
					}
					await this.plugin.saveSettings();
					this.display(); // Refresh the display to show/hide AI settings
				}));

		// AI Configuration Section
		if (this.plugin.settings.enableAIAnalysis) {
			
			
			// Quick access to AI Chat
			new Setting(containerEl)
				.setName(t('ui.aiChatPanel'))
				.setDesc(t('settings.aiChatPanel.desc'))
				.addButton(button => button
					.setButtonText(t('commands.toggleAiChat.name'))
					.onClick(async () => {
						try {
							await this.plugin.toggleAIChatPanel();
							new Notice(t('notice.aiChatOpened'));
						} catch (error) {
							new Notice(t('notice.aiChatFailed') + `: ${error.message}`);
						}
					}));

			
			

			// 第一块：AI API配置相关设置
			containerEl.createEl('h4', { text: t('settings.aiApiConfig') });
			
			// Create gray background container for AI API configuration
			const apiConfigContainer = containerEl.createEl('div', { cls: 'ai-api-config-block' });
			
			// API Keys management
			new Setting(apiConfigContainer)
				.setName(t('settings.apiKeys.name'))
				.setDesc(t('settings.apiKeys.desc'))
				.addButton(button => button
					.setButtonText(t('settings.setKeys.button'))
					.setCta()
					.onClick(() => {
						const modal = new SetKeysModal(this.plugin);
						modal.open();
					}));

			// Model management
			new Setting(apiConfigContainer)
				.setName(t('settings.modelConfigs.name'))
				.setDesc(t('settings.modelConfigs.desc', { count: this.plugin.settings.modelConfigs.length }))
				.addButton(button => button
					.setButtonText(t('settings.manageModels.button'))
					.onClick(() => {
						const modal = new ManageModelsModal(this.plugin);
						modal.open();
					}));

			// Default model selection
			if (this.plugin.settings.modelConfigs.length > 0) {
				const allModels = this.plugin.settings.modelConfigs;
				
				new Setting(apiConfigContainer)
					.setName(t('settings.defaultModel.name'))
					.setDesc(t('settings.defaultModel.desc'))
					.addDropdown(dropdown => {
						allModels.forEach(modelConfig => {
							const displayName = modelConfig.isVisionCapable 
								? `${modelConfig.name} (${t('settings.defaultModel.visionCapable')})`
								: `${modelConfig.name} (${t('settings.defaultModel.textOnly')})`;
							dropdown.addOption(modelConfig.id, displayName);
						});
						dropdown.setValue(this.plugin.settings.defaultModelConfigId || allModels[0].id)
						.onChange(async (value) => {
							this.plugin.settings.defaultModelConfigId = value;
							await this.plugin.saveSettings();
							// Refresh AI chat views to update model selector
							this.refreshModelDependentComponents();
						});
					});
			} else {
				// Guide to add models
				const guideEl = apiConfigContainer.createEl('div', { 
					cls: 'setting-item-description settings-guide-text',
					text: t('settings.getStarted.guide')
				});
			}

			// 第二块：杂项
			containerEl.createEl('h4', { text: t('settings.miscellaneous.name') });
			
			new Setting(containerEl)
				.setName(t('settings.imageSaveLocation.name'))
				.setDesc(t('settings.imageSaveLocation.desc'))
				.addText(text => text
					.setPlaceholder(t('settings.imageSaveLocation.placeholder'))
					.setValue(this.plugin.settings.otherSourceImageLocation)
					.onChange(async (value) => {
						this.plugin.settings.otherSourceImageLocation = value;
						await this.plugin.saveSettings();
					}));


			// 显示仅发送按钮设置
			new Setting(containerEl)
				.setName(t('settings.showSendOnlyButton.name'))
				.setDesc(t('settings.showSendOnlyButton.desc'))
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.showSendOnlyButton)
					.onChange(async (value) => {
						this.plugin.settings.showSendOnlyButton = value;
						await this.plugin.saveSettings();
						this.refreshModelDependentComponents();
					}));

			
			
			
			// 显示AI聊天面板按钮设置（仅在AI功能启用时显示）
			
			new Setting(containerEl)
				.setName(t('settings.showAIChatPanelButton.name'))
				.setDesc(t('settings.showAIChatPanelButton.desc'))
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.showAIChatPanelButton)
					.onChange(async (value) => {
						this.plugin.settings.showAIChatPanelButton = value;
						await this.plugin.saveSettings();
					}));


			// Max Context Messages
			const contextContainer = containerEl.createEl('div', { cls: 'context-settings-container' });
			new Setting(contextContainer)
				.setName(t('settings.maxContextMessages.name'))
				.setDesc(t('settings.maxContextMessages.desc'))
				.addSlider(slider => slider
					.setLimits(1, 20, 1)
					.setValue(this.plugin.settings.contextSettings?.maxContextMessages || 20)
					.setDynamicTooltip()
					.onChange(async (value) => {
						if (!this.plugin.settings.contextSettings) {
							this.plugin.settings.contextSettings = {
								maxContextMessages: 10,
							};
						}
						this.plugin.settings.contextSettings.maxContextMessages = value;
						await this.plugin.saveSettings();
					})
				);

				
			// 第三块：会话记录相关设置
			containerEl.createEl('h4', { text: t('settings.conversationHistory') });
			
			new Setting(containerEl)
				.setName(t('settings.autoSave.name'))
				.setDesc(t('settings.autoSave.desc'))
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.autoSaveConversations)
					.onChange(async (value) => {
						this.plugin.settings.autoSaveConversations = value;
						await this.plugin.saveSettings();
						this.display(); // Refresh to show/hide auto-save options
					}));

			if (this.plugin.settings.autoSaveConversations) {
				new Setting(containerEl)
					.setName(t('settings.autoSaveLocation.name'))
					.setDesc(t('settings.autoSaveLocation.desc'))
					.addText(text => text
						.setPlaceholder(t('settings.autoSaveLocation.placeholder'))
						.setValue(this.plugin.settings.autoSavedConversationLocation)
						.onChange(async (value) => {
							this.plugin.settings.autoSavedConversationLocation = value;
							await this.plugin.saveSettings();
						}));

				new Setting(containerEl)
					.setName(t('settings.maxHistory.name'))
					.setDesc(t('settings.maxHistory.desc'))
					.addDropdown(dropdown => {
						// 预设选项: 1, 2, 3, 4, 5 (默认), 6, 7, 8, 9, 10, 15, 20, 1000
						const options = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 1000];
						options.forEach(option => {
							dropdown.addOption(option.toString(), option.toString());
						});
						
						// 设置默认值为5
						const currentValue = this.plugin.settings.maxAutoSavedConversations?.toString() || '5';
						dropdown.setValue(currentValue)
							.onChange(async (value) => {
								this.plugin.settings.maxAutoSavedConversations = parseInt(value);
								await this.plugin.saveSettings();
							});
					});

				// 设置默认值为5
				if (this.plugin.settings.maxAutoSavedConversations === undefined) {
					this.plugin.settings.maxAutoSavedConversations = 5;
				}
			}

			// 第四块：AI prompt设置
			containerEl.createEl('h4', { text: t('settings.promptSettings') });
			
			// Create a container for prompts to ensure consistent styling
			const promptsContainer = containerEl.createEl('div', { cls: 'prompts-settings-container' });
			
			// Global System Prompt
			new Setting(promptsContainer)
				.setName(t('settings.globalPrompt.name'))
				.setDesc(t('settings.globalPrompt.desc'))
				.addTextArea(text => text
					.setPlaceholder(t('settings.globalPrompt.placeholder'))
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
						textArea.classList.add('settings-textarea-large');
					}
				});

			// Default AI Chat Mode Setting
			new Setting(promptsContainer)
				.setName(t('settings.defaultAIChatMode.name'))
				.setDesc(t('settings.defaultAIChatMode.desc'))
				.addDropdown(dropdown => dropdown
					.addOption('analyze', t('aiChat.modes.analyze'))
					.addOption('ocr', t('aiChat.modes.ocr'))
					.addOption('chat', t('aiChat.modes.chat'))
					.addOption('custom', t('aiChat.modes.custom'))
					.setValue(this.plugin.settings.defaultAIChatMode || 'analyze')
					.onChange(async (value) => {
						this.plugin.settings.defaultAIChatMode = value as AIChatMode;
						await this.plugin.saveSettings();
					}));

			// AI Chat Mode Prompts Section
			promptsContainer.createEl('h4', { text: t('settings.aiChatModePrompts'), cls: 'mode-prompts-header' });
			
			// Add AI Chat Mode prompts
			const modes: Array<{id: keyof import('../types').ImageCaptureSettings['aiChatModePrompts'], nameKey: string, descKey: string}> = [
				{ id: 'analyze', nameKey: 'settings.analyzePrompt.name', descKey: 'settings.analyzePrompt.desc' },
				{ id: 'ocr', nameKey: 'settings.ocrPrompt.name', descKey: 'settings.ocrPrompt.desc' },
				{ id: 'chat', nameKey: 'settings.chatPrompt.name', descKey: 'settings.chatPrompt.desc' },
				{ id: 'custom', nameKey: 'settings.customPrompt.name', descKey: 'settings.customPrompt.desc' }
			];

			modes.forEach(mode => {
				new Setting(promptsContainer)
					.setName(t(mode.nameKey))
					.setDesc(t(mode.descKey))
					.addTextArea(text => text
						.setPlaceholder(`Enter ${mode.id} mode prompt...`)
						.setValue(this.plugin.settings.aiChatModePrompts[mode.id] || '')
						.onChange(async (value) => {
							if (!this.plugin.settings.aiChatModePrompts) {
								this.plugin.settings.aiChatModePrompts = {
									analyze: '',
									ocr: '',
									chat: '',
									custom: ''
								};
							}
							this.plugin.settings.aiChatModePrompts[mode.id] = value;
							await this.plugin.saveSettings();
						}))
					.then(setting => {
						// Adjust textarea size and styling to match global prompt
						const textArea = setting.controlEl.querySelector('textarea') as HTMLTextAreaElement;
						if (textArea) {
							textArea.rows = 3;
							textArea.classList.add('settings-textarea-small');
						}
					});
			});



		}

		// Shortcuts Section

		const shortcutsContainer = containerEl.createEl("div", {
			cls: "setting-container",
		});
		shortcutsContainer.createEl('h3', { text: t('settings.shortcuts.name') });


		const shortcutslist = shortcutsContainer.createEl("ul");
		shortcutslist.createEl("li", { text: t('settings.shortcuts.help.1')});
		shortcutslist.createEl("li", { text: t('settings.shortcuts.help.2')});
		shortcutslist.createEl("li", { text: t('settings.shortcuts.help.3')});


		// // Usage Section
		// containerEl.createEl('h3', { text: t('settings.usage.name') });
		
		// const usageDesc = containerEl.createEl('div', { cls: 'setting-item-description' });
		// this.createHTMLContent(usageDesc, t('settings.usage.help'));

		// Troubleshooting Section
		const troubleshootingContainer = containerEl.createEl("div", {
			cls: "setting-container",
		});
		troubleshootingContainer.createEl('h3', { text: t('settings.troubleshooting') });

		troubleshootingContainer.createEl("h6", { text: t('settings.troubleshooting.title.screenshot')});
		const troubleshootinglist1 = troubleshootingContainer.createEl("ul");
		troubleshootinglist1.createEl("li", { text: t('settings.troubleshooting.screenshot.1')});
		troubleshootinglist1.createEl("li", { text: t('settings.troubleshooting.screenshot.2')});
		troubleshootinglist1.createEl("li", { text: t('settings.troubleshooting.screenshot.3')});

		troubleshootingContainer.createEl("h6", { text: t('settings.troubleshooting.title.ai')});
		const troubleshootinglist2 = troubleshootingContainer.createEl("ul");
		troubleshootinglist2.createEl("li", { text: t('settings.troubleshooting.ai.1')});
		troubleshootinglist2.createEl("li", { text: t('settings.troubleshooting.ai.2')});
		troubleshootinglist2.createEl("li", { text: t('settings.troubleshooting.ai.3')});
		troubleshootinglist2.createEl("li", { text: t('settings.troubleshooting.ai.4')});

		troubleshootingContainer.createEl("h6", { text: t('settings.troubleshooting.title.persist')});
		const troubleshootinglist3 = troubleshootingContainer.createEl("ul");
		troubleshootinglist3.createEl("li", { text: t('settings.troubleshooting.persist.1')});

		const troubleshootinglist3li2 = troubleshootinglist3.createEl("li");
		troubleshootinglist3li2.appendText(t('settings.troubleshooting.persist.2'));
		troubleshootinglist3li2.createEl("a", {
		href: t('settings.troubleshooting.persist.url'),
		text: "GitHub Issues",
		});
		

		
		// 插件设置页尾部 GitHub Star 模块
		new Setting(containerEl)
		.setName(t('settings.githubStar.name'))
		.setDesc(t('settings.githubStar.desc'))
		.addButton(btn =>
			btn.setButtonText(t('settings.githubStarButton.name'))
			.setCta()
			.onClick(() => {
				window.open(t('settings.githubStarButton.url'), "_blank");
			})
  );

	}

	private createHTMLContent(container: HTMLElement, htmlString: string) {
		// Parse HTML string and safely add content using DOM methods
		const tempDiv = document.createElement('div');
		tempDiv.textContent = htmlString;
		
		// Move all child nodes from temp div to target container
		while (tempDiv.firstChild) {
			container.appendChild(tempDiv.firstChild);
		}
	}

	private refreshModelDependentComponents() {
		// Refresh AI chat views
		const aiChatLeaves = this.plugin.app.workspace.getLeavesOfType('ai-chat');
		aiChatLeaves.forEach((leaf: WorkspaceLeaf) => {
			const view = leaf.view as AIChatView;
			if (view && typeof view.updateContent === 'function') {
				view.updateContent();
			}
			// Also update send-only button visibility
			if (view && typeof view.updateSendOnlyButtonVisibility === 'function') {
				view.updateSendOnlyButtonVisibility();
			}
		});
	}

	private registerSettingsListener() {
		// Store the current model count to detect changes
		if (!this.plugin.settings._modelConfigsLastCount) {
			this.plugin.settings._modelConfigsLastCount = this.plugin.settings.modelConfigs.length;
		}
		
		// Set up interval to check for model config changes
		const checkForChanges = () => {
			const currentCount = this.plugin.settings.modelConfigs.length;
			if (currentCount !== this.plugin.settings._modelConfigsLastCount) {
				this.plugin.settings._modelConfigsLastCount = currentCount;
				// Refresh the settings display when model count changes
				this.display();
			}
		};
		
		// Check every 500ms when settings tab is visible
		const interval = setInterval(checkForChanges, 500);
		
		// Clean up interval when settings tab is closed
		// This is a bit of a hack, but works for Obsidian's settings modal
		const observer = new MutationObserver(() => {
			if (!document.contains(this.containerEl)) {
				clearInterval(interval);
				observer.disconnect();
			}
		});
		observer.observe(document.body, { childList: true, subtree: true });
	}

	private refreshAIChatViews() {
		// 使用轻量级方法只更新按钮显示状态，而不是重新创建整个输入区域
		const aiChatLeaves = this.plugin.app.workspace.getLeavesOfType('ai-chat');
		aiChatLeaves.forEach((leaf: WorkspaceLeaf) => {
			const view = leaf.view as AIChatView;
			if (view && typeof view.updateSendOnlyButtonVisibility === 'function') {
				view.updateSendOnlyButtonVisibility();
			}
		});
	}
}