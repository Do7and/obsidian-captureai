import { Plugin, Notice, addIcon, WorkspaceLeaf } from 'obsidian';
import { ScreenshotManager } from './managers/screenshot-manager';
import { ImageEditor } from './editors/image-editor';
import { ImageCaptureSettingTab } from './settings/settings-tab';
import { ImageCaptureSettings, DEFAULT_SETTINGS, getLocalizedPrompts, DEFAULT_PROMPTS } from './types';
import { AIManager } from './ai/ai-manager';
import { AIChatView, AI_CHAT_VIEW_TYPE } from './ai/ai-chat-view';
import { i18n, t } from './i18n';
import { initializeLogger, getLogger } from './utils/logger';

// Interface definitions for type safety
interface AIChatViewInterface {
	addImageToQueue?: (imageDataUrl: string, fileName: string, localPath: string | null, source: string) => void;
}

interface WorkspaceWithSplit {
	rightSplit?: {
		children?: any[];
	};
	activeLeaf?: any;
}

interface VaultWithAdapter {
	adapter?: {
		getBasePath?: () => string;
	};
}

interface WindowWithElectron extends Window {
	electron?: any;
	require?: any;
}

export default class ImageCapturePlugin extends Plugin {
	settings: ImageCaptureSettings;
	screenshotManager: ScreenshotManager;
	imageEditor: ImageEditor;
	aiManager: AIManager;
	// Store ribbon icon references for dynamic management
	private ribbonIcons: Map<string, HTMLElement> = new Map();

	async onload() {
		await this.loadSettings();
		
		// Initialize i18n with user's language setting
		i18n.setLanguage(this.settings.language || 'en');

		// Update prompts based on language setting if they haven't been customized
		this.updatePromptsForLanguage(this.settings.language || 'en');

		// Initialize logger
		initializeLogger(this);

		this.screenshotManager = new ScreenshotManager(this);
		this.imageEditor = new ImageEditor(this);
		this.aiManager = new AIManager(this);


		//Register AI chat icon
		this.registerCustomIcons();

		// Register AI chat view
		this.registerView(
			AI_CHAT_VIEW_TYPE,
			(leaf) => new AIChatView(leaf, this)
		);

		// Initialize UI elements based on settings
		this.updateUIElements();
		
		

		// Initialize commands based on settings
		this.updateCommands();

		this.addSettingTab(new ImageCaptureSettingTab(this.app, this));
	}

	/**
	 * Update ribbon icons based on current settings
	 */
	public updateUIElements(): void {
		// Clear existing ribbon icons
		this.ribbonIcons.forEach(icon => icon.remove());
		this.ribbonIcons.clear();

		// Add normal capture ribbon icon (only if enabled in settings)
		if (this.settings.showNormalCaptureButton) {
			const normalCaptureIcon = this.addRibbonIcon('camera', t('ui.captureAI'), (evt: MouseEvent) => {
				this.screenshotManager.startRegionCapture();
			});
			this.ribbonIcons.set('normal-capture', normalCaptureIcon);
		}

		// Add minimized capture ribbon icon (only if feature enabled AND button enabled)
		if (this.settings.enableMinimizedCapture && this.settings.showMinimizedCaptureButton) {
			const minimizedCaptureIcon = this.addRibbonIcon('minimize', t('ui.minimizedCapture'), (evt: MouseEvent) => {
				this.screenshotManager.startRegionCapture(true);
			});
			this.ribbonIcons.set('minimized-capture', minimizedCaptureIcon);
		}

		// Add AI Chat ribbon icon (only if AI is enabled AND button is enabled in settings)
		if (this.settings.enableAIAnalysis && this.settings.showAIChatPanelButton) {
			const aiChatIcon = this.addRibbonIcon('bot', t('ui.aiChatPanel'), (evt: MouseEvent) => {
				this.toggleAIChatPanel();
			});
			this.ribbonIcons.set('ai-chat', aiChatIcon);
		}
	}

	/**
	 * Update commands based on current settings
	 */
	public updateCommands(): void {
		// Remove existing commands
		this.removeCommand('capture-normal-window');
		this.removeCommand('capture-minimized-window');
		this.removeCommand('toggle-ai-chat');

		// Add normal capture command (always available)
		this.addCommand({
			id: 'capture-normal-window',
			name: t('commands.captureNormal.name'),
			callback: () => this.screenshotManager.startRegionCapture()
		});

		// Add minimized capture command (only if feature is enabled)
		if (this.settings.enableMinimizedCapture) {
			this.addCommand({
				id: 'capture-minimized-window',
				name: t('commands.captureMinimized.name'),
				callback: () => this.screenshotManager.startRegionCapture(true)
			});
		}

		// Add AI chat toggle command (always available)
		this.addCommand({
			id: 'toggle-ai-chat',
			name: t('commands.toggleAiChat.name'),
			callback: () => this.toggleAIChatPanel()
		});
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
			getLogger().error('Failed to perform final auto-save during plugin unload:', error);
		}
		
		// Cleanup AI Manager and temporary images
		if (this.aiManager) {
			this.aiManager.cleanup();
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
				analyze: DEFAULT_SETTINGS.aiChatModePrompts.analyze,
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
			delete (this.settings as Record<string, any>).screenshotPrompt;
			needsSave = true;
		}

		if (needsSave) {
			this.saveSettings();
		}
	}

	/**
	 * Update prompts based on language setting
	 */
	updatePromptsForLanguage(language: string) {
		const localizedPrompts = getLocalizedPrompts(language);
		let needsSave = false;

		// Update global system prompt if it's still the default English one
		if (this.settings.globalSystemPrompt === DEFAULT_PROMPTS.en.globalSystemPrompt || 
			this.settings.globalSystemPrompt === DEFAULT_PROMPTS.zh.globalSystemPrompt ||
			!this.settings.globalSystemPrompt) {
			this.settings.globalSystemPrompt = localizedPrompts.globalSystemPrompt;
			needsSave = true;
		}

		// Update mode prompts if they're still default ones
		if (this.settings.aiChatModePrompts) {
			Object.keys(this.settings.aiChatModePrompts).forEach(mode => {
				const modeKey = mode as keyof typeof this.settings.aiChatModePrompts;
				const currentPrompt = this.settings.aiChatModePrompts![modeKey];
				
				// Check if current prompt is a default prompt from any language
				const isDefaultEn = currentPrompt === DEFAULT_PROMPTS.en.aiChatModePrompts[modeKey];
				const isDefaultZh = currentPrompt === DEFAULT_PROMPTS.zh.aiChatModePrompts[modeKey];
				
				if (isDefaultEn || isDefaultZh || !currentPrompt) {
					this.settings.aiChatModePrompts![modeKey] = localizedPrompts.aiChatModePrompts[modeKey];
					needsSave = true;
				}
			});
		}

		if (needsSave) {
			this.saveSettings();
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Update UI elements and commands dynamically when settings change
		this.updateUIElements();
		this.updateCommands();
	}


	async addImageToAIQueue(imageDataUrl: string, fileName: string, localPath?: string | null): Promise<void> {
		if (!this.aiManager) {
			throw new Error('AI Manager not initialized');
		}
		
		// Find the AI chat view and add image to its queue
		const aiLeaf = this.app.workspace.getLeavesOfType(AI_CHAT_VIEW_TYPE)[0];
		
		if (aiLeaf && (aiLeaf.view as AIChatViewInterface).addImageToQueue) {
			(aiLeaf.view as AIChatViewInterface).addImageToQueue!(imageDataUrl, fileName, localPath || null, 'screenshot');
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
			// Panel doesn't exist, create it using toggle logic
			getLogger().log('Creating new AI panel');
			await this.toggleAIChatPanel();
		}
	}

	async toggleAIChatPanel(): Promise<void> {
		try {
			// Check if AI panel already exists and is visible
			const aiLeaf = this.app.workspace.getLeavesOfType(AI_CHAT_VIEW_TYPE)[0];
			
			if (aiLeaf) {
				// If panel exists, check if it's active
				const rightLeaves = (this.app.workspace as WorkspaceWithSplit).rightSplit?.children || [];
				const isVisible = rightLeaves.some((leaf: any) => leaf === aiLeaf && leaf === (this.app.workspace as WorkspaceWithSplit).activeLeaf);
				
				if (isVisible) {
					// If visible and active, close it
					aiLeaf.detach();
				} else {
					// If exists but not active, reveal it
					this.app.workspace.revealLeaf(aiLeaf);
				}
			} else {
				// If doesn't exist, create and show it (migrated from showAIChatPanel)
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
			}
		} catch (error) {
			getLogger().error('Failed to toggle AI chat panel:', error);
			new Notice(t('plugin.aiChatPanelToggleFailed', { message: error.message }));
		}
	}
	private registerCustomIcons(): void {
        // 添加AI聊天图标
        addIcon('captureai-icon', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100" height="100" fill="none" stroke="currentColor" stroke-width="2">
  <defs>
    <mask id="mask-out-camera" maskUnits="userSpaceOnUse">
      <rect width="64" height="64" fill="white"/>
      <g transform="rotate(-15,32,32)" fill="currentColor" stroke="none">
        <rect x="7" y="21" width="32" height="24" rx="5" ry="5"/>
        <rect x="10" y="16" width="15" height="8" rx="3"/>
      </g>
    </mask>
  </defs>

  <g stroke="currentColor" stroke-width="2" fill="none" opacity="0.6" mask="url(#mask-out-camera)">
    <ellipse cx="32" cy="31" rx="30" ry="14" transform="rotate(20,34,31)" />
    <ellipse cx="32" cy="27" rx="30" ry="14" transform="rotate(-20,30,27)" />
    <circle cx="54" cy="22" r="2" fill="currentColor" stroke="none"/>
    <circle cx="18" cy="46" r="2" fill="currentColor" stroke="none"/>
  </g>

  <g transform="rotate(-15,32,32)" stroke="currentColor" stroke-width="2" fill="none">
    <rect x="9" y="23" width="28" height="20" rx="3" ry="3"/>
    <circle cx="22" cy="33" r="6"/>
    <circle cx="22" cy="33" r="2.5" fill="currentColor" stroke="none"/>
    <rect x="12" y="18" width="10" height="4" rx="1"/>
  </g>
</svg>`);
    }
	

	getElectronAPI() {
		try {
			getLogger().log('🔍 Checking for Electron API...');
			
			// Check for modern Electron API
			if ((window as WindowWithElectron).electron) {
				getLogger().log('✅ Found window.electron');
				const electronAPI = (window as WindowWithElectron).electron;
				getLogger().log('🔍 Electron API properties:', Object.keys(electronAPI));
				return electronAPI;
			}
			
			// Check for legacy require method
			if ((window as WindowWithElectron).require) {
				getLogger().log('✅ Found window.require, attempting to load electron...');
				try {
					const electron = (window ).require('electron');
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
					getLogger().error('❌ Failed to require electron:', requireError);
				}
			}
			
			// Check if we're in a Node.js environment
			getLogger().log('🔍 Environment check:', {
				hasProcess: typeof process !== 'undefined',
				hasGlobal: typeof global !== 'undefined',
				hasWindow: typeof window !== 'undefined',
				userAgent: navigator.userAgent
			});
			
			getLogger().error('❌ No Electron API found');
			return null;
			
		} catch (error: any) {
			getLogger().error('❌ Error accessing Electron API:', error);
			getLogger().error('Error details:', {
				name: error.name,
				message: error.message,
				stack: error.stack
			});
			return null;
		}
	}
}