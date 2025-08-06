import { Plugin, Notice } from 'obsidian';
import { ScreenshotManager } from './managers/screenshot-manager';
import { ImageEditor } from './editors/image-editor';
import { ImageCaptureSettingTab } from './settings/settings-tab';
import { ImageCaptureSettings, DEFAULT_SETTINGS } from './types';
import { AIManager } from './ai/ai-manager';
import { AIChatView, AI_CHAT_VIEW_TYPE } from './ai/ai-chat-view';
import { i18n, t } from './i18n';
import { initializeLogger, getLogger } from './utils/logger';

export default class ImageCapturePlugin extends Plugin {
	settings: ImageCaptureSettings;
	screenshotManager: ScreenshotManager;
	imageEditor: ImageEditor;
	aiManager: AIManager;

	async onload() {
		await this.loadSettings();
		
		// Initialize i18n with user's language setting
		i18n.setLanguage(this.settings.language || 'en');

		// Initialize logger
		initializeLogger(this);

		this.screenshotManager = new ScreenshotManager(this);
		this.imageEditor = new ImageEditor(this);
		this.aiManager = new AIManager(this);

		// Register AI chat view
		this.registerView(
			AI_CHAT_VIEW_TYPE,
			(leaf) => new AIChatView(leaf, this)
		);

		this.addRibbonIcon('camera', t('ui.screenshotCapture'), (evt: MouseEvent) => {
			this.screenshotManager.startRegionCapture();
		});

		// Add AI Chat ribbon icon (only if AI is enabled)
		if (this.settings.enableAIAnalysis) {
			this.addRibbonIcon('bot', t('ui.aiChatPanel'), (evt: MouseEvent) => {
				this.showAIChatPanel();
			});
		}

		this.addCommand({
			id: 'capture-selected-area',
			name: t('commands.captureArea.name'),
			callback: () => this.screenshotManager.startRegionCapture()
		});

		this.addCommand({
			id: 'capture-full-screen',
			name: t('commands.captureFull.name'),
			callback: () => this.screenshotManager.captureFullScreen()
		});

		this.addCommand({
			id: 'show-ai-chat',
			name: t('commands.openAiChat.name'),
			callback: () => this.showAIChatPanel()
		});

		this.addCommand({
			id: 'toggle-ai-chat',
			name: t('commands.toggleAiChat.name'),
			callback: () => this.toggleAIChatPanel()
		});

		this.addCommand({
			id: 'test-desktop-capturer',
			name: t('commands.testDesktopCapturer.name'),
			callback: async () => {
				await this.testAdvancedCapture();
			}
		});

		this.addSettingTab(new ImageCaptureSettingTab(this.app, this));
	}

	async onunload() {
		// Perform final auto-save for any active AI chat sessions
		try {
			const aiChatLeaves = this.app.workspace.getLeavesOfType(AI_CHAT_VIEW_TYPE);
			for (const leaf of aiChatLeaves) {
				const view = leaf.view as AIChatView;
				if (view && typeof view.onClose === 'function') {
					await view.onClose();
				}
			}
		} catch (error) {
			console.error('Failed to perform final auto-save during plugin unload:', error);
		}
		
		if (this.screenshotManager) {
			this.screenshotManager.cleanup();
		}
		if (this.imageEditor) {
			this.imageEditor.cleanup();
		}
		if (this.aiManager) {
			this.aiManager.cleanup();
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		
		// Migrate settings if needed
		this.migrateSettings();
	}

	private migrateSettings() {
		let needsSave = false;

		// Migrate to AI Chat Mode prompts
		if (!this.settings.aiChatModePrompts) {
			this.settings.aiChatModePrompts = {
				analyze: (this.settings as any).screenshotPrompt || DEFAULT_SETTINGS.aiChatModePrompts.analyze,
				ocr: DEFAULT_SETTINGS.aiChatModePrompts.ocr,
				chat: DEFAULT_SETTINGS.aiChatModePrompts.chat,
				custom: DEFAULT_SETTINGS.aiChatModePrompts.custom
			};
			needsSave = true;
		}

		// Set default mode if not present
		if (!this.settings.defaultAIChatMode) {
			this.settings.defaultAIChatMode = DEFAULT_SETTINGS.defaultAIChatMode;
			needsSave = true;
		}

		// Remove old screenshotPrompt if it exists
		if ('screenshotPrompt' in this.settings) {
			delete (this.settings as any).screenshotPrompt;
			needsSave = true;
		}

		if (needsSave) {
			this.saveSettings();
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async sendImageToAI(imageDataUrl: string, textContent: string, fileName: string): Promise<void> {
		if (!this.aiManager) {
			throw new Error('AI Manager not initialized');
		}
		
		return await this.aiManager.sendImageToAI(imageDataUrl, textContent, fileName);
	}

	async sendImagesToAI(images: { dataUrl: string, fileName: string, localPath?: string | null }[], textContent: string): Promise<void> {
		if (!this.aiManager) {
			throw new Error('AI Manager not initialized');
		}
		
		return await this.aiManager.sendImagesToAI(images, textContent);
	}

	async addImageToAIQueue(imageDataUrl: string, fileName: string, localPath?: string | null): Promise<void> {
		if (!this.aiManager) {
			throw new Error('AI Manager not initialized');
		}
		
		// Find the AI chat view and add image to its queue
		const aiLeaf = this.app.workspace.getLeavesOfType(AI_CHAT_VIEW_TYPE)[0];
		
		if (aiLeaf && (aiLeaf.view as any).addImageToQueue) {
			(aiLeaf.view as any).addImageToQueue(imageDataUrl, fileName, localPath);
		} else {
			throw new Error('AI Chat panel not found or does not support image queue');
		}
	}

	async ensureAIChatPanelVisible(): Promise<void> {
		// Check if AI panel already exists
		const aiLeaf = this.app.workspace.getLeavesOfType(AI_CHAT_VIEW_TYPE)[0];
		
		if (aiLeaf) {
			// Panel exists, just reveal it without recreating
			this.app.workspace.revealLeaf(aiLeaf);
			getLogger().log('AI panel already exists, just revealing it');
		} else {
			// Panel doesn't exist, create it
			getLogger().log('Creating new AI panel');
			await this.showAIChatPanel();
		}
	}

	async showAIChatPanel(): Promise<void> {
		try {
			// Remove any existing instances to prevent duplicates
			this.app.workspace.detachLeavesOfType(AI_CHAT_VIEW_TYPE);
			
			// Create new leaf in right sidebar and set view state
			const leaf = this.app.workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({
					type: AI_CHAT_VIEW_TYPE,
					active: true,
				});
				
				// Reveal the leaf
				this.app.workspace.revealLeaf(leaf);
			}
		} catch (error) {
			console.error('Failed to show AI chat panel:', error);
			throw new Error(`Failed to create AI chat panel: ${error.message}`);
		}
	}

	async toggleAIChatPanel(): Promise<void> {
		try {
			// Check if AI panel already exists and is visible
			const aiLeaf = this.app.workspace.getLeavesOfType(AI_CHAT_VIEW_TYPE)[0];
			
			if (aiLeaf) {
				// If panel exists, check if it's active
				const rightLeaves = (this.app.workspace.rightSplit as any)?.children || [];
				const isVisible = rightLeaves.some((leaf: any) => leaf === aiLeaf && leaf === this.app.workspace.activeLeaf);
				
				if (isVisible) {
					// If visible and active, close it
					aiLeaf.detach();
				} else {
					// If exists but not active, reveal it
					this.app.workspace.revealLeaf(aiLeaf);
				}
			} else {
				// If doesn't exist, create and show it
				await this.showAIChatPanel();
			}
		} catch (error) {
			console.error('Failed to toggle AI chat panel:', error);
			new Notice(t('plugin.aiChatPanelToggleFailed', { message: error.message }));
		}
	}

	async testAdvancedCapture() {
		try {
			new Notice(t('notice.testingAdvancedCapture'));
			getLogger().log('Testing advanced capture methods...');
			
			const electron = this.getElectronAPI();
			if (electron && electron.remote) {
				try {
					const remoteElectron = electron.remote.require('electron');
					const desktopCapturer = remoteElectron.desktopCapturer;
					const fs = electron.remote.require('fs');
					const path = electron.remote.require('path');
					
					if (desktopCapturer) {
						new Notice(t('notice.remoteDesktopCapturerAccessible'));
						getLogger().log('Remote desktopCapturer accessible, testing capture...');
						
						const sources = await desktopCapturer.getSources({
							types: ['screen'],
							thumbnailSize: { width: 0, height: 0 }
						});
						
						new Notice(t('notice.foundScreenSources', { count: sources.length }));
						getLogger().log(`Found ${sources.length} screen sources:`, sources);
						
						if (sources.length > 0) {
							const primarySource = sources[0];
							new Notice(t('notice.primarySource', { name: primarySource.name }));
							getLogger().log(`Primary source: ${primarySource.name}`);
							
							const fullSources = await desktopCapturer.getSources({
								types: ['screen'],
								thumbnailSize: { width: 1920, height: 1080 }
							});
							
							if (fullSources.length > 0) {
								const thumbnail = fullSources[0].thumbnail;
								if (thumbnail && !thumbnail.isEmpty()) {
									new Notice(t('notice.screenshotCapturedSuccessfully'));
									getLogger().log('Screenshot captured successfully!');
									getLogger().log('Thumbnail size:', thumbnail.getSize());
									
									const dataURL = thumbnail.toDataURL();
									getLogger().log('Data URL length:', dataURL.length);
									
									const base64Data = dataURL.replace(/^data:image\/png;base64,/, "");
									const fileName = `screenshot-${Date.now()}.png`;
									const filePath = path.join((this.app.vault.adapter as any).getBasePath(), fileName);
									
									fs.writeFile(filePath, base64Data, 'base64', (err: any) => {
										if (err) {
											new Notice(t('notice.failedToSaveScreenshot', { message: err.message }));
											console.error('Failed to save screenshot:', err);
										} else {
											new Notice(t('notice.screenshotSavedToFile', { fileName }));
											getLogger().log(`Screenshot saved to: ${filePath}`);
										}
									});
									
									return true;
								}
							}
						}
					} else {
						new Notice(t('notice.desktopCapturerNotAvailableRemote'));
						getLogger().log('desktopCapturer not available through remote');
					}
				} catch (e: any) {
					new Notice(t('notice.errorAccessingRemoteDesktopCapturer', { message: e.message }));
					getLogger().log('Error accessing remote desktopCapturer:', e);
				}
			}
			
			new Notice(t('notice.advancedCaptureTestCompleted'));
		} catch (error: any) {
			new Notice(t('notice.advancedTestError', { message: error.message }));
			console.error('Error in advanced test:', error);
		}
	}

	getElectronAPI() {
		try {
			getLogger().log('🔍 Checking for Electron API...');
			
			// Check for modern Electron API
			if ((window as any).electron) {
				getLogger().log('✅ Found window.electron');
				const electronAPI = (window as any).electron;
				getLogger().log('🔍 Electron API properties:', Object.keys(electronAPI));
				return electronAPI;
			}
			
			// Check for legacy require method
			if ((window as any).require) {
				getLogger().log('✅ Found window.require, attempting to load electron...');
				try {
					const electron = (window as any).require('electron');
					getLogger().log('✅ Successfully required electron');
					getLogger().log('🔍 Electron properties:', Object.keys(electron));
					
					const api = {
						desktopCapturer: electron.desktopCapturer,
						screen: electron.screen,
						remote: electron.remote
					};
					
					getLogger().log('🔍 Constructed API object:', {
						hasDesktopCapturer: !!api.desktopCapturer,
						hasScreen: !!api.screen,
						hasRemote: !!api.remote
					});
					
					return api;
				} catch (requireError: any) {
					console.error('❌ Failed to require electron:', requireError);
				}
			}
			
			// Check if we're in a Node.js environment
			getLogger().log('🔍 Environment check:', {
				hasProcess: typeof process !== 'undefined',
				hasGlobal: typeof global !== 'undefined',
				hasWindow: typeof window !== 'undefined',
				userAgent: navigator.userAgent
			});
			
			console.error('❌ No Electron API found');
			return null;
			
		} catch (error: any) {
			console.error('❌ Error accessing Electron API:', error);
			console.error('Error details:', {
				name: error.name,
				message: error.message,
				stack: error.stack
			});
			return null;
		}
	}
}