import { ItemView, WorkspaceLeaf, TFile, Notice, MarkdownRenderer, Component, MarkdownView, Modal, Editor, setIcon, requestUrl, App, Vault } from 'obsidian';
import ImageCapturePlugin from '../main';
import { AIManager, AIMessage, AIConversation } from './ai-manager';
import { ChatHistoryModal } from '../ui/chat-history-modal';
import { t } from '../i18n';
import { getLogger } from '../utils/logger';

// Interface definitions for type safety
interface AppWithSettings extends App {
	setting?: {
		open?: () => void;
		openTabById?: (id: string) => void;
		pluginTabs?: Array<{
			id: string;
			display?: () => void;
		}>;
	};
}

interface ExtendedMessage extends AIMessage {
	images?: Array<{
		localPath?: string;
		dataUrl?: string;
		source?: string;
	}>;
	imageData?: string;
	localPath?: string;
	image?: string;
}

interface SettingsView {
	updateContent?(): void;
}

export const AI_CHAT_VIEW_TYPE = 'ai-chat';

export class AIChatView extends ItemView {
	private plugin: ImageCapturePlugin;
	private aiManager: AIManager;
	private markdownComponent: Component;
	
	// WeakMap storage for DOM element properties - replaces (element as any) patterns
	private inputAreaElements = new WeakMap<HTMLElement, {
		imagePreviewArea?: HTMLElement;
		textInput?: HTMLTextAreaElement;
		sendButton?: HTMLButtonElement;
		currentImageDataList?: any[];
	}>();
	
	private instanceMethods = new WeakMap<any, {
		updateSendButtonState?: () => void;
	}>();
	
	private eventHandlers = new WeakMap<HTMLElement, {
		clickOutsideHandler?: (event: MouseEvent) => void;
		prevClickOutsideHandler?: ((event: MouseEvent) => void) | null;
		dragCleanup?: () => void;
	}>();
	
	// Auto-save management
	private autoSaveTimer: NodeJS.Timeout | null = null;
	private autoSaveInterval = 30000; // 30 seconds
	private lastAutoSaveContent: string | null = null; // 存储上次自动保存的内容
	private lastAutoSaveTime = 0;
	private currentConversationId: string | null = null;
	
	// AI Chat Mode management  
	private currentMode: import('../types').AIChatMode = 'analyze';
	private modeSelector: HTMLButtonElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: ImageCapturePlugin) {
		super(leaf);
		this.plugin = plugin;
		this.aiManager = plugin.aiManager;
		this.markdownComponent = new Component();
		
		// Initialize current mode from settings
		getLogger().log('Initializing AI chat mode:', plugin.settings.defaultAIChatMode);
		this.currentMode = plugin.settings.defaultAIChatMode || 'analyze';
		getLogger().log('Current mode set to:', this.currentMode);
	}

	private createSVGIcon(iconPath: string, size = 16): string {
		return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconPath}</svg>`;
	}

	getViewType(): string {
		return AI_CHAT_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'AI Chat';
	}

	getIcon(): string {
		return 'bot';
	}

	async onOpen(): Promise<void> {
		await this.updateContent();
	}

	async updateContent(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		
		// Check if conversation content has changed and reset auto-save tracking if so
		// Only do this when we actually have different conversation data
		const currentConversation = this.aiManager.getCurrentConversationData();
		if (currentConversation && this.lastAutoSaveContent && currentConversation.messages.length > 0) {
			await this.checkAndResetAutoSaveTracking();
		}
		
		// Check if this is the first time rendering or if the structure doesn't exist
		const existingInputArea = container.querySelector('.ai-chat-input-area') as HTMLElement;
		const existingChatArea = container.querySelector('.ai-chat-area') as HTMLElement;
		const hasExistingStructure = existingInputArea && existingChatArea;
		
		if (!hasExistingStructure) {
			// First time setup - need to create full structure
			await this.fullRender(container);
		} else {
			// Partial update - only update model selector and chat area
			await this.partialUpdate(container);
		}
	}

	private async fullRender(container: HTMLElement): Promise<void> {
		// Save current image queue before clearing container
		let savedImageQueue: any[] = [];
		const oldInputArea = container.querySelector('.ai-chat-input-area') as HTMLElement;
		if (oldInputArea) {
			const inputData = this.inputAreaElements.get(oldInputArea);
			if (inputData && inputData.currentImageDataList) {
				savedImageQueue = [...inputData.currentImageDataList];
				getLogger().log('Saved image queue:', savedImageQueue.length, 'images');
			}
		}
		
		container.empty();
		container.addClass('ai-chat-container');

		// Header with title (remove model selector from header)
		const header = container.createEl('div', { cls: 'ai-chat-header' });
		// 创建一个包含图标和标题的容器
        const titleContainer = header.createEl('div', { cls: 'ai-chat-title-container' });
        
        // 添加图标
        const iconContainer = titleContainer.createEl('div', { cls: 'ai-chat-title-icon' });
        setIcon(iconContainer, 'captureai-icon'); // 使用我们注册的自定义图标
        
		titleContainer.createEl('h3', { text: t('aiChat.title'), cls: 'ai-chat-title' });

		// Chat area
		const chatArea = container.createEl('div', { cls: 'ai-chat-area' });

		// Get current conversation
		const conversation = this.aiManager.getCurrentConversationData();
		
		if (!conversation || conversation.messages.length === 0) {
			// Show enhanced empty state similar to reference image
			this.renderEmptyState(chatArea);
			// Clear auto-save timer for empty conversations
			this.clearAutoSaveTimer();
		} else {
			// Show conversation
			await this.renderConversation(chatArea, conversation);
			
			// Start auto-save timer for active conversations
			this.startAutoSaveTimer();
			
			// Track current conversation ID
			this.currentConversationId = conversation.id;
		}

		// Always add input area for text-only conversations
		this.createInputArea(container, conversation);
		
		// Restore saved image queue
		if (savedImageQueue.length > 0) {
			const newInputArea = container.querySelector('.ai-chat-input-area') as HTMLElement;
			if (newInputArea) {
				const inputData = this.inputAreaElements.get(newInputArea) || {};
				inputData.currentImageDataList = savedImageQueue;
				this.inputAreaElements.set(newInputArea, inputData);
				
				const imagePreviewArea = inputData.imagePreviewArea;
				if (imagePreviewArea) {
					imagePreviewArea.style.display = 'block';
					this.renderImagePreviews(imagePreviewArea, savedImageQueue, newInputArea);
					getLogger().log('Restored image queue:', savedImageQueue.length, 'images');
				}
			}
		}
	}

	private async partialUpdate(container: HTMLElement): Promise<void> {
		// Update the model selector in-place to maintain consistent styling
		const modelSelectorContainer = container.querySelector('.model-selector-container');
		if (modelSelectorContainer) {
			this.updateModelSelectorInPlace(modelSelectorContainer as HTMLElement);
		}

		// Update send button state after model configuration changes
		const instanceMethods = this.instanceMethods.get(this);
		if (instanceMethods && instanceMethods.updateSendButtonState) {
			instanceMethods.updateSendButtonState();
		}

		// Update chat area if needed
		const chatArea = container.querySelector('.ai-chat-area') as HTMLElement;
		const conversation = this.aiManager.getCurrentConversationData();
		
		if (chatArea) {
			chatArea.empty();
			if (!conversation || conversation.messages.length === 0) {
				this.renderEmptyState(chatArea);
				this.clearAutoSaveTimer();
			} else {
				await this.renderConversation(chatArea, conversation);
				this.startAutoSaveTimer();
				this.currentConversationId = conversation.id;
			}
		}
	}

	private updateModelSelectorInPlace(container: HTMLElement): void {
		const allModels = this.plugin.settings.modelConfigs;
		
		// If no models, completely rebuild as we need different structure
		if (allModels.length === 0) {
			container.empty();
			this.createModelSelector(container);
			return;
		}

		// Find existing selector wrapper
		const existingSelectorWrapper = container.querySelector('.model-selector-wrapper') as HTMLElement;
		if (!existingSelectorWrapper) {
			// No existing selector, create new one
			container.empty();
			this.createModelSelector(container);
			return;
		}

		// Update existing selector button content
		const selectorButton = existingSelectorWrapper.querySelector('.model-selector-button') as HTMLButtonElement;
		const dropdown = existingSelectorWrapper.querySelector('.model-dropdown-menu') as HTMLElement;
		
		if (!selectorButton || !dropdown) {
			// Structure is broken, rebuild
			container.empty();
			this.createModelSelector(container);
			return;
		}

		// Update button content with current model
		const currentModel = allModels.find(mc => mc.id === this.plugin.settings.defaultModelConfigId) || allModels[0];
		this.updateSelectorButtonContent(selectorButton, currentModel);

		// Update dropdown options
		dropdown.empty();
		allModels.forEach(modelConfig => {
			const option = dropdown.createEl('div', { 
				cls: 'model-dropdown-option  dropdown-option',
				attr: { 'data-model-id': modelConfig.id }
			});
			
			// Create option content with vision icon
			const optionContent = option.createEl('span', { cls: 'model-option-content dropdown-option-content' });
			optionContent.createEl('span', { text: modelConfig.name, cls: 'model-name' });
			
			if (modelConfig.isVisionCapable) {
				const visionIcon = optionContent.createEl('span', { cls: 'vision-icon' });
				// Using Lucide Eye icon with consistent size for dropdown
				setIcon(visionIcon, 'eye');
			}
			
			if (modelConfig.id === this.plugin.settings.defaultModelConfigId) {
				option.addClass('selected');
			}
			
			// Handle option click - reuse the same logic from createModelSelector
			option.addEventListener('click', async () => {
				// Update selection
				dropdown.querySelectorAll('.model-dropdown-option').forEach(opt => opt.removeClass('selected'));
				option.addClass('selected');
				
				// Update button content
				this.updateSelectorButtonContent(selectorButton, modelConfig);
				
				// Save settings
				this.plugin.settings.defaultModelConfigId = modelConfig.id;
				await this.plugin.saveSettings();
				
				// Update last used timestamp
				modelConfig.lastUsed = new Date();
				await this.plugin.saveSettings();
				
				// Update image preview if there are images to reflect model capability change
				const inputArea = this.containerEl.querySelector('.ai-chat-input-area') as HTMLElement;
				if (inputArea) {
					const inputData = this.inputAreaElements.get(inputArea);
					if (inputData) {
						const imageDataList = inputData.currentImageDataList || [];
						if (imageDataList.length > 0) {
							const imagePreviewArea = inputData.imagePreviewArea;
							if (imagePreviewArea) {
								// Re-render image preview with updated model capability
								this.renderImagePreviews(imagePreviewArea, imageDataList, inputArea);
							}
						}
					}
				}
				
				// Update send button state
				const instanceMethods = this.instanceMethods.get(this);
				if (instanceMethods && instanceMethods.updateSendButtonState) {
					instanceMethods.updateSendButtonState();
				}
				
				// Refresh other model-dependent components (settings page, other AI chat views)
				this.refreshModelDependentComponents();
				
				// Hide dropdown
				const dropdownIcon = selectorButton.querySelector('.model-dropdown-arrow') as HTMLElement;
				this.hideDropdown(dropdown, dropdownIcon);
			});
		});

		// The existing event listeners for button click and document click should still work
		// since we're not removing the wrapper element
	}

	// Method to add image to queue from external sources (like image editor)
	addImageToQueue(imageDataUrl: string, fileName: string, localPath?: string | null, source: string = 'screenshot'): void {
		const inputArea = this.containerEl.querySelector('.ai-chat-input-area') as HTMLElement;
		if (!inputArea) {
			getLogger().error('Input area not found');
			return;
		}
		
		// Check if input area has the required properties
		const inputData = this.inputAreaElements.get(inputArea);
		if (!inputData || !inputData.imagePreviewArea) {
			getLogger().error('Image preview area not initialized');
			return;
		}
		
		// Show image preview by adding to the current image list with local path and source support
		this.showImagePreview(imageDataUrl, fileName, localPath, source);
	}

	private renderEmptyState(chatArea: HTMLElement): void {
		const emptyState = chatArea.createEl('div', { cls: 'ai-chat-empty' });
		
		// Simple title
		// const titleSection = emptyState.createEl('div', { cls: 'ai-chat-title-section' });
		// titleSection.createEl('h2', { text: t('aiChat.assistantTitle'), cls: 'ai-chat-main-title' });
		
		

		// Model status - now includes all models, not just vision models
		const allModels = this.plugin.settings.modelConfigs;
		const visionModels = allModels.filter(mc => mc.isVisionCapable);
		const statusEl = emptyState.createEl('div', { cls: 'ai-status' });
		
		if (allModels.length === 0) {
			statusEl.empty();
			const warningDiv = statusEl.createEl('div', { cls: 'ai-status-warning', text: t('aiChat.noModelsConfigured') });
			const descDiv = statusEl.createEl('div', { cls: 'ai-status-desc', text: t('aiChat.noModelsDescription') });
			statusEl.addEventListener('click', () => {
				// Open settings
				(this.plugin.app as AppWithSettings).setting?.open?.();
				(this.plugin.app as AppWithSettings).setting?.openTabById?.(this.plugin.manifest.id);
			});
		} else {
			const defaultModel = allModels.find(mc => mc.id === this.plugin.settings.defaultModelConfigId) || allModels[0];
			const isDefaultVisionCapable = defaultModel.isVisionCapable;
			
			if (isDefaultVisionCapable) {
				statusEl.empty();
				const totalPlural = allModels.length > 1 ? 's' : '';
				const readyDiv = statusEl.createEl('div', { 
					cls: 'ai-status-ready', 
					text: t('aiChat.readyWithModel', { modelName: defaultModel.name })
				});
				const descDiv = statusEl.createEl('div', { 
					cls: 'ai-status-desc', 
					text: t('aiChat.allModelsConfigured', { 
						total: allModels.length, 
						totalPlural: totalPlural,
						vision: visionModels.length 
					})
				});
			} else {
				// Text-only model - gray status with notice
				statusEl.classList.add('ai-status-text-only');
				const totalPlural = allModels.length > 1 ? 's' : '';
				statusEl.empty();
				const readyDiv = statusEl.createEl('div', { 
					cls: 'ai-status-text-only-ready', 
					text: t('aiChat.readyWithModelTextOnly', { modelName: defaultModel.name })
				});
				const descDiv = statusEl.createEl('div', { 
					cls: 'ai-status-desc', 
					text: visionModels.length > 0 
						? t('aiChat.allModelsConfigured', { 
							total: allModels.length, 
							totalPlural: totalPlural,
							vision: visionModels.length 
						})
						: t('aiChat.textOnlyModelNotice')
				});
			}
		}

		// Instructions section
		const instructionsSection = emptyState.createEl('div', { cls: 'ai-chat-instructions-section' });
		instructionsSection.createEl('h3', { text: t('aiChat.howToUseTitle'), cls: 'ai-chat-section-title' });
		
		const instructionsList = instructionsSection.createEl('div', { cls: 'ai-chat-instructions-list' });
		const instructions = [
			{ icon: '⚙️', text: t('aiChat.instruction.configureKeys') },
			{ icon: '📷', text: t('aiChat.instruction.screenshot') },
			{ icon: '🖼️', text: t('aiChat.instruction.dragDrop') },
			{ icon: '💬', text: t('aiChat.instruction.typeQuestions') }
		];

		instructions.forEach(instruction => {
			const instructionEl = instructionsList.createEl('div', { cls: 'ai-chat-instruction-item' });
			instructionEl.createEl('span', { text: instruction.icon, cls: 'ai-chat-instruction-icon' });
			instructionEl.createEl('span', { text: instruction.text, cls: 'ai-chat-instruction-text' });
		});
	}

	private async startNewConversation(): Promise<void> {
		// Perform final auto-save before starting new conversation
		await this.performFinalAutoSave();
		
		// Reset last saved content for new conversation
		this.lastAutoSaveContent = null;
		
		// Clear current conversation and start fresh
		this.aiManager.cleanup();
		this.currentConversationId = null;
		await this.updateContent();
	}

	private async sendTextMessage(message: string): Promise<void> {
		try {
			// Create or get current conversation
			let conversation = this.aiManager.getCurrentConversationData();
			if (!conversation) {
				// Create a new text-only conversation with temporary title
				conversation = this.aiManager.createNewConversation('新对话');
			}

			// Add user message
			const userMessage = {
				id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
				type: 'user' as const,
				content: message,
				timestamp: new Date()
			};
			conversation.messages.push(userMessage);
			await this.updateContent();

			// Add typing indicator
			const typingMessage = {
				id: 'typing_' + Date.now(),
				type: 'assistant' as const,
				content: '',
				timestamp: new Date(),
				isTyping: true
			};
			conversation.messages.push(typingMessage);
			await this.updateContent();

			// Call AI API for text-only response with context
			const response = await this.callAIForText(message, conversation);

			// Remove typing indicator and add real response
			const typingIndex = conversation.messages.findIndex(m => m.id === typingMessage.id);
			if (typingIndex > -1) {
				conversation.messages.splice(typingIndex, 1);
			}

			// Add AI response
			const assistantMessage = this.createAssistantMessage(response);
			conversation.messages.push(assistantMessage);
			
			await this.updateContent();

		} catch (error) {
			getLogger().error('Failed to send text message:', error);
			// Remove typing indicator
			const conversation = this.aiManager.getCurrentConversationData();
			if (conversation) {
				const typingIndex = conversation.messages.findIndex(m => m.hasOwnProperty('isTyping'));
				if (typingIndex > -1) {
					conversation.messages.splice(typingIndex, 1);
				}
				
				const errorMessage = this.createAssistantMessage(`Error: ${error.message}`);
				conversation.messages.push(errorMessage);
				await this.updateContent();
			}
		}
	}

	private async callAIForText(message: string, conversation: AIConversation): Promise<string> {
		// Use the new context-aware API for text-only conversations
		// 智能判断逻辑已经在 buildContextMessages 内部处理，这里不再需要手动传递 includeModeprompt
		return await this.aiManager.callAIWithContext(conversation, message, undefined, undefined, true);
	}

	private async renderConversation(container: HTMLElement, conversation: AIConversation): Promise<void> {
		const messagesContainer = container.createEl('div', { cls: 'ai-chat-messages' });

		// Render messages sequentially to maintain order
		for (const message of conversation.messages) {
			await this.renderMessage(messagesContainer, message);
		}

		// Scroll to bottom
		messagesContainer.scrollTop = messagesContainer.scrollHeight;
	}

	private formatImagePath(localPath: string | null): string | null {
		if (!localPath) return null;
		
		// If user wants relative paths, just return the path as is
		if (this.plugin.settings.useRelativePath) {
			return localPath;
		}
		
		// If user wants absolute paths, convert to vault absolute path
		// For now, we keep it simple and just return the relative path with vault prefix
		// In a real implementation, you might want to get the actual vault path
		return localPath;
	}

	private getVaultResourceUrl(path: string | null): string | null {
		if (!path) return null;
		
		try {
			// Try to get the file from the vault
			const file = this.plugin.app.vault.getAbstractFileByPath(path);
			if (file && file instanceof TFile) {
				// Get the resource path that Obsidian can use to display the image
				return this.plugin.app.vault.getResourcePath(file);
			}
		} catch (error) {
			getLogger().warn('Failed to get vault resource URL for path:', path, error);
		}
		
		return null;
	}

	private async renderMessage(container: HTMLElement, message: AIMessage): Promise<void> {
		const messageEl = container.createEl('div', { 
			cls: `ai-chat-message ai-chat-message-block` 
		});

		// Message block with avatar on left and content on right
		const messageRow = messageEl.createEl('div', { cls: 'ai-chat-message-row' });
		
		// Avatar section (always on left)
		const avatarSection = messageRow.createEl('div', { cls: 'ai-chat-message-avatar' });
		const avatarIcon = avatarSection.createEl('div', { cls: 'ai-chat-avatar-icon' });
		
		if (message.type === 'user') {
			// User icon
			setIcon(avatarIcon, 'user-round');
			avatarIcon.addClass('user-avatar');
		} else {
			// AI Assistant icon
			setIcon(avatarIcon, 'bot');
			avatarIcon.addClass('ai-avatar');
		}

		// Content section (full width minus avatar)
		const contentSection = messageRow.createEl('div', { cls: 'ai-chat-message-content-section' });
		
		// Header with timestamp on left and action buttons on right
		const messageHeader = contentSection.createEl('div', { cls: 'ai-chat-message-header' });
		messageHeader.createEl('span', { 
			text: this.formatTime(message.timestamp),
			cls: 'ai-chat-message-time'
		});
		
		// Action buttons (4 buttons as requested) - moved to header right
		const actionButtons = messageHeader.createEl('div', { cls: 'ai-chat-message-actions' });

		// Message content with text selection support
		const messageContent = contentSection.createEl('div', { 
			cls: 'ai-chat-message-content',
			attr: { 'data-message-id': message.id }
		});
		
		// Check if message is currently being typed (AI response in progress)
		const isTyping = (message ).isTyping || false;
		
		// 1. Insert at cursor button
		const insertBtn = actionButtons.createEl('button', { 
			cls: 'btn-transparent btn-transparent-sm message-action-btn',
			attr: { 
				title: t('aiChat.insertToCursorButton'),
				'data-tooltip': t('aiChat.insertToCursorButton')
			}

		});
		
		setIcon(insertBtn, 'between-horizontal-end');
		if (isTyping) {
			insertBtn.disabled = true;
			insertBtn.classList.add('ai-chat-button-disabled');
		}
		
		// 2. Copy button  
		const copyBtn = actionButtons.createEl('button', { 
			cls: 'btn-transparent btn-transparent-sm message-action-btn',
			attr: { 
				title: t('aiChat.copyMessageButton'),
				'data-tooltip': t('aiChat.copyMessageButton')
			}
		});

		setIcon(copyBtn, 'copy');
		if (isTyping) {
			copyBtn.disabled = true;
			copyBtn.classList.add('ai-chat-button-disabled');
		}
		
		// 3. Toggle edit/read view button
		const editBtn = actionButtons.createEl('button', { 
			cls: 'btn-transparent btn-transparent-sm message-action-btn',
			attr: { 
				title: t('aiChat.switchEditViewButton'),
				'data-tooltip': t('aiChat.switchEditViewButton')
			}

		});

		setIcon(editBtn, 'square-pen');
		if (isTyping) {
			editBtn.disabled = true;
			editBtn.classList.add('ai-chat-button-disabled');
		}
		
		// 4. Delete button
		const deleteBtn = actionButtons.createEl('button', { 
			cls: 'btn-transparent btn-transparent-sm message-action-btn delete-btn',
			attr: { 
				title: t('aiChat.deleteMessageButton'),
				'data-tooltip': t('aiChat.deleteMessageButton')
			}
		});
		setIcon(deleteBtn, 'trash-2');
		if (isTyping) {
			deleteBtn.disabled = true;
			deleteBtn.classList.add('ai-chat-button-disabled');
		}

		// Add click handlers for buttons
		copyBtn.addEventListener('click', async () => {
			if (copyBtn.disabled) return; // Prevent action if button is disabled
			await this.copyMessage(message);
		});

		// Insert to cursor handler
		insertBtn.addEventListener('click', async () => {
			if (insertBtn.disabled) return; // Prevent action if button is disabled
			await this.insertMessageAtCursor(message);
		});

		// Toggle edit/read view handler
		editBtn.addEventListener('click', async () => {
			if (editBtn.disabled) return; // Prevent action if button is disabled
			await this.toggleMessageEditMode(messageContent, message, editBtn);
		});

		// Delete message handler
		deleteBtn.addEventListener('click', async () => {
			if (deleteBtn.disabled) return; // Prevent action if button is disabled
			await this.deleteMessage(message.id);
		});

		// Enable text selection for the entire message area
		messageEl.addEventListener('keydown', (e) => {
			if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
				this.handleKeyboardCopy(e, message);
			}
		});
		messageEl.setAttribute('tabindex', '0'); // Make it focusable for keyboard events

		// Show text content or typing indicator
		if ((message ).isTyping) {
			const typingEl = messageContent.createEl('div', { cls: 'ai-chat-typing-indicator' });
			typingEl.empty();
			for (let i = 0; i < 3; i++) {
				typingEl.createEl('span', { cls: 'typing-dot' });
			}
		} else if (message.content) {
			// Use new markdown rendering that handles both images and text
			await this.renderMessageContentFromMarkdown(messageContent, message);
		}
	}

	private async copyMessage(message: AIMessage): Promise<void> {
		try {
			if (message.image && message.content) {
				// Copy both image and text
				await this.copyImageAndText(message.image, message.content);
			} else if (message.image) {
				// Copy only image
				await this.copyImage(message.image);
			} else if (message.content) {
				// Copy only text
				await navigator.clipboard.writeText(message.content);
				new Notice(t('aiChat.textCopied'));
			}
		} catch (error) {
			getLogger().error('Failed to copy message:', error);
			new Notice(t('aiChat.copyFailed'));
		}
	}

	private async copyImage(imageDataUrl: string): Promise<void> {
		try {
			// Convert data URL to blob
			const response = await requestUrl(imageDataUrl);
			const blob = new Blob([response.arrayBuffer], { type: response.headers['content-type'] || 'image/png' });
			
			// Copy to clipboard
			await navigator.clipboard.write([
				new ClipboardItem({ [blob.type]: blob })
			]);
			new Notice(t('aiChat.imageCopied'));
		} catch (error) {
			getLogger().error('Failed to copy image:', error);
			new Notice(t('aiChat.copyImageFailed'));
		}
	}

	private handleKeyboardCopy(e: KeyboardEvent, message: AIMessage): void {
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed) return;

		e.preventDefault();
		this.copySelectionAsMarkdown(message, selection);
	}

	private async copySelectionAsMarkdown(message: AIMessage, selection: Selection): Promise<void> {
		try {
			const selectedContent = this.getSelectionAsMarkdown(message, selection);
			await navigator.clipboard.writeText(selectedContent);
			new Notice(t('aiChat.selectionCopied'));
		} catch (error) {
			getLogger().error('Failed to copy selection:', error);
			new Notice(t('aiChat.copySelectionFailed'));
		}
	}

	private getSelectionAsMarkdown(message: AIMessage, selection: Selection): string {
		const range = selection.getRangeAt(0);
		const container = range.cloneContents();
		
		let markdown = '';
		
		// Process each node in the selection
		const walker = document.createTreeWalker(
			container,
			NodeFilter.SHOW_ALL,
			null
		);

		let node;
		while (node = walker.nextNode()) {
			if (node.nodeType === Node.TEXT_NODE) {
				markdown += node.textContent;
			} else if (node.nodeType === Node.ELEMENT_NODE) {
				const element = node as Element;
				
				if (element.tagName === 'IMG') {
					// Convert image to markdown - use local path if available
					const src = element.getAttribute('src');
					const alt = element.getAttribute('alt') || 'image';
					if (src) {
						// Check if this image has a local path in our message data
						const allImages = (message as ExtendedMessage).images;
						if (allImages && allImages.length > 0) {
							// Find matching image data
							const imageData = allImages.find((img: any) => 
								img.dataUrl === src || 
								(img.localPath && this.getVaultResourceUrl(img.localPath) === src)
							);
							if (imageData && imageData.localPath) {
								// Use standard Markdown format with local path and source label
								const sourceLabel = this.getImageSourceLabel(imageData);
								markdown += `![${sourceLabel}](${imageData.localPath})`;
							} else {
								// Fallback to src (might be dataUrl)
								const sourceLabel = this.getImageSourceLabel(null);
								markdown += `![${sourceLabel}](${src})`;
							}
						} else {
							// Single image case
							const singleImageData = (message as ExtendedMessage).imageData;
							const messageLocalPath = (message as ExtendedMessage).localPath;
							if (singleImageData && messageLocalPath) {
								const sourceLabel = this.getImageSourceLabel(messageLocalPath);
								markdown += `![${sourceLabel}](${messageLocalPath})`;
							} else {
								const sourceLabel = this.getImageSourceLabel(null);
								markdown += `![${sourceLabel}](${src})`;
							}
						}
					}
				} else if (element.tagName === 'BR') {
					markdown += '\n';
				} else if (element.tagName === 'P') {
					if (markdown && !markdown.endsWith('\n')) {
						markdown += '\n';
					}
				} else if (element.tagName === 'STRONG' || element.tagName === 'B') {
					markdown += '**' + element.textContent + '**';
				} else if (element.tagName === 'EM' || element.tagName === 'I') {
					markdown += '*' + element.textContent + '*';
				} else if (element.tagName === 'CODE') {
					markdown += '`' + element.textContent + '`';
				} else if (element.tagName === 'H1') {
					markdown += '# ' + element.textContent + '\n';
				} else if (element.tagName === 'H2') {
					markdown += '## ' + element.textContent + '\n';
				} else if (element.tagName === 'H3') {
					markdown += '### ' + element.textContent + '\n';
				}
			}
		}

		// If the selection includes the message's image and no image was processed above
		if (message.image && !markdown.includes('![')) {
			const selectedText = selection.toString().trim();
			// Try to get local path for fallback
			const singleImageData = (message as ExtendedMessage).imageData;
			const allImages = (message as ExtendedMessage).images;
			
			let imagePath = message.image; // fallback to base64
			let imageData = null;
			
			// Try to get local path
			if (allImages && allImages.length > 0 && allImages[0].localPath) {
				imagePath = allImages[0].localPath;
				imageData = allImages[0];
			} else if (singleImageData && (message as ExtendedMessage).localPath) {
				imagePath = (message as ExtendedMessage).localPath!;
				imageData = (message as ExtendedMessage).localPath!;
			}
			
			const sourceLabel = this.getImageSourceLabel(imageData);
			if (selectedText) {
				markdown = `![${sourceLabel}](${imagePath})\n\n${markdown}`;
			} else {
				markdown = `![${sourceLabel}](${imagePath})`;
			}
		}

		return markdown.trim();
	}

	private async copyImageAndText(imageDataUrl: string, text: string): Promise<void> {
		try {
			// Convert data URL to blob
			const response = await requestUrl(imageDataUrl);
			const blob = new Blob([response.arrayBuffer], { type: response.headers['content-type'] || 'image/png' });
			
			// Copy both image and text to clipboard
			await navigator.clipboard.write([
				new ClipboardItem({
					[blob.type]: blob,
					'text/plain': new Blob([text], { type: 'text/plain' })
				})
			]);
			new Notice(t('notice.imageAndTextCopied'));
		} catch (error) {
			getLogger().error('Failed to copy image and text:', error);
			// Fallback to copying just text
			try {
				await navigator.clipboard.writeText(text);
				new Notice(t('notice.textCopiedImageFailed'));
			} catch (textError) {
				new Notice(t('notice.failedToCopyMessage'));
			}
		}
	}

	private createModeSelector(container: HTMLElement): void {
		const { AI_CHAT_MODES } = require('../types');
		
		// Create custom dropdown that opens upward (similar to model selector)
		const modeSelectorWrapper = container.createEl('div', { cls: 'mode-selector-wrapper dropdown-selector-wrapper' });
		
		// Current mode display button
		getLogger().log('Creating mode selector. Current mode:', this.currentMode);
		const currentModeData = AI_CHAT_MODES.find((mode: any) => mode.id === this.currentMode) || AI_CHAT_MODES[0];
		getLogger().log('Current mode data:', currentModeData);
		const selectorButton = modeSelectorWrapper.createEl('button', { 
			cls: 'mode-selector-button dropdown-selector-button'
		});
		
		// Update selector button content
		this.updateModeSelectorButtonContent(selectorButton, currentModeData);
		
		// Dropdown arrow
		const dropdownIcon = selectorButton.createEl('span', { cls: 'mode-dropdown-arrow dropdown-arrow' });
		dropdownIcon.toggleClass('rotated', false); 
		
		// Dropdown menu (initially hidden)
		const dropdown = modeSelectorWrapper.createEl('div', { cls: 'mode-dropdown-menu dropdown-menu' });
		dropdown.toggleClass('visible', false);
		
		// Add mode options
		AI_CHAT_MODES.forEach((mode: any) => {
			const option = dropdown.createEl('div', { 
				cls: 'mode-dropdown-option dropdown-option',
				attr: { 'data-mode-id': mode.id }
			});
			
			// Create option content
			const optionContent = option.createEl('span', { cls: 'mode-option-content dropdown-option-content' });
			optionContent.createEl('span', { text: this.getModeDisplayName(mode.id), cls: 'mode-name' });
			
			if (mode.id === this.currentMode) {
				option.addClass('selected');
			}
			
			// Handle option click
			option.addEventListener('click', async () => {
				// Update selection
				dropdown.querySelectorAll('.mode-dropdown-option').forEach(opt => opt.removeClass('selected'));
				option.addClass('selected');
				
				// Update button content
				this.updateModeSelectorButtonContent(selectorButton, mode);
				
				// Update current mode
				this.currentMode = mode.id;
				
				// Save current mode to settings
				//this.plugin.settings.defaultAIChatMode = this.currentMode;
				//await this.plugin.saveSettings();
				
				// Hide dropdown
				this.hideDropdown(dropdown, dropdownIcon);
			});
		});
		
		
		// Toggle dropdown on button click
		selectorButton.addEventListener('click', (e) => {
			e.stopPropagation();
			this.toggleDropdown(dropdown, dropdownIcon);

		});
		
		// Hide dropdown when clicking outside
		document.addEventListener('click', () => {
			this.hideDropdown(dropdown, dropdownIcon);
		});
		
		// Store reference for later use
		this.modeSelector = selectorButton;
	}

	private toggleDropdown(dropdown: HTMLElement, icon: HTMLElement): void {
	    const isVisible = dropdown.hasClass('visible');
	    dropdown.toggleClass('visible', !isVisible);
	    icon.toggleClass('rotated', !isVisible);
	}

	private hideDropdown(dropdown: HTMLElement, icon: HTMLElement): void {
	    dropdown.toggleClass('visible', false);
	    icon.toggleClass('rotated', false);
	}

	private createInputArea(container: HTMLElement, conversation: AIConversation | null): void {
		const inputArea = container.createEl('div', { cls: 'ai-chat-input-area' });

		// Top action bar (above drag zone) with reduced spacing
		const topActionBar = inputArea.createEl('div', { cls: 'ai-chat-top-action-bar' });
		
		// Left side - AI Chat Mode selector
		const leftActions = topActionBar.createEl('div', { cls: 'ai-chat-left-actions-top' });
		this.createModeSelector(leftActions);
		
		// Right side action buttons (all three buttons right-aligned)
		const rightActions = topActionBar.createEl('div', { cls: 'ai-chat-right-actions-top' });
		
		// Save button with Lucide save icon
		const saveBtn = rightActions.createEl('button', { 
			cls: 'btn-transparent btn-transparent-md ai-chat-action-btn',
			attr: { 
				title: t('aiChat.saveConversationButton'),
				'data-tooltip': t('aiChat.saveConversationButton')
			}
		});

		setIcon(saveBtn, 'save');

		// Chat History button with Lucide history icon
		const historyBtn = rightActions.createEl('button', { 
			cls: 'btn-transparent btn-transparent-md ai-chat-action-btn',
			attr: { 
				title: t('aiChat.loadHistoryButton'),
				'data-tooltip': t('aiChat.loadHistoryButton')
			}
		});

		setIcon(historyBtn, 'history');

		// New chat button with Lucide plus icon
		const newChatBtn = rightActions.createEl('button', { 
			cls: 'btn-transparent btn-transparent-md ai-chat-action-btn',
			attr: { 
				title: t('aiChat.newConversationButton'),
				'data-tooltip': t('aiChat.newConversationButton')
			}
		});

		setIcon(newChatBtn, 'square-plus');

		
		// Menu button with Lucide more-vertical icon
		const menuBtn = rightActions.createEl('button', { 
			cls: 'btn-transparent btn-transparent-md ai-chat-action-btn',
			attr: { 
				title: t('aiChat.menuButton'),
				'data-tooltip': t('aiChat.menuButton')
			}
		});

		setIcon(menuBtn, 'ellipsis');

		// Handle new chat button click
		newChatBtn.addEventListener('click', async () => {
			await this.startNewConversation();
		});

		// Handle save button click
		saveBtn.addEventListener('click', async () => {
			await this.saveConversation();
		});

		// Handle history button click
		historyBtn.addEventListener('click', async () => {
			await this.showHistoryModal();
		});

		// Image preview area (initially hidden)
		const imagePreviewArea = inputArea.createEl('div', { cls: 'ai-chat-image-preview-area' });
		imagePreviewArea.style.display = 'none';

		// Drag and drop zone (like original design)
		const dropZone = inputArea.createEl('div', { cls: 'ai-chat-drop-zone' });
		const dropZoneContent = dropZone.createEl('div', { cls: 'ai-chat-drop-zone-content' });
		
		const dropIcon = dropZoneContent.createEl('span', { cls: 'ai-chat-drop-zone-icon' });

		setIcon(dropIcon, 'image');

		const dropText = dropZoneContent.createEl('span');
		dropText.textContent = t('aiChat.dragImageHere') + ' ';
		
		// Create clickable "browse files" link
		const browseLink = dropZoneContent.createEl('span', { 
			cls: 'file-picker-link',
			text: t('aiChat.browseFiles')
		});
		
		// Only the browse link should be clickable
		browseLink.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.showFilePicker();
		});

		// Main input container (now without embedded send button)
		const inputContainer = inputArea.createEl('div', { cls: 'ai-chat-input-container' });
		
		// Text input 
		const textInput = inputContainer.createEl('textarea', { 
			cls: 'ai-chat-input',
			attr: { 
				placeholder: t('aiChat.inputPlaceholder'),
				rows: '1'
			}
		});

		// Bottom row with model selector and send button
		const bottomRow = inputArea.createEl('div', { cls: 'ai-chat-bottom-row' });
		
		// Model selector with upward popup
		const modelSelectorContainer = bottomRow.createEl('div', { cls: 'model-selector-container' });
		this.createModelSelector(modelSelectorContainer);
		
		// Send-only button (always create, but toggle visibility based on settings)
		const sendOnlyButton = bottomRow.createEl('button', { 
			cls: 'ai-chat-send-only-button',
			attr: { title: t('ui.sendOnlyButton') }
		});
		setIcon(sendOnlyButton, 'book-up');
		// Control visibility based on settings
		sendOnlyButton.toggleClass('invisible', !this.plugin.settings.showSendOnlyButton); 

		// Send button (moved to bottom row, with tooltip)
		const sendButton = bottomRow.createEl('button', { 
			cls: 'ai-chat-send-button-bottom',
			attr: { title: t('aiChat.sendMessageTooltip') }
		});

		setIcon(sendButton, 'send');


		// Setup drag and drop on the entire input area
		this.setupDragAndDrop(inputArea);

		// Store references for image handling
		this.inputAreaElements.set(inputArea, {
			imagePreviewArea: imagePreviewArea,
			textInput: textInput,
			sendButton: sendButton,
			currentImageDataList: []
		});

		// Handle sending messages
		const checkModelConfigured = () => {
			const allModels = this.plugin.settings.modelConfigs;
			return allModels.length > 0;
		};

		const updateSendButtonState = () => {
			const hasModels = checkModelConfigured();
			sendButton.disabled = !hasModels;
			if (!hasModels) {
				sendButton.classList.add('no-models-disabled');
				sendButton.setAttribute('title', 'Please configure at least one AI model in Settings > Set Keys');
			} else {
				sendButton.classList.remove('no-models-disabled');
				sendButton.setAttribute('title', t('aiChat.sendMessageTooltip'));
			}
		};

		const sendMessage = async (sendOnly: boolean = false) => {
			const message = textInput.value.trim();
			const inputData = this.inputAreaElements.get(inputArea);
			const imageDataList = inputData?.currentImageDataList || [];
			
			if (!message && imageDataList.length === 0) return;

			// For AI responses, check if models are configured
			if (!sendOnly && !checkModelConfigured()) {
				new Notice(t('notice.pleaseConfigureModel'));
				return;
			}

			// Get current model to check vision capability (only needed for AI responses)
			let currentModel: any = undefined;
			let isVisionCapable = false;
			if (!sendOnly) {
				const allModels = this.plugin.settings.modelConfigs;
				currentModel = allModels.find(mc => mc.id === this.plugin.settings.defaultModelConfigId) || allModels[0];
				isVisionCapable = currentModel?.isVisionCapable || false;
			}

			// Clear text input
			textInput.value = '';
			if (!sendOnly) {
				sendButton.disabled = true;
				setIcon(sendButton, 'hourglass');
			}

			try {
				// Get or create conversation
				let conversation = this.aiManager.getCurrentConversationData();
				if (!conversation) {
					conversation = this.aiManager.createNewConversation('新对话');
				}

				// Handle vision capability check for AI responses
				if (!sendOnly && imageDataList.length > 0 && !isVisionCapable) {
					// For non-vision models, keep images in preview and only send text
					if (!message) {
						new Notice(t('aiChat.nonVisionModelCannotSendImages'));
						this.updateImagePreviewForNonVisionModel(inputArea, imageDataList);
						return;
					}
					this.updateImagePreviewForNonVisionModel(inputArea, imageDataList);
				}

				// Build messages for AI (only for AI responses)
				let messagesToSend: any[] = [];
				let currentImages: string[] = [];
				
				if (!sendOnly && imageDataList.length > 0 && isVisionCapable) {
					// Process images for vision-capable models
					currentImages = imageDataList.map((img: any) => img.dataUrl);
					// Build messages for AI (this includes system prompt, context, mode prompt, current message)
					messagesToSend = await this.aiManager.buildContextMessages(
						conversation, 
						message, 
						currentImages, 
						currentModel, 
						true
					);
				}

				// Create and add user message to conversation
				const userMessage = await this.createUserMessage(message, imageDataList);
				conversation.messages.push(userMessage);
				await this.updateContent();

				// Clear image preview after message is created (releases preview references)
				if (imageDataList.length > 0) {
					this.clearImagePreview(inputArea);
				}

				// If send-only, we're done
				if (sendOnly) {
					// Reset auto-save content tracking
					this.lastAutoSaveContent = null;
					return;
				}

				// Add typing indicator for AI response
				const typingMessage = {
					id: 'typing_' + Date.now(),
					type: 'assistant' as const,
					content: '',
					timestamp: new Date(),
					isTyping: true
				};
				conversation.messages.push(typingMessage);
				await this.updateContent();

				// Send to AI and get response
				const response = await this.aiManager.sendPreBuiltMessagesToAI(messagesToSend, currentModel);

				// Remove typing indicator
				const typingIndex = conversation.messages.findIndex(m => m.hasOwnProperty('isTyping'));
				if (typingIndex > -1) {
					conversation.messages.splice(typingIndex, 1);
				}

				// Add AI response
				const assistantMessage = this.createAssistantMessage(response);
				conversation.messages.push(assistantMessage);
				
				await this.updateContent();

				// Reset auto-save content tracking since conversation content changed
				this.lastAutoSaveContent = null;

			} catch (error) {
				getLogger().error('Failed to send message:', error);
				
				// Handle error cleanup
				const conversation = this.aiManager.getCurrentConversationData();
				if (conversation) {
					// Remove typing indicator if it exists
					const typingIndex = conversation.messages.findIndex(m => m.hasOwnProperty('isTyping'));
					if (typingIndex > -1) {
						conversation.messages.splice(typingIndex, 1);
						await this.updateContent();
					}
					
					// Also remove the user message that was added before the AI call failed (only for AI calls)
					if (!sendOnly) {
						const lastMessageIndex = conversation.messages.length - 1;
						if (lastMessageIndex >= 0 && conversation.messages[lastMessageIndex].type === 'user') {
							const removedMessage = conversation.messages[lastMessageIndex];
							// 移除消息时，减少消息块中图片的引用计数（消息块释放引用）
							this.aiManager.getImageReferenceManager().updateRefsFromContent(removedMessage.content, false);
							conversation.messages.splice(lastMessageIndex, 1);
							await this.updateContent();
						}
					}
				}
				// Restore text input on error - images are already cleared
				textInput.value = message;
				new Notice(`❌ Error: ${error.message}`);
			} finally {
				if (!sendOnly) {
					sendButton.disabled = false;
					setIcon(sendButton, 'send');
				}
			}
		};

		sendButton.addEventListener('click', () => sendMessage(false));

		// Add event listener for send-only button
		sendOnlyButton.addEventListener('click', () => sendMessage(true));

		// Send on Enter (not Shift+Enter) - only if models are configured
		textInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				if (checkModelConfigured()) {
					sendMessage(false);
				} else {
					new Notice(t('notice.pleaseConfigureModel'));
				}
			}
		});

		// Auto-resize textarea
		textInput.addEventListener('input', () => {
			textInput.style.height = 'auto';
			textInput.style.height = Math.min(textInput.scrollHeight, 120) + 'px';
		});

		// Store update function for later use
		this.instanceMethods.set(this, { updateSendButtonState });
		
		// Initialize button state
		updateSendButtonState();
	}

	private createModelSelector(container: HTMLElement): void {
		const allModels = this.plugin.settings.modelConfigs;
		
		if (allModels.length === 0) {
			const noModelsEl = container.createEl('div', { 
				text: 'No models configured',
				cls: 'no-models-indicator'
			});
			return;
		}

		// Create custom dropdown that opens upward
		const selectorWrapper = container.createEl('div', { cls: 'model-selector-wrapper dropdown-selector-wrapper' });
		
		// Current model display button
		const currentModel = allModels.find(mc => mc.id === this.plugin.settings.defaultModelConfigId) || allModels[0];
		const selectorButton = selectorWrapper.createEl('button', { 
			cls: 'model-selector-button dropdown-selector-button'
		});
		
		// Update selector button content with vision icon if applicable
		this.updateSelectorButtonContent(selectorButton, currentModel);
		
		// Dropdown arrow
		const dropdownIcon = selectorButton.createEl('span', { cls: 'model-dropdown-arrow dropdown-arrow' });
		dropdownIcon.toggleClass('rotated', false); 
		
		// Dropdown menu (initially hidden)
		const dropdown = selectorWrapper.createEl('div', { cls: 'model-dropdown-menu dropdown-menu' });
		dropdown.toggleClass('visible', false); 
		
		// Add model options
		allModels.forEach(modelConfig => {
			const option = dropdown.createEl('div', { 
				cls: 'model-dropdown-option dropdown-option',
				attr: { 'data-model-id': modelConfig.id }
			});
			
			// Create option content with vision icon
			const optionContent = option.createEl('span', { cls: 'model-option-content dropdown-option-content' });
			optionContent.createEl('span', { text: modelConfig.name, cls: 'model-name' });
			
			if (modelConfig.isVisionCapable) {
				const visionIcon = optionContent.createEl('span', { cls: 'vision-icon' });
				// Using Lucide Eye icon with consistent size for dropdown
				setIcon(visionIcon, 'eye');
			}
			
			if (modelConfig.id === this.plugin.settings.defaultModelConfigId) {
				option.addClass('selected');
			}
			
			// Handle option click
			option.addEventListener('click', async () => {
				// Update selection
				dropdown.querySelectorAll('.model-dropdown-option').forEach(opt => opt.removeClass('selected'));
				option.addClass('selected');
				
				// Update button content
				this.updateSelectorButtonContent(selectorButton, modelConfig);
				
				// Save settings
				this.plugin.settings.defaultModelConfigId = modelConfig.id;
				await this.plugin.saveSettings();
				
				// Update last used timestamp
				modelConfig.lastUsed = new Date();
				await this.plugin.saveSettings();
				
				// Update image preview if there are images to reflect model capability change
				const inputArea = this.containerEl.querySelector('.ai-chat-input-area') as HTMLElement;
				if (inputArea) {
					const inputData = this.inputAreaElements.get(inputArea);
					if (inputData) {
						const imageDataList = inputData.currentImageDataList || [];
						if (imageDataList.length > 0) {
							const imagePreviewArea = inputData.imagePreviewArea;
							if (imagePreviewArea) {
								// Re-render image preview with updated model capability
								this.renderImagePreviews(imagePreviewArea, imageDataList, inputArea);
							}
						}
					}
				}
				
				// Update model selector content and send button state
				const modelSelectorContainer = this.containerEl.querySelector('.model-selector-container');
				if (modelSelectorContainer) {
					modelSelectorContainer.empty();
					this.createModelSelector(modelSelectorContainer as HTMLElement);
				}
				
				// Update send button state
				const instanceMethods = this.instanceMethods.get(this);
				if (instanceMethods && instanceMethods.updateSendButtonState) {
					instanceMethods.updateSendButtonState();
				}
				
				// Refresh other model-dependent components (settings page, other AI chat views)
				this.refreshModelDependentComponents();
				
				// Hide dropdown
				this.hideDropdown(dropdown, dropdownIcon);
			});
		});
		
		// Handle button click to toggle dropdown
		selectorButton.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			
			this.toggleDropdown(dropdown, dropdownIcon);
		});
		
		// Create a cleanup function for document listener and store it
		const clickOutsideHandler = (e: MouseEvent) => {
			if (!selectorWrapper.contains(e.target as Node)) {
				this.hideDropdown(dropdown, dropdownIcon);
			}
		};
		
		// Store the handler for cleanup
		this.eventHandlers.set(selectorWrapper, { clickOutsideHandler });
		
		// Add document listener
		document.addEventListener('click', clickOutsideHandler);
		
		// Clean up previous handler if it exists
		const containerEvents = this.eventHandlers.get(container);
		if (containerEvents && containerEvents.prevClickOutsideHandler) {
			document.removeEventListener('click', containerEvents.prevClickOutsideHandler);
		}
		
		const updatedEvents = containerEvents || {};
		updatedEvents.prevClickOutsideHandler = clickOutsideHandler;
		this.eventHandlers.set(container, updatedEvents);
	}

	private showFilePicker(): void {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = 'image/*';
		input.addEventListener('change', async (e) => {
			const file = (e.target as HTMLInputElement).files?.[0];
			if (file) {
				try {
					const dataUrl = await this.fileToDataUrl(file);
					
					// Treat browse files as temporary images (don't save to vault immediately)
					// They will only be saved when manually saving conversation
					this.showImagePreview(dataUrl, file.name, null, 'external');
				} catch (error) {
					getLogger().error('Failed to process selected image:', error);
					new Notice(`Failed to process image: ${error.message}`);
				}
			}
		});
		input.click();
	}

	private updateImagePreviewForNonVisionModel(inputArea: HTMLElement, imageDataList: any[]): void {
		const inputData = this.inputAreaElements.get(inputArea);
		if (!inputData || !inputData.imagePreviewArea) return;
		
		// Update the current image data list
		inputData.currentImageDataList = imageDataList;
		this.inputAreaElements.set(inputArea, inputData);
		
		// Re-render with automatic model capability detection
		this.renderImagePreviews(inputData.imagePreviewArea, imageDataList, inputArea);
	}

	private renderImagePreviews(container: HTMLElement, imageDataList: any[], inputArea: HTMLElement, isNonVisionModel: boolean = false): void {

		container.empty();

		if (imageDataList.length === 0) {
			container.style.display = 'none';
			return;
		}
		
		// Check current model vision capability if not explicitly provided
		if (!isNonVisionModel) {
			const allModels = this.plugin.settings.modelConfigs;
			const currentModel = allModels.find(mc => mc.id === this.plugin.settings.defaultModelConfigId) || allModels[0];
			isNonVisionModel = !(currentModel?.isVisionCapable || false);
		}
		
		const previewContainer = container.createEl('div', { cls: 'images-preview-container' });
		
		// Header with count or warning
		const headerEl = previewContainer.createEl('div', { cls: 'preview-header' });
		if (isNonVisionModel) {
			headerEl.createEl('span', { 
				text: t('aiChat.nonVisionModelWarning'), 
				cls: 'preview-count non-vision-warning' 
			});
		} else {
			const plural = imageDataList.length > 1 ? 's' : '';
			headerEl.createEl('span', { 
				text: t('aiChat.imagesReadyToSend', { count: imageDataList.length, plural }), 
				cls: 'preview-count' 
			});
		}
		
		const clearAllBtn = headerEl.createEl('button', { 
			cls: 'btn-transparent btn-transparent-md ai-chat-action-btn',
			attr: { 
				title: t('aiChat.clearAllImages'),
				'data-tooltip': t('aiChat.clearAllImages')
			}
		});

		setIcon(clearAllBtn, 'trash-2');

		clearAllBtn.addEventListener('click', () => {
			this.clearImagePreview(inputArea);
		});
		
		// Images grid
		const imagesGrid = previewContainer.createEl('div', { cls: 'images-grid' });
		
		imageDataList.forEach((imageData, index) => {
			const imageItem = imagesGrid.createEl('div', { cls: 'preview-image-item' });
			
			const img = imageItem.createEl('img', { 
				cls: 'preview-image-thumb',
				attr: { src: imageData.dataUrl, alt: imageData.fileName }
			});
			
			// Make the image draggable and set drag data for proper Obsidian integration
			img.draggable = true;
			img.addEventListener('dragstart', (e) => {
				getLogger().log('Image drag started:', imageData.fileName, 'localPath:', imageData.localPath);
				
				if (imageData.localPath && imageData.localPath.trim()) {
					// Try multiple dataTransfer formats for maximum compatibility
					const localPath = imageData.localPath;
					
					// Verify the file exists before drag
					const vault = this.plugin.app.vault;
					const file = vault.getAbstractFileByPath(localPath);
					
					if (file) {
						getLogger().log('✅ File exists in vault:', localPath);
						
						// 1. Standard text/plain with just filename for internal links
						e.dataTransfer?.setData('text/plain', `![[${file.name}]]`);
						
						// 2. Alternative: full path
						e.dataTransfer?.setData('text/uri-list', localPath);
						
						// 3. Try Obsidian's wikilink format
						e.dataTransfer?.setData('text/html', `![[${localPath}]]`);
						
						// 4. File reference format
						e.dataTransfer?.setData('application/x-obsidian-file', JSON.stringify({
							type: 'file',
							path: localPath,
							name: imageData.fileName
						}));
						
						getLogger().log('Set drag data for existing vault file:', file.name);
					} else {
						getLogger().log('⚠️ File not found in vault, using path:', localPath);
						// Fallback to original behavior
						e.dataTransfer?.setData('text/plain', localPath);
					}
					
					getLogger().log('Set multiple drag data formats for vault path:', localPath);
				} else {
					// Fallback: if no local path, still try to handle gracefully
					getLogger().log('No localPath found, using dataUrl fallback for:', imageData.fileName);
					e.dataTransfer?.setData('text/plain', imageData.dataUrl);
					
					// Log warning about missing local path
					getLogger().warn('⚠️ Image dragged without local path - this will result in pasted image behavior:', imageData);
				}
			});
			
			// Add click handler for image preview
			img.addEventListener('click', () => {
				this.showImageModal(imageData.dataUrl);
			});
			
			const infoOverlay = imageItem.createEl('div', { cls: 'image-info-overlay' });
			infoOverlay.createEl('span', { text: imageData.fileName, cls: 'image-filename-overlay' });
			
			// Create remove button directly on imageItem, not in infoOverlay
			const removeBtn = imageItem.createEl('button', { cls: 'remove-single-image-btn' });
			removeBtn.textContent = '✕'; // Use heavy multiplication X
			removeBtn.title = t('aiChat.removeThisImage');
			removeBtn.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.removeImageFromPreview(imageData.id, inputArea);
			});
		});
	}

	private removeImageFromPreview(imageId: string, inputArea: HTMLElement): void {
		const inputData = this.inputAreaElements.get(inputArea);
		if (!inputData) return;
		
		const imageDataList = inputData.currentImageDataList || [];
		const filteredList = imageDataList.filter((img: any) => img.id !== imageId);
		inputData.currentImageDataList = filteredList;
		this.inputAreaElements.set(inputArea, inputData);
		
		const imagePreviewArea = inputData.imagePreviewArea;
		if (imagePreviewArea) {
			this.renderImagePreviews(imagePreviewArea, filteredList, inputArea);
		}
	}

	private showImagePreview(dataUrl: string, fileName: string, localPath?: string | null, source: string = 'external'): void {
		const inputArea = this.containerEl.querySelector('.ai-chat-input-area') as HTMLElement;
		if (!inputArea) return;

		const inputData = this.inputAreaElements.get(inputArea);
		if (!inputData || !inputData.imagePreviewArea) return;
		
		const imageDataList = inputData.currentImageDataList || [];
		
		getLogger().log('📸 Adding image to preview:', { fileName, source, localPath });
		
		// 创建图片数据对象
		let newImageData;
		
		if (source === 'vault' && localPath) {
			// Vault图片 - 直接使用路径，不需要通过ImageReferenceManager
			newImageData = { 
				dataUrl, 
				fileName, 
				id: Date.now().toString(),
				localPath: localPath,
				source: source,
				imageRef: localPath  // vault图片使用文件路径作为引用
			};
			getLogger().log('✅ Created vault image data:', newImageData);
		} else {
			// 临时图片 - 通过ImageReferenceManager管理
			const tempId = this.aiManager.getImageReferenceManager().addTempImage(dataUrl, source, fileName);
			newImageData = { 
				dataUrl, 
				fileName, 
				id: Date.now().toString(),
				localPath: localPath || null,
				source: source,
				tempId: tempId,  // 存储临时图片ID
				imageRef: `temp:${tempId}`  // 临时图片使用temp:协议引用
			};
			getLogger().log('✅ Created temp image data:', { tempId, source, fileName });
		}
		
		imageDataList.push(newImageData);
		inputData.currentImageDataList = imageDataList;
		this.inputAreaElements.set(inputArea, inputData);
		
		inputData.imagePreviewArea.style.display = 'block';

		// Render all images in preview
		this.renderImagePreviews(inputData.imagePreviewArea, imageDataList, inputArea);
	}

	/**
	 * 创建用户消息块
	 * 这个过程中会：
	 * 1. 构建消息内容（包括图片引用）
	 * 2. 为消息中的图片增加引用计数（消息块持有引用）
	 */
	private async createUserMessage(textContent: string, imageDataList: any[]): Promise<any> {
		let finalContent = textContent;
		
		// Handle images for display in chat
		if (imageDataList.length > 0) {
			const imageReferences: string[] = [];
			
			for (const img of imageDataList) {
				if (img.source === 'vault' && img.localPath) {
					// Vault图片 - 使用文件路径
					imageReferences.push(`![${img.source}](${img.localPath})`);
				} else if (img.tempId) {
					// 临时图片 - 在编辑视图下统一显示为 [tempimage]
					imageReferences.push(`![tempimage](temp:${img.tempId})`);
				}
			}
			
			// Combine text and image references
			finalContent = imageReferences.join('\n') + (textContent ? '\n\n' + textContent : '');
		}

		const message = this.createMessage('user', finalContent);
		
		// 只有用户消息增加图片引用计数（用户消息拥有图片）
		this.aiManager.getImageReferenceManager().updateRefsFromContent(message.content, true);
		
		return message;
	}

	/**
	 * 创建AI助手消息块
	 * AI消息不拥有图片引用，只是引用它们，所以不需要增加引用计数
	 */
	private createAssistantMessage(content: string): any {
		const message = {
			id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
			type: 'assistant' as const,
			content: content,
			timestamp: new Date()
		};

		// AI消息不增加图片引用计数，因为AI只是引用图片，不拥有它们
		return message;
	}

	/**
	 * 统一的消息创建函数
	 * 处理消息ID生成、时间戳等
	 */
	private createMessage(type: 'user' | 'assistant', content: string): any {
		const message = {
			id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
			type: type,
			content: content,
			timestamp: new Date()
		};

		return message;
	}

	private clearImagePreview(inputArea: HTMLElement): void {
		const inputData = this.inputAreaElements.get(inputArea);
		if (!inputData || !inputData.imagePreviewArea) return;
		
		// 减少预发送区所有临时图片的引用计数（预发送区释放引用）
		const imageDataList = inputData.currentImageDataList || [];
		
		imageDataList.forEach(imageData => {
			if (imageData.tempId) {
				this.aiManager.getImageReferenceManager().removeRef(imageData.tempId);
			}
		});
		
		// 清理UI显示
		inputData.imagePreviewArea.style.display = 'none';
		inputData.imagePreviewArea.empty();
		inputData.currentImageDataList = [];
		this.inputAreaElements.set(inputArea, inputData);
	}

	private setupDragAndDrop(inputArea: HTMLElement): void {
		const dropZone = inputArea.querySelector('.ai-chat-drop-zone') as HTMLElement;
		if (!dropZone) return;

		const handleDragEnter = (e: DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			
			if (e.dataTransfer) {
				e.dataTransfer.dropEffect = 'copy';
			}
			
			dropZone.addClass('ai-chat-drop-zone-active');
		};

		const handleDragLeave = (e: DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			
			// 只在真正离开dropZone时移除激活状态
			const rect = dropZone.getBoundingClientRect();
			const x = e.clientX;
			const y = e.clientY;
			
			if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
				dropZone.removeClass('ai-chat-drop-zone-active');
			}
		};

		const handleDragOver = (e: DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			if (e.dataTransfer) {
				e.dataTransfer.dropEffect = 'copy';
			}
		};

		const handleDrop = async (e: DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			dropZone.removeClass('ai-chat-drop-zone-active');

			if (!e.dataTransfer) return;

			// First, try to handle Obsidian internal drag (from markdown files, etc.)
			try {
				const dragData = e.dataTransfer.getData('text/plain');
				getLogger().log('Drag data received:', dragData);
				
				if (dragData) {
					// First, check if this is already a vault file by extracting the path
					const filePath = this.extractFilePathFromDragData(dragData);
					if (filePath) {
						// Check if file exists in vault
						const vault = this.plugin.app.vault;
						const abstractFile = vault.getAbstractFileByPath(filePath);
						
						if (abstractFile && abstractFile instanceof TFile && abstractFile.extension.match(/^(png|jpe?g|gif|webp|bmp|svg)$/i)) {
							// This is a vault image file - use it directly without re-saving
							getLogger().log('Found existing vault image file:', filePath);
							const dataUrl = await this.fileToDataUrl(await this.getFileFromVault(abstractFile));
							this.showImagePreview(dataUrl, abstractFile.name, filePath, 'vault');
							return; // Successfully handled as existing vault file
						}
					}
					
					// If not found in vault, try to handle as vault file drop (for other formats)
					const vaultFile = await this.handleVaultFileDrop(dragData);
					if (vaultFile && vaultFile.type.startsWith('image/')) {
						getLogger().log('Successfully processed vault file:', vaultFile.name);
						const dataUrl = await this.fileToDataUrl(vaultFile);
						// Extract the file path from the vault file processing
						const extractedPath = this.extractFilePathFromDragData(dragData);
						this.showImagePreview(dataUrl, vaultFile.name, extractedPath, 'vault');
						return; // Successfully handled as vault file, exit early
					}
				}
			} catch (error) {
				getLogger().log('Vault file processing failed, trying external files:', error);
			}

			// If vault file processing failed, try external files
			const files = e.dataTransfer.files;
			if (!files || files.length === 0) return;

			// Filter for image files only
			const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
			
			if (imageFiles.length === 0) {
				new Notice(t('notice.pleaseDropImageFilesOnly'));
				return;
			}

			try {
				// Process all external image files as temporary images
				for (const file of imageFiles) {
					const dataUrl = await this.fileToDataUrl(file);
					// Treat external drag files as temporary images (don't save to vault immediately)
					// They will only be saved when manually saving conversation
					this.showImagePreview(dataUrl, file.name, null, 'external');
				}
			} catch (error) {
				getLogger().error('Failed to process dropped images:', error);
				new Notice(`Failed to process images: ${error.message}`);
			}
		};

		// 只监听dropZone本身的事件
		dropZone.addEventListener('dragenter', handleDragEnter);
		dropZone.addEventListener('dragleave', handleDragLeave);
		dropZone.addEventListener('dragover', handleDragOver);
		dropZone.addEventListener('drop', handleDrop);

		// Store cleanup function
		this.eventHandlers.set(dropZone, {
			dragCleanup: () => {
				dropZone.removeEventListener('dragenter', handleDragEnter);
				dropZone.removeEventListener('dragleave', handleDragLeave);
				dropZone.removeEventListener('dragover', handleDragOver);
				dropZone.removeEventListener('drop', handleDrop);
			}
		});
	}

	private async saveExternalImageToVault(dataUrl: string, fileName: string): Promise<string | null> {
		try {
			// Convert dataUrl to binary data
			const base64Data = dataUrl.replace(/^data:image\/[^;]+;base64,/, "");
			const binaryData = atob(base64Data);
			const bytes = new Uint8Array(binaryData.length);
			for (let i = 0; i < binaryData.length; i++) {
				bytes[i] = binaryData.charCodeAt(i);
			}
			
			// Save to plugin's configured other source location
			const vault = this.plugin.app.vault;
			const adapter = vault.adapter;
			
			// Use plugin's other source save location
			const saveLocation = this.plugin.settings.otherSourceImageLocation || 'screenshots-capture/othersourceimage';
			getLogger().log('Saving external image to location:', saveLocation);
			
			// Ensure save directory exists
			if (!await adapter.exists(saveLocation)) {
				getLogger().log('Creating directory:', saveLocation);
				try {
					await vault.createFolder(saveLocation);
				} catch (error) {
					getLogger().error('Failed to create save directory:', error);
					throw new Error(`Failed to create directory ${saveLocation}: ${error.message}`);
				}
			}
			
			// Generate unique filename to avoid conflicts
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
			const extension = fileName.split('.').pop() || 'png';
			const baseName = fileName.replace(/\.[^/.]+$/, ''); // Remove extension
			const uniqueFileName = `${baseName}-${timestamp}.${extension}`;
			const savePath = `${saveLocation}/${uniqueFileName}`;
			
			// Write file to vault
			await vault.adapter.writeBinary(savePath, bytes.buffer);
			
			getLogger().log('External image saved to vault:', savePath);
			return savePath;
			
		} catch (error: any) {
			getLogger().error('Failed to save external image to vault:', error);
			return null;
		}
	}

	private extractFilePathFromDragData(dragData: string): string | null {
		if (!dragData) return null;
		
		getLogger().log('Extracting file path from drag data:', dragData);
		let filePath = dragData;
		
		// Handle obsidian:// protocol URLs
		if (filePath.startsWith('obsidian://open?')) {
			const url = new URL(filePath);
			const fileParam = url.searchParams.get('file');
			if (fileParam) {
				filePath = decodeURIComponent(fileParam);
				getLogger().log('Extracted file path from obsidian URL:', filePath);
			}
		}
		// Handle file:// URLs  
		else if (filePath.startsWith('file://')) {
			filePath = decodeURIComponent(filePath.replace('file://', ''));
		}
		// Handle direct image file paths (most common case from vault)
		else if (filePath.match(/\.(png|jpe?g|gif|webp|bmp|svg)$/i)) {
			getLogger().log('Direct image file path detected:', filePath);
		}
		// Handle markdown link formats
		else if (filePath.includes('[[') && filePath.includes(']]')) {
			filePath = filePath.replace(/^!?\[\[/, '').replace(/\]\]$/, '');
			getLogger().log('Extracted from markdown link:', filePath);
		}
		
		// Clean up the path
		filePath = filePath.trim();
		
		getLogger().log('Cleaned file path:', filePath);
		
		// Try to find the file in the vault to get the correct path
		const vault = this.plugin.app.vault;
		const abstractFile = vault.getAbstractFileByPath(filePath);
		
		if (abstractFile) {
			getLogger().log('Found file in vault by path:', abstractFile.path);
			return abstractFile.path;
		}
		
		// Try to find by name if full path didn't work
		const fileName = filePath.split('/').pop() || filePath;
		const allFiles = vault.getFiles();
		const foundFile = allFiles.find(file => 
			file.name === fileName || 
			file.name === filePath ||
			file.path === filePath ||
			file.path.endsWith(filePath)
		);
		
		if (foundFile) {
			getLogger().log('Found file in vault by name/path search:', foundFile.path);
			return foundFile.path;
		}
		
		getLogger().log('File not found in vault, returning original path:', filePath);
		return filePath;
	}

	private async handleVaultFileDrop(data: string): Promise<File | null> {
		try {
			getLogger().log('Attempting to resolve vault file from data:', data);
			
			// Try different ways to parse the file path
			let filePath = data;
			
			// Handle obsidian:// protocol URLs
			if (filePath.startsWith('obsidian://open?')) {
				const url = new URL(filePath);
				const fileParam = url.searchParams.get('file');
				if (fileParam) {
					filePath = decodeURIComponent(fileParam);
					getLogger().log('Extracted file path from obsidian URL:', filePath);
				}
			}
			// Remove any other URL encoding or special formatting
			else if (filePath.startsWith('file://')) {
				filePath = decodeURIComponent(filePath.replace('file://', ''));
			}
			
			// Remove any markdown link formatting like [[filename]] or ![[filename]]
			filePath = filePath.replace(/^!?\[\[/, '').replace(/\]\]$/, '');
			
			// Clean up the path
			filePath = filePath.trim();
			
			getLogger().log('Cleaned file path:', filePath);
			
			// Try to get the file from the vault
			const vault = this.plugin.app.vault;
			const abstractFile = vault.getAbstractFileByPath(filePath);
			
			if (!abstractFile || !(abstractFile instanceof TFile)) {
				getLogger().log('File not found directly, trying alternative methods...');
				
				// Try to find by name if full path didn't work
				const fileName = filePath.split('/').pop() || filePath;
				const allFiles = vault.getFiles();
				const foundFile = allFiles.find(file => 
					file.name === fileName || 
					file.name === filePath ||
					file.path === filePath ||
					file.path.endsWith(filePath)
				);
				
				if (!foundFile) {
					getLogger().log('Could not find file in vault:', filePath);
					return null;
				}
				
				getLogger().log('Found file by name:', foundFile.path);
				const buffer = await vault.readBinary(foundFile);
				const blob = new Blob([buffer], { type: this.getMimeType(foundFile.extension) });
				return new File([blob], foundFile.name, { type: this.getMimeType(foundFile.extension) });
			}
			
			// Read the file as binary
			const file = abstractFile;
			getLogger().log('Reading vault file:', file.path);
			
			const buffer = await vault.readBinary(file);
			const mimeType = this.getMimeType(file.extension);
			const blob = new Blob([buffer], { type: mimeType });
			
			return new File([blob], file.name, { type: mimeType });
			
		} catch (error) {
			getLogger().error('Failed to handle vault file drop:', error);
			return null;
		}
	}

	private async getFileFromVault(tFile: TFile): Promise<File> {
		const vault = this.plugin.app.vault;
		const buffer = await vault.readBinary(tFile);
		const mimeType = this.getMimeType(tFile.extension);
		const blob = new Blob([buffer], { type: mimeType });
		return new File([blob], tFile.name, { type: mimeType });
	}

	private getMimeType(extension: string): string {
		const ext = extension.toLowerCase();
		switch (ext) {
			case 'png': return 'image/png';
			case 'jpg':
			case 'jpeg': return 'image/jpeg';
			case 'gif': return 'image/gif';
			case 'webp': return 'image/webp';
			case 'bmp': return 'image/bmp';
			case 'svg': return 'image/svg+xml';
			default: return 'application/octet-stream';
		}
	}

	private fileToDataUrl(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result as string);
			reader.onerror = reject;
			reader.readAsDataURL(file);
		});
	}

	private async sendFollowUpMessage(conversation: AIConversation, message: string): Promise<void> {
		// Add user message
		const userMessage: AIMessage = {
			id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
			type: 'user',
			content: message,
			timestamp: new Date()
		};
		conversation.messages.push(userMessage);
		this.updateContent();

		// Add typing indicator
		const typingMessage = {
			id: 'typing_' + Date.now(),
			type: 'assistant' as const,
			content: '',
			timestamp: new Date(),
			isTyping: true
		};
		conversation.messages.push(typingMessage);
		this.updateContent();

		try {
			// For follow-up, we'll use the last image from the conversation
			const lastImageMessage = conversation.messages
				.slice()
				.reverse()
				.find(m => m.image);

			if (!lastImageMessage?.image) {
				throw new Error('No image found in conversation');
			}

			// Call AI API with the follow-up question
			const response = await this.callAIForFollowUp(message, lastImageMessage.image, conversation);

			// Remove typing indicator
			const typingIndex = conversation.messages.findIndex(m => m.id === typingMessage.id);
			if (typingIndex > -1) {
				conversation.messages.splice(typingIndex, 1);
			}

			// Add AI response
			const assistantMessage = this.createAssistantMessage(response);
			conversation.messages.push(assistantMessage);
			
			this.updateContent();

		} catch (error) {
			getLogger().error('Follow-up message failed:', error);
			
			// Remove typing indicator
			const typingIndex = conversation.messages.findIndex(m => m.hasOwnProperty('isTyping'));
			if (typingIndex > -1) {
				conversation.messages.splice(typingIndex, 1);
			}
			
			// Add error message
			const errorMessage = this.createAssistantMessage(`Error: ${error.message}`);
			conversation.messages.push(errorMessage);
			this.updateContent();
		}
	}

	private async callAIForFollowUp(message: string, imageDataUrl: string, conversation: AIConversation): Promise<string> {
		// Use the new context-aware API for follow-up questions
		// 智能判断逻辑会自动决定是否需要 mode prompt（比如图片相关的 mode 每次都会应用）
		return await this.aiManager.callAIWithContext(conversation, message, [imageDataUrl], undefined, true);
	}

	private async renderMarkdown(container: HTMLElement, content: string): Promise<void> {
		// First, extract and render thinking blocks
		let processedContent = this.extractAndRenderThinkingBlocks(container, content);
		
		// Convert temp: protocol images to actual data URLs for Obsidian rendering
		const tempImageRegex = /!\[(.*?)\]\(temp:([^)]+)\)/g;
		processedContent = processedContent.replace(tempImageRegex, (match, alt, tempId) => {
			const tempData = this.aiManager.getImageReferenceManager().getTempImageData(tempId);
			if (tempData) {
				// Use dataUrl from ImageReferenceManager
				return `![${alt}](${tempData.dataUrl})`;
			} else {
				// Temp image not found, show placeholder
				getLogger().warn('Temp image not found for ID:', tempId);
				return `![Image not found](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7)`;
			}
		});
		
		// LaTeX delimiter conversion - 修复转换逻辑和注释
		// \( ... \) -> $...$ (行内公式)
		processedContent = processedContent.replace(/\\\(\s*([^]*?)\s*\\\)/g, function(match, formula) {
			return '$' + formula.trim() + '$'; // 移除额外空格，避免影响渲染
		});
		
		// \[ ... \] -> $$...$$ (行间公式)  
		processedContent = processedContent.replace(/\\\[\s*([^]*?)\s*\\\]/g, function(match, formula) {
			return '$$' + formula.trim() + '$$'; // 移除额外空格，让渲染与原生$$公式一致
		});
		
		
		// Create a simple container with minimal interference
		const markdownContainer = container.createEl('div', { cls: 'markdown-rendered' });
		
		try {
			// Let Obsidian handle everything naturally
			await MarkdownRenderer.renderMarkdown(
				processedContent,
				markdownContainer,
				'', 
				this.markdownComponent
			);
			
		} catch (error) {
			getLogger().error('Failed to render markdown:', error);
			markdownContainer.createEl('div', { text: processedContent });
		}
	}

	private extractAndRenderThinkingBlocks(container: HTMLElement, content: string): string {
		// Define thinking-related tags to look for
		const thinkingTags = ['think', 'thinking', 'reasoning', 'plan', 'analysis', 'internal', 'reflection', 'decision'];
		
		let processedContent = content;
		
		// Process each thinking tag type
		for (const tag of thinkingTags) {
			// Match both triangle-style and <tagname> patterns
			const patterns = [
				new RegExp(`<${tag}([^>]*)>([\\s\\S]*?)</${tag}>`, 'gi')
			];
			
			for (const pattern of patterns) {
				let match;
				while ((match = pattern.exec(processedContent)) !== null) {
					const thinkingContent = match[1] || match[2]; // Get content from either capture group
					
					// Create thinking block container
					const thinkingBlock = container.createEl('div', { cls: 'ai-thinking-block' });
					
					// Create header with toggle
					const header = thinkingBlock.createEl('div', { cls: 'ai-thinking-header' });
					const toggleIcon = header.createEl('span', { cls: 'ai-thinking-toggle' });
					// Using Lucide Brain icon

					setIcon(toggleIcon, 'lightbulb');

					const label = header.createEl('span', { 
						cls: 'ai-thinking-label',
						text: this.getThinkingLabel(tag)
					});
					
					// Create collapsible content
					const contentEl = thinkingBlock.createEl('div', { cls: 'ai-thinking-content' });
					
					// Render thinking content with basic markdown
					this.renderThinkingContent(contentEl, thinkingContent.trim());
					
					// Add toggle functionality
					let isCollapsed = false;
					header.addEventListener('click', () => {
						isCollapsed = !isCollapsed;
						contentEl.style.display = isCollapsed ? 'none' : 'block';
						// Toggle between Brain and ChevronDown icons
						if (isCollapsed) {
							setIcon(toggleIcon, 'chevron-up');
						} else {
							setIcon(toggleIcon, 'lightbulb');
						}
						thinkingBlock.classList.toggle('collapsed', isCollapsed);
					});
					
					// Remove the thinking block from the main content
					processedContent = processedContent.replace(match[0], '');
					
					// Reset regex lastIndex to avoid infinite loops
					pattern.lastIndex = 0;
				}
			}
		}
		
		return processedContent;
	}

	private getThinkingLabel(tag: string): string {
		const labels: { [key: string]: string } = {
			'think': 'Thinking',
			'thinking': 'Thinking Process',
			'reasoning': 'Reasoning',
			'plan': 'Planning',
			'analysis': 'Analysis',
			'internal': 'Internal Process',
			'reflection': 'Reflection',
			'decision': 'Decision Making'
		};
		return labels[tag.toLowerCase()] || 'Thought Process';
	}

	private renderThinkingContent(container: HTMLElement, content: string): void {
		// Simple text rendering for thinking content
		const lines = content.split('\n');
		
		for (const line of lines) {
			if (line.trim() === '') {
				container.createEl('br');
			} else {
				const p = container.createEl('p', { cls: 'ai-thinking-text' });
				// Handle basic formatting using DOM methods for security
				const strongRegex = /\*\*(.*?)\*\*/g;
				const emRegex = /\*(.*?)\*/g;
				const codeRegex = /`(.*?)`/g;
				
				let processedText = line;
				
				if (strongRegex.test(processedText) || emRegex.test(processedText) || codeRegex.test(processedText)) {
					processedText = processedText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
					processedText = processedText.replace(/\*(.*?)\*/g, '<em>$1</em>');
					processedText = processedText.replace(/`(.*?)`/g, '<code>$1</code>');
					p.textContent = processedText;
				} else {
					p.textContent = processedText;
				}
			}
		}
	}

	private formatTime(date: Date): string {
		const today = new Date();
		const yesterday = new Date(today);
		yesterday.setDate(yesterday.getDate() - 1);
		
		// Check if the date is today
		if (date.toDateString() === today.toDateString()) {
			return '今天 ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		}
		// Check if the date is yesterday
		else if (date.toDateString() === yesterday.toDateString()) {
			return '昨天 ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		}
		// For other dates, show full date and time
		else {
			return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		}
	}

	private showImageModal(imageSrc: string): void {
		// Create a simple modal to show the full image
		const modal = document.createElement('div');
		modal.className = 'ai-chat-image-modal';
		// Note: Basic modal positioning handled by CSS classes

		const img = document.createElement('img');
		img.src = imageSrc;
		img.className = 'ai-chat-show-image';
		// Note: Image sizing handled by CSS classes

		modal.appendChild(img);
		modal.addEventListener('click', () => {
			document.body.removeChild(modal);
		});

		document.body.appendChild(modal);
	}

	async onClose(): Promise<void> {
		// Final auto-save before closing
		await this.performFinalAutoSave();
		
		// Clear auto-save timer and reset content tracking
		this.clearAutoSaveTimer();
		this.lastAutoSaveContent = null;
		
		// Clean up document event listeners
		this.cleanupEventListeners();
		
		// Cleanup drag and drop listeners
		const dropZone = this.containerEl.querySelector('.ai-chat-drop-zone') as HTMLElement;
		if (dropZone) {
			const dropZoneEvents = this.eventHandlers.get(dropZone);
			if (dropZoneEvents && dropZoneEvents.dragCleanup) {
				dropZoneEvents.dragCleanup();
			}
		}
	}

	private cleanupEventListeners(): void {
		const container = this.containerEl.children[1] as HTMLElement;
		if (container) {
			const containerEvents = this.eventHandlers.get(container);
			if (containerEvents && containerEvents.prevClickOutsideHandler) {
				document.removeEventListener('click', containerEvents.prevClickOutsideHandler);
				containerEvents.prevClickOutsideHandler = null;
				this.eventHandlers.set(container, containerEvents);
			}
		}
	}

	private startAutoSaveTimer(): void {
		// Clear existing timer
		this.clearAutoSaveTimer();
		
		// Only start timer if auto-save is enabled and there's an active conversation
		if (!this.plugin.settings.autoSaveConversations) {
			return;
		}
		
		const conversation = this.aiManager.getCurrentConversationData();
		if (!conversation || conversation.messages.length === 0) {
			return;
		}
		
		// Set up periodic auto-save
		this.autoSaveTimer = setInterval(() => {
			this.performPeriodicAutoSave();
		}, this.autoSaveInterval);
		
		getLogger().log('Auto-save timer started for conversation:', conversation.id);
	}
	
	private clearAutoSaveTimer(): void {
		if (this.autoSaveTimer) {
			clearInterval(this.autoSaveTimer);
			this.autoSaveTimer = null;
		}
	}
	
	private async performPeriodicAutoSave(): Promise<void> {
		try {
			const conversation = this.aiManager.getCurrentConversationData();
			if (!conversation || conversation.messages.length === 0) {
				this.clearAutoSaveTimer();
				return;
			}
			
			// Check if conversation has changed since last save
			if (conversation.id !== this.currentConversationId) {
				// New conversation - perform final save for old one and start fresh
				await this.performFinalAutoSave();
				this.currentConversationId = conversation.id;
				this.lastAutoSaveTime = 0;
			}
			
			// Check if enough time has passed since last save
			const now = Date.now();
			if (now - this.lastAutoSaveTime < this.autoSaveInterval) {
				return;
			}
			
			// Perform auto-save with timestamp-based filename to avoid duplicates
			await this.autoSaveConversationWithTimestamp();
			this.lastAutoSaveTime = now;
			
		} catch (error) {
			getLogger().error('Periodic auto-save failed:', error);
		}
	}
	
	private async performFinalAutoSave(): Promise<void> {
		try {
			const conversation = this.aiManager.getCurrentConversationData();
			if (!conversation || conversation.messages.length === 0) {
				return;
			}
			
			// Perform final auto-save
			await this.autoSaveConversationWithTimestamp();
			getLogger().log('Final auto-save completed for conversation:', conversation.id);
			
		} catch (error) {
			getLogger().error('Final auto-save failed:', error);
		}
	}
	
	/**
	 * Generate timestamp-based filename for auto-save
	 * Format: YYYY-MM-DD_HH-mm-ss_auto-saved-{shortId}.md
	 * This ensures files sort naturally by creation time
	 */
	private generateTimestampedFileName(conversationId: string): string {
		const now = new Date();
		const year = now.getFullYear();
		const month = String(now.getMonth() + 1).padStart(2, '0');
		const day = String(now.getDate()).padStart(2, '0');
		const hours = String(now.getHours()).padStart(2, '0');
		const minutes = String(now.getMinutes()).padStart(2, '0');
		const seconds = String(now.getSeconds()).padStart(2, '0');
		
		const conversationIdShort = conversationId.slice(-8);
		const fileName = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}_auto-saved-${conversationIdShort}.md`;
		
		// Ensure filename is safe across all operating systems
		return this.sanitizeTimestampFileName(fileName);
	}

	/**
	 * Sanitize timestamp-based filename to ensure cross-platform compatibility
	 */
	private sanitizeTimestampFileName(fileName: string): string {
		// Replace any potentially problematic characters with safe alternatives
		// Our timestamp format should already be safe, but this is a safety net
		return fileName
			.replace(/[<>:"/\\|?*]/g, '-') // Replace Windows forbidden characters
			.replace(/[\x00-\x1F\x80-\x9F]/g, '') // Remove control characters
			.replace(/^\.+/, '') // Remove leading dots
			.replace(/\.+$/, '.md') // Ensure it ends with .md
			.substring(0, 255); // Limit length for file systems
	}

	private async autoSaveConversationWithTimestamp(): Promise<void> {
		if (!this.plugin.settings.autoSaveConversations) {
			return;
		}

		try {
			const conversation = this.aiManager.getCurrentConversationData();
			if (!conversation || conversation.messages.length === 0) {
				getLogger().log('Auto-save skipped: No conversation or empty conversation');
				return;
			}

			// Update conversation title based on content before saving
			this.aiManager.updateConversationTitle(conversation.id);

			// Generate filename based on conversation title (like manual save)
			const conversationIdShort = conversation.id.slice(-8); // Last 8 chars of conversation ID  
			const sanitizedTitle = this.sanitizeFileName(conversation.title || 'Untitled Conversation');
			const fileName = `${sanitizedTitle}.md`;
			getLogger().log('Auto-save using title-based filename:', fileName);

			// Generate markdown content first to check for changes (auto-save mode, without timestamp update for comparison)
			const markdownContent = await this.generateConversationMarkdown(conversation, 'auto', false);
			
			// Check if content has changed since last save
			if (this.lastAutoSaveContent && this.lastAutoSaveContent === markdownContent) {
				getLogger().log('Auto-save skipped: No content changes detected for conversation', conversationIdShort);
				return;
			}

			getLogger().log('Auto-save proceeding: Content changes detected for conversation', conversationIdShort, 
				'(previous content length:', this.lastAutoSaveContent?.length || 0, 
				', new content length:', markdownContent.length, ')');

			// Generate final content with updated timestamp for actual saving
			const finalMarkdownContent = await this.generateConversationMarkdown(conversation, 'auto', true);

			// Get auto-save location from settings
			const autoSaveLocation = this.plugin.settings.autoSavedConversationLocation || 'screenshots-capture/autosavedconversations';

			// Ensure the directory exists
			const vault = this.plugin.app.vault;
			const adapter = vault.adapter;

			if (!await adapter.exists(autoSaveLocation)) {
				await vault.createFolder(autoSaveLocation);
			}

			// Construct full path
			const fullPath = `${autoSaveLocation}/${fileName}`;

			// Use modify instead of delete+create to avoid closing open files
			const existingFile = vault.getAbstractFileByPath(fullPath);
			if (existingFile && existingFile instanceof TFile) {
				// File exists, modify it to avoid closing it if it's open
				await vault.modify(existingFile, finalMarkdownContent);
			} else {
				// File doesn't exist, create it
				await vault.create(fullPath, finalMarkdownContent);
			}

			// Update the last saved content after successful save (use content without timestamp for comparison)
			this.lastAutoSaveContent = markdownContent;

			// Clean up old auto-saved conversations to enforce limit
			await this.cleanupOldAutoSavedConversations();

			getLogger().log('Auto-saved conversation to:', fullPath);

		} catch (error: any) {
			getLogger().error('Failed to auto-save conversation with timestamp:', error);
		}
	}

	private async saveConversation(): Promise<void> {
		try {
			const conversation = this.aiManager.getCurrentConversationData();
			if (!conversation || conversation.messages.length === 0) {
				new Notice(t('notice.noConversationToSave'));
				return;
			}

			// Update conversation title based on content before saving
			this.aiManager.updateConversationTitle(conversation.id);

			// Generate or use existing conversation ID
			const conversationId = conversation.id.startsWith('loaded_') ? 
				this.generateConversationId(conversation) : conversation.id;

			// Convert temp images to vault files and get processed conversation
			const processedConversation = await this.convertTempImagesToVaultFiles(conversation);
			
			// Generate markdown content for manual save
			const markdownContent = await this.generateConversationMarkdown(processedConversation, 'manual');

			// Get save location from settings
			const saveLocation = this.plugin.settings.conversationSaveLocation || 'screenshots-capture/conversations';

			// Search for existing file with this conversationID
			const existingFile = await this.findFileByConversationId(conversationId, saveLocation);
			
			if (existingFile) {
				// Update existing file
				await this.plugin.app.vault.modify(existingFile, markdownContent);
				new Notice(`✅ 会话已更新: ${existingFile.basename}`);
				getLogger().log('Conversation updated at:', existingFile.path);
			} else {
				// Create new file
				// Ensure the directory exists
				const vault = this.plugin.app.vault;
				const adapter = vault.adapter;

				if (saveLocation && !await adapter.exists(saveLocation)) {
					await vault.createFolder(saveLocation);
				}

				// Create filename based on sanitized conversation title
				const sanitizedTitle = this.sanitizeFileName(conversation.title || 'Untitled Conversation');
				const fileName = `${sanitizedTitle}.md`;
				const fullPath = saveLocation ? `${saveLocation}/${fileName}` : fileName;

				await vault.create(fullPath, markdownContent);
				new Notice(`✅ 会话已保存为 ${fileName}`);
				getLogger().log('Conversation saved to:', fullPath);
			}
			
			// 重要：更新内存中的对话数据，将临时图片引用替换为本地文件引用
			this.aiManager.updateConversationInMemory(conversationId, processedConversation);
			
			// 刷新显示以反映更新后的引用
			await this.updateContent();

		} catch (error: any) {
			getLogger().error('Failed to save conversation:', error);
			new Notice(`❌ Failed to save conversation: ${error.message}`);
		}
	}

	private async findFileByConversationId(conversationId: string, searchLocation: string): Promise<TFile | null> {
		try {
			const vault = this.plugin.app.vault;
			
			// Get all markdown files in the specified location
			const allFiles = vault.getMarkdownFiles();
			const filesInLocation = allFiles.filter(file => file.path.startsWith(searchLocation));
			
			const matchingFiles: TFile[] = [];
			
			// Search for files with matching conversationID
			for (const file of filesInLocation) {
				const content = await vault.read(file);
				const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
				if (yamlMatch) {
					const yamlContent = yamlMatch[1];
					const idMatch = yamlContent.match(/conversationID:\s*(.+)/);
					if (idMatch && idMatch[1].trim() === conversationId) {
						matchingFiles.push(file);
					}
				}
			}
			
			// Handle multiple matches
			if (matchingFiles.length > 1) {
				new Notice(`⚠️ 找到${matchingFiles.length}个相同ID的文件，使用最新的一个`);
				// Return the most recently modified one
				return matchingFiles.sort((a, b) => b.stat.mtime - a.stat.mtime)[0];
			}
			
			return matchingFiles.length > 0 ? matchingFiles[0] : null;
			
		} catch (error: any) {
			getLogger().error('Failed to search for existing conversation file:', error);
			return null;
		}
	}

	/**
	 * Sanitize conversation title for use as filename (used in manual save)
	 * Replaces invalid filename characters with underscores
	 */
	private sanitizeFileName(title: string): string {
		// Replace invalid filename characters with underscores
		// Common invalid characters: \ / : * ? " < > |
		let sanitized = title
			.replace(/[\\/:*?"<>|]/g, '_')  // Replace invalid characters with underscores
			.replace(/\s+/g, '_')          // Replace spaces with underscores
			.replace(/_{2,}/g, '_')        // Replace multiple consecutive underscores with single
			.replace(/^_+|_+$/g, '');      // Remove leading/trailing underscores
		
		// Ensure the filename is not empty and not too long
		if (!sanitized || sanitized.length === 0) {
			sanitized = 'untitled_conversation';
		}
		
		// Limit filename length (keeping some buffer for .md extension)
		const maxLength = 200;
		if (sanitized.length > maxLength) {
			sanitized = sanitized.substring(0, maxLength);
		}
		
		// Remove trailing periods and spaces (Windows compatibility)
		sanitized = sanitized.replace(/[.\s]+$/, '');
		
		return sanitized;
	}

	private async cleanupOldAutoSavedConversations(): Promise<void> {
		try {
			const vault = this.plugin.app.vault;
			const autoSaveLocation = this.plugin.settings.autoSavedConversationLocation || 'screenshots-capture/autosavedconversations';
			const maxConversations = this.plugin.settings.maxAutoSavedConversations || 5;

			// Get all auto-saved conversation files (now based on location only)
			const autoSaveFolder = vault.getAbstractFileByPath(autoSaveLocation);
			if (!autoSaveFolder) return;

			const files = vault.getMarkdownFiles().filter(file => 
				file.path.startsWith(autoSaveLocation)
			);

			// Sort by modification time in descending order (newest first)
			files.sort((a, b) => b.stat.mtime - a.stat.mtime);

			// Delete excess files
			if (files.length > maxConversations) {
				const filesToDelete = files.slice(maxConversations);
				for (const file of filesToDelete) {
					await this.plugin.app.fileManager.trashFile(file);
					getLogger().log('Moved old auto-saved conversation to trash:', file.path);
				}
			}
		} catch (error: any) {
			getLogger().error('Failed to cleanup old auto-saved conversations:', error);
		}
	}

	private generateConversationId(conversation: AIConversation): string {
		// Use creation time timestamp
		const firstMessage = conversation.messages[0];
		const creationTime = firstMessage ? firstMessage.timestamp : new Date();
		const timestamp = Math.floor(creationTime.getTime() / 1000);
		
		// Create content hash from first few messages
		let contentForHash = '';
		const messagesToHash = conversation.messages.slice(0, 3); // First 3 messages
		messagesToHash.forEach(msg => {
			contentForHash += msg.type + ':' + (msg.content || '').substring(0, 100);
		});
		
		// Simple hash function
		let hash = 0;
		for (let i = 0; i < contentForHash.length; i++) {
			const char = contentForHash.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash; // Convert to 32-bit integer
		}
		
		// Combine timestamp with hash (make hash positive and short)
		const shortHash = Math.abs(hash).toString(36).substring(0, 6);
		return `${timestamp}_${shortHash}`;
	}

	/**
	 * Check if conversation has temporary images
	 */
	private hasTempImages(conversation: AIConversation): boolean {
		return conversation.messages.some(message => 
			message.content && message.content.includes('temp:')
		);
	}
	
	/**
	 * Convert temporary images to data URLs for auto-save mode
	 */
	private async convertTempImagesToDataUrls(conversation: AIConversation): Promise<AIConversation> {
		const processedMessages: AIMessage[] = [];
		
		for (const message of conversation.messages) {
			const processedMessage: AIMessage = { ...message };
			
			// Parse message content to find temp: references
			const tempImageRegex = /!\[(.*?)\]\(temp:([^)]+)\)/g;
			let updatedContent = message.content;
			let match;
			
			while ((match = tempImageRegex.exec(message.content)) !== null) {
				const [fullMatch, alt, tempId] = match;
				
				try {
					// Get temporary image data from ImageReferenceManager
					const tempImageData = this.aiManager.getImageReferenceManager().getTempImageData(tempId);
					if (!tempImageData) {
						getLogger().warn(`Temp image not found for ID: ${tempId}`);
						continue;
					}
					
					// Replace temp: reference with data URL, using real source for alt text
					const markdownImage = `![${tempImageData.source}](${tempImageData.dataUrl})`;
					updatedContent = updatedContent.replace(fullMatch, markdownImage);
					
				} catch (error) {
					getLogger().error(`Failed to convert temporary image ${tempId}:`, error);
					// Keep the original reference if conversion fails
				}
			}
			
			processedMessage.content = updatedContent;
			processedMessages.push(processedMessage);
		}
		
		return {
			...conversation,
			messages: processedMessages
		};
	}
	
	/**
	 * Convert temporary images to vault files for manual save mode
	 */
	private async convertTempImagesToVaultFiles(conversation: AIConversation): Promise<AIConversation> {
		const processedMessages: AIMessage[] = [];
		const conversationSaveLocation = this.plugin.settings.conversationSaveLocation || 'screenshots-capture/conversations';
		const otherSourceLocation = this.plugin.settings.otherSourceImageLocation || 'screenshots-capture/othersourceimage';
		const screenshotSaveLocation = this.plugin.settings.defaultSaveLocation || 'screenshots-capture/savedscreenshots';
		
		// Ensure all folders exist
		const vault = this.plugin.app.vault;
		const conversationImageFolder = `${conversationSaveLocation}/images`;
		
		try {
			if (!await vault.adapter.exists(conversationImageFolder)) {
				await vault.createFolder(conversationImageFolder);
			}
			if (!await vault.adapter.exists(otherSourceLocation)) {
				await vault.createFolder(otherSourceLocation);
			}
			if (!await vault.adapter.exists(screenshotSaveLocation)) {
				await vault.createFolder(screenshotSaveLocation);
			}
		} catch (error) {
			getLogger().error('Failed to create required folders:', error);
			throw new Error(`Failed to create required folders: ${error.message}`);
		}
		
		for (const message of conversation.messages) {
			const processedMessage: AIMessage = { ...message };
			
			// Parse message content to find temp: references
			const tempImageRegex = /!\[(.*?)\]\(temp:([^)]+)\)/g;
			let updatedContent = message.content;
			let match;
			
			while ((match = tempImageRegex.exec(message.content)) !== null) {
				const [fullMatch, alt, tempId] = match;
				
				try {
					// Get temporary image data from ImageReferenceManager
					const tempImageData = this.aiManager.getImageReferenceManager().getTempImageData(tempId);
					if (!tempImageData) {
						getLogger().warn(`Temp image not found for ID: ${tempId}`);
						continue;
					}
					
					// Choose target folder based on source
					let targetFolder: string;
					if (tempImageData.source === 'external') {
						targetFolder = otherSourceLocation;
					} else if (tempImageData.source === 'screenshot') {
						targetFolder = screenshotSaveLocation;
					} else {
						// For other sources, use conversation images folder
						targetFolder = conversationImageFolder;
					}
					
					// Save image to vault
					const savedImagePath = await this.saveTempImageToVault(tempId, tempImageData.dataUrl, targetFolder);
					
					// Replace temp: reference with vault file path, using real source for alt text
					const markdownImage = `![${tempImageData.source}](${savedImagePath})`;
					updatedContent = updatedContent.replace(fullMatch, markdownImage);
					
				} catch (error) {
					getLogger().error(`Failed to save temporary image ${tempId}:`, error);
					// Keep the original reference if saving fails
				}
			}
			
			processedMessage.content = updatedContent;
			processedMessages.push(processedMessage);
		}
		
		return {
			...conversation,
			messages: processedMessages
		};
	}
	
	/**
	 * Save a temporary image to vault and return the path
	 */
	private async saveTempImageToVault(tempId: string, dataUrl: string, targetFolder: string): Promise<string> {
		// Get original fileName from ImageReferenceManager
		const tempImageData = this.aiManager.getImageReferenceManager().getTempImageData(tempId);
		const originalFileName = tempImageData?.fileName || 'image';
		
		// Extract image data
		const base64Data = dataUrl.split(',')[1];
		const mimeType = dataUrl.match(/data:(.*?);base64,/)?.[1] || 'image/png';
		const extension = mimeType.split('/')[1] || 'png';
		
		// Generate filename using original fileName
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		
		// Remove extension from original fileName if it exists, then add the correct extension
		const baseFileName = originalFileName.replace(/\.[^/.]+$/, '');
		// Sanitize filename for filesystem compatibility
		const sanitizedBaseName = baseFileName.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_');
		
		const fileName = `${sanitizedBaseName}_${timestamp}.${extension}`;
		const fullPath = `${targetFolder}/${fileName}`;
		
		// Convert base64 to binary
		const binaryString = atob(base64Data);
		const bytes = new Uint8Array(binaryString.length);
		for (let i = 0; i < binaryString.length; i++) {
			bytes[i] = binaryString.charCodeAt(i);
		}
		
		// Save to vault
		await this.plugin.app.vault.createBinary(fullPath, bytes.buffer);
		
		return fullPath;
	}

	/**
	 * Format timestamp in local time to avoid timezone issues when saving/loading
	 */
	private formatTimestampForSaving(timestamp: Date): string {
		const year = timestamp.getFullYear();
		const month = String(timestamp.getMonth() + 1).padStart(2, '0');
		const day = String(timestamp.getDate()).padStart(2, '0');
		const hours = String(timestamp.getHours()).padStart(2, '0');
		const minutes = String(timestamp.getMinutes()).padStart(2, '0');
		const seconds = String(timestamp.getSeconds()).padStart(2, '0');
		return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
	}

	/**
	 * Get image source label from image data
	 */
	private getImageSourceLabel(imageData: any): string {
		// Use source attribute directly - no path inference needed
		if (imageData && imageData.source) {
			return imageData.source;
		}
		
		// Default fallback for legacy data without source attribute
		return 'image';
	}

	/**
	 * Generate conversation markdown with different modes for temp images
	 * @param conversation - The conversation to convert
	 * @param mode - 'auto' for auto-save (keep temp images in YAML), 'manual' for manual save (convert temp images)
	 */
	private async generateConversationMarkdown(conversation: AIConversation, mode: 'auto' | 'manual' = 'auto', updateTimestamp: boolean = true): Promise<string> {
		// Generate or use existing conversation ID
		const conversationId = conversation.id.startsWith('loaded_') ? 
			this.generateConversationId(conversation) : conversation.id;
		
		// Process conversation based on mode
		let processedConversation = conversation;
		if (mode === 'manual') {
			// Convert temporary images to vault files for manual save
			processedConversation = await this.convertTempImagesToVaultFiles(conversation);
		} else if (mode === 'auto') {
			// Convert temporary images to data URLs for auto save
			processedConversation = await this.convertTempImagesToDataUrls(conversation);
		}
			
		// Format title similar to BestNote style
		let markdown = ``;
		
		// Properties section (similar to BestNote)
		const currentTime = new Date().toISOString();
		const createdTime = conversation.createdAt ? conversation.createdAt.toISOString() : currentTime;
		
		// For auto-save mode, use a fixed timestamp for comparison unless explicitly updating
		let lastModifiedTime = currentTime;
		if (mode === 'auto' && !updateTimestamp) {
			// Use a fixed timestamp to prevent unnecessary saves due to timestamp changes
			lastModifiedTime = createdTime;
		}
		
		markdown += `---
conversationID: ${conversationId}
model: ${this.plugin.settings.defaultModelConfigId || 'default'}
created: ${createdTime}
lastModified: ${lastModifiedTime}
tags:
  - ai-conversation`;
		
		// Note: Temporary images are now converted to data URLs in content, not stored in YAML
		
		markdown += `\n---`;
		markdown += `\n`
		// Generate messages in BestNote style
		processedConversation.messages.forEach((message, index) => {
			const messageType = message.type === 'user' ? 'user' : 'ai';
			
			// Message header with BestNote format including timestamp
			markdown += `${messageType}: <!-- ${message.timestamp.toISOString()} -->\n`;
			
			// Add text content first if present
			if (message.content) {
				markdown += message.content + '\n';
			}

			// Add image content if present - inline with content
			if (message.image) {
				const allImages = (message as ExtendedMessage).images;
				if (allImages && allImages.length > 1) {
					// Multiple images
					allImages.forEach((imageData: any, imgIndex: number) => {
						// Prioritize local path over dataUrl
						let imagePath = imageData.dataUrl; // fallback
						if (imageData.localPath) {
							const formattedPath = this.formatImagePath(imageData.localPath);
							if (formattedPath) {
								imagePath = formattedPath;
							}
						}
						
						const fileName = imageData.fileName || `image-${imgIndex + 1}`;
						const sourceLabel = this.getImageSourceLabel(imageData);
						markdown += `![${sourceLabel}](${imagePath})\n`;
					});
				} else {
					// Single image - check for local path in multiple places
					const singleImageData = (message as ExtendedMessage).imageData;
					const firstImageFromArray = allImages && allImages.length > 0 ? allImages[0] : null;
					
					let imagePath = message.image; // fallback to base64
					
					// Priority 1: Check images array first
					if (firstImageFromArray && firstImageFromArray.localPath) {
						const formattedPath = this.formatImagePath(firstImageFromArray.localPath);
						if (formattedPath) {
							imagePath = formattedPath;
						}
					}
					// Priority 2: Check imageData property
					else if (singleImageData && (message as ExtendedMessage).localPath) {
						const formattedPath = this.formatImagePath((message as ExtendedMessage).localPath!);
						if (formattedPath) {
							imagePath = formattedPath;
						}
					}
					// Priority 3: Check if the message itself has localPath metadata
					else if ((message as ExtendedMessage).localPath) {
						const formattedPath = this.formatImagePath((message as ExtendedMessage).localPath!);
						if (formattedPath) {
							imagePath = formattedPath;
						}
					}
					
					const sourceLabel = this.getImageSourceLabel(singleImageData || firstImageFromArray);
					markdown += `![${sourceLabel}](${imagePath})\n`;
				}
			}
			
			// Add spacing between messages
			markdown += `\n`;
		});
		
		return markdown;
	}

	private async showHistoryModal(): Promise<void> {
		try {
			const modal = new ChatHistoryModal(this.plugin, async (conversation: AIConversation) => {
				await this.loadConversationIntoChat(conversation);
			});
			modal.open();
		} catch (error: any) {
			getLogger().error('Failed to show history modal:', error);
			new Notice(`❌ Failed to open history: ${error.message}`);
		}
	}

	private async loadImageDataFromPath(localPath: string): Promise<string | null> {
		try {
			const vault = this.plugin.app.vault;
			const file = vault.getAbstractFileByPath(localPath);
			
			if (!file || !(file instanceof TFile)) {
				getLogger().warn(`Image file not found: ${localPath}`);
				return null;
			}
			
			const buffer = await vault.readBinary(file);
			const extension = localPath.split('.').pop() || 'png';
			const mimeType = this.getMimeType(extension);
			
			// Convert binary data to base64 in chunks to avoid stack overflow
			const uint8Array = new Uint8Array(buffer);
			let binary = '';
			const chunkSize = 0x8000; // 32KB chunks
			
			for (let i = 0; i < uint8Array.length; i += chunkSize) {
				const chunk = uint8Array.subarray(i, i + chunkSize);
				binary += String.fromCharCode.apply(null, Array.from(chunk));
			}
			
			const base64 = btoa(binary);
			return `data:${mimeType};base64,${base64}`;
			
		} catch (error) {
			getLogger().error(`Failed to load image data from path ${localPath}:`, error);
			return null;
		}
	}

	private async restoreImageDataForMessage(message: any): Promise<void> {
		// Process images array if present
		if (message.images && Array.isArray(message.images)) {
			for (const imageData of message.images) {
				if (imageData.localPath && !imageData.dataUrl) {
					const dataUrl = await this.loadImageDataFromPath(imageData.localPath);
					if (dataUrl) {
						imageData.dataUrl = dataUrl;
						getLogger().log(`✅ Restored dataUrl for image: ${imageData.localPath}`);
					} else {
						getLogger().warn(`⚠️ Could not restore dataUrl for image: ${imageData.localPath}`);
					}
				}
			}
		}
		
		// Process single image data if present
		if (message.imageData && message.imageData.localPath && !message.imageData.dataUrl) {
			const dataUrl = await this.loadImageDataFromPath(message.imageData.localPath);
			if (dataUrl) {
				message.imageData.dataUrl = dataUrl;
				getLogger().log(`✅ Restored dataUrl for single image: ${message.imageData.localPath}`);
			} else {
				getLogger().warn(`⚠️ Could not restore dataUrl for single image: ${message.imageData.localPath}`);
			}
		}
		
		// If message.image is a local path, try to restore it
		if (message.image && !message.image.startsWith('data:') && !message.image.startsWith('http')) {
			const dataUrl = await this.loadImageDataFromPath(message.image);
			if (dataUrl) {
				// Create imageData structure to maintain both localPath and dataUrl
				if (!message.imageData) {
					message.imageData = {
						localPath: message.image,
						dataUrl: dataUrl,
						fileName: message.image.split('/').pop() || 'image'
					};
				}
				// Keep message.image as dataUrl for display compatibility
				const originalPath = message.image;
				message.image = dataUrl;
				getLogger().log(`✅ Restored dataUrl for message image: ${originalPath}`);
			} else {
				getLogger().warn(`⚠️ Could not restore dataUrl for message image: ${message.image}`);
			}
		}
	}

	private async loadConversationIntoChat(conversation: AIConversation): Promise<void> {
		try {
			// Create a new conversation in the AI manager based on the loaded one
			const newConversation = this.aiManager.createNewConversation(conversation.title);
			
			// Preserve the original creation time
			if (conversation.createdAt) {
				newConversation.createdAt = conversation.createdAt;
			}
			
			// Preserve the lastModeUsed field for compatibility with smart mode logic
			if (conversation.lastModeUsed !== undefined) {
				newConversation.lastModeUsed = conversation.lastModeUsed;
			}
			
			// Copy all messages from the loaded conversation and process images
			for (const message of conversation.messages) {
				// Check if this message has data URLs that should be converted to local files
				// This happens when loading manually saved conversations
				const { content } = await this.processMessageImagesOnLoad(message.content || '');
				
				const newMessage: AIMessage = {
					id: 'loaded_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
					type: message.type,
					content: content,
					timestamp: message.timestamp // Preserve original timestamp
					// 移除 tempImages 字段，现在由 ImageReferenceManager 统一管理
				};
				
				// Preserve image data if it exists (for backward compatibility)
				if ((message as ExtendedMessage).image) {
					(newMessage as ExtendedMessage).image = (message as ExtendedMessage).image;
				}
				if ((message as ExtendedMessage).imageData) {
					(newMessage as ExtendedMessage).imageData = (message as ExtendedMessage).imageData;
				}
				if ((message as ExtendedMessage).images) {
					(newMessage as ExtendedMessage).images = (message as ExtendedMessage).images;
				}
				
				newConversation.messages.push(newMessage);
			}

			// Update the chat view to show the loaded conversation
			await this.updateContent();
			
			// Reset last saved content for loaded conversation to allow initial auto-save
			this.lastAutoSaveContent = null;
			
			new Notice(`✅ Loaded conversation: ${conversation.title}`);
		} catch (error: any) {
			getLogger().error('Failed to load conversation:', error);
			new Notice(`❌ Failed to load conversation: ${error.message}`);
		}
	}
	
	/**
	 * Process images when loading conversation - smart handling for different image types
	 */
	private async processMessageImagesOnLoad(content: string): Promise<{ content: string }> {
		const dataUrlRegex = /!\[([^\]]*)\]\((data:image\/[^;]+;base64,[^)]+)\)/g;
		let updatedContent = content;
		let match;
		
		// Process data URLs (from auto-saved conversations)
		// Convert them to temporary image references so they can be displayed without saving to vault
		while ((match = dataUrlRegex.exec(content)) !== null) {
			const fullMatch = match[0];  // Complete ![xxx](data:...)
			const altText = match[1];    // Alt text
			const dataUrl = match[2];    // data:image/...;base64,xxx
			
			try {
				// Convert data URL to temporary image using ImageReferenceManager
				// This allows display without creating vault files
				const tempId = this.aiManager.getImageReferenceManager().addTempImage(
					dataUrl, 
					altText || 'image', 
					`restored-${Date.now()}.png`
				);
				const placeholder = `![${altText}](temp:${tempId})`;
				updatedContent = updatedContent.replace(fullMatch, placeholder);
				
			} catch (error) {
				getLogger().error('Failed to convert data URL to temporary image:', error);
				// Keep original data URL if conversion fails
			}
		}
		
		// Vault images (from manual save conversations) - keep as is
		// They are already saved locally and don't need processing
		
		return { content: updatedContent };
	}
	
	/**
	 * Save data URL to vault and return the local path
	 */
	private async saveDataUrlToVault(dataUrl: string, altText: string): Promise<string> {
		// Extract image type from data URL
		const mimeMatch = dataUrl.match(/data:image\/([^;]+)/);
		const imageType = mimeMatch ? mimeMatch[1] : 'png';
		
		// Generate filename
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const filename = `${altText.replace(/[^a-zA-Z0-9]/g, '_')}_${timestamp}.${imageType}`;
		
		// Convert data URL to binary
		const base64Data = dataUrl.replace(/^data:image\/[^;]+;base64,/, "");
		const binaryData = atob(base64Data);
		const bytes = new Uint8Array(binaryData.length);
		for (let i = 0; i < binaryData.length; i++) {
			bytes[i] = binaryData.charCodeAt(i);
		}
		
		// Save to vault
		const saveLocation = this.plugin.settings.conversationSaveLocation || 'screenshots-capture/conversations';
		const imageFolder = `${saveLocation}/images`;
		
		// Ensure image folder exists
		const vault = this.plugin.app.vault;
		if (!await vault.adapter.exists(imageFolder)) {
			await vault.createFolder(imageFolder);
		}
		
		const imagePath = `${imageFolder}/${filename}`;
		await vault.adapter.writeBinary(imagePath, bytes.buffer);
		
		return imagePath;
	}
	

	private updateSelectorButtonContent(button: HTMLButtonElement, modelConfig: any) {
		// Clear existing content (except dropdown arrow)
		const dropdownArrow = button.querySelector('.model-dropdown-arrow');
		button.empty();
		// Clear button content
		
		// Add model name
		const modelName = button.createEl('span', { text: modelConfig.name, cls: 'model-name' });
		
		// Add vision icon if applicable (smaller size for selector button)
		if (modelConfig.isVisionCapable) {
			const visionIcon = button.createEl('span', { cls: 'vision-icon' });
			setIcon(visionIcon, 'eye');
		}
		
		// Re-add dropdown arrow
		if (dropdownArrow) {
			button.appendChild(dropdownArrow);
		}
	}

	private refreshModelDependentComponents() {
		// Update send button state based on model configuration
		const instanceMethods = this.instanceMethods.get(this);
		if (instanceMethods && instanceMethods.updateSendButtonState) {
			instanceMethods.updateSendButtonState();
		}

		// Update current view's model selector
		const container = this.containerEl.children[1] as HTMLElement;
		const modelSelectorContainer = container.querySelector('.model-selector-container');
		if (modelSelectorContainer) {
			this.updateModelSelectorInPlace(modelSelectorContainer as HTMLElement);
		}

		// Refresh settings tab by finding the settings tab instance and calling display()
		const app = this.plugin.app as AppWithSettings;
		if (app.setting && app.setting.pluginTabs) {
			const pluginTab = app.setting.pluginTabs.find((tab: any) => 
				tab.id === this.plugin.manifest.id
			);
			if (pluginTab && typeof pluginTab.display === 'function') {
				// Refresh the settings tab if it's currently active
				pluginTab.display();
			}
		}

		// Refresh other AI chat views (not the current one)
		const aiChatLeaves = this.plugin.app.workspace.getLeavesOfType('ai-chat');
		aiChatLeaves.forEach(leaf => {
			const view = leaf.view as SettingsView;
			if (view && view !== this && typeof view.updateContent === 'function') {
				view.updateContent();
			}
		});
	}

	getCurrentMode(): import('../types').AIChatMode {
		return this.currentMode;
	}

	private async checkAndResetAutoSaveTracking(): Promise<void> {
		// Only check if we have a last saved content to compare against
		if (!this.lastAutoSaveContent) {
			return;
		}

		const conversation = this.aiManager.getCurrentConversationData();
		if (!conversation || conversation.messages.length === 0) {
			// No conversation or empty conversation - reset tracking to allow saving when content is added
			this.lastAutoSaveContent = null;
			return;
		}

		// Generate current conversation markdown to compare with last saved content (auto mode, without timestamp update)
		const currentMarkdownContent = await this.generateConversationMarkdown(conversation, 'auto', false);
		
		// If content has changed, reset the tracking so next auto-save will proceed
		if (this.lastAutoSaveContent !== currentMarkdownContent) {
			getLogger().log('Conversation content changed, resetting auto-save tracking');
			this.lastAutoSaveContent = null;
		}
	}

	private updateModeSelectorButtonContent(button: HTMLButtonElement, modeData: any) {
		// Clear existing content (except dropdown arrow)
		const dropdownArrow = button.querySelector('.mode-dropdown-arrow');
		button.empty();
		// Clear button content
		
		// Add mode name
		const modeName = button.createEl('span', { text: this.getModeDisplayName(modeData.id), cls: 'mode-name' });
		
		// Re-add dropdown arrow
		if (dropdownArrow) {
			button.appendChild(dropdownArrow);
		}
	}

	private getModeDisplayName(modeId: string): string {
		const modeNames: { [key: string]: string } = {
			'analyze': 'Analyze Image',
			'ocr': 'Extract Text (OCR)',
			'chat': 'Chat without Image',
			'custom': 'Use Custom Prompt'
		};
		return modeNames[modeId] || modeId;
	}

	/**
	 * Toggle between edit and read mode for a message
	 */
	private async toggleMessageEditMode(messageContent: HTMLElement, message: AIMessage, editBtn: HTMLButtonElement): Promise<void> {
		const isCurrentlyEditing = messageContent.hasClass('editing-mode');
		
		if (isCurrentlyEditing) {
			// Switch from edit to read mode
			const textarea = messageContent.querySelector('textarea.message-edit-textarea') as HTMLTextAreaElement;
			if (textarea) {
				// Update the message content with edited markdown text
				const editedContent = textarea.value;
				message.content = editedContent;
				
				// Update the conversation in AI manager to persist changes
				this.saveEditedMessageToConversation(message.id, editedContent);
				
				// Re-render the complete message content from markdown
				await this.renderMessageContentFromMarkdown(messageContent, message);
				
				// Update button icon to edit icon
				setIcon(editBtn, 'square-pen');
				editBtn.setAttribute('data-tooltip', t('aiChat.switchEditViewButton'));
				
				messageContent.removeClass('editing-mode');
			}
		} else {
			// Switch from read to edit mode - use message.content directly (it's already markdown)
			this.renderMessageContentAsEditor(messageContent, message.content || '');
			
			// Update button icon to view icon
			setIcon(editBtn, 'eye');
			editBtn.setAttribute('data-tooltip', t('aiChat.switchEditViewButton'));
			
			messageContent.addClass('editing-mode');
		}
	}

	/**
	 * Render message content from markdown (parse images and text)
	 */
	private async renderMessageContentFromMarkdown(container: HTMLElement, message: AIMessage): Promise<void> {
		container.empty();
		
		if (!message.content) return;
		
		getLogger().log('🖼️ Rendering message content:', message.content);
		
		// Parse markdown content to extract images and text  
		const imageReferences = this.aiManager.parseImageReferences(message.content);
		getLogger().log('🔍 Found image references:', imageReferences);
		
		// Remove image markdown from text content
		let textContent = message.content;
		imageReferences.forEach(imgRef => {
			const imgMarkdown = `![${imgRef.alt}](${imgRef.path})`;
			textContent = textContent.replace(imgMarkdown, '').trim();
		});
		// Clean up extra whitespace
		textContent = textContent.replace(/\n\s*\n/g, '\n\n').trim();
		
		// Render images first (统一处理，不区分单张多张)
		if (imageReferences.length > 0) {
			const imagesContainer = container.createEl('div', { cls: 'ai-chat-message-images' });
			for (const imageRef of imageReferences) {
				await this.renderImage(imagesContainer, imageRef);
			}
		}
		
		// Render text content if present
		if (textContent.trim()) {
			const textEl = container.createEl('div', { cls: 'ai-chat-message-text' });
			await this.renderMarkdown(textEl, textContent);
		}
	}


	/**
	 * 渲染图片（统一处理）
	 */
	private async renderImage(container: HTMLElement, imageRef: { alt: string; path: string; fileName: string }): Promise<void> {
		const { alt, path, fileName } = imageRef;
		
		getLogger().log('🖼️ Rendering image:', { alt, path, fileName });
		
		// 创建图片容器
		const imageContainer = container.createEl('div', { cls: 'ai-chat-message-image-container' });
		
		let imageSrc: string;
		
		// Handle different path types
		if (path.startsWith('data:')) {
			// Data URL - use directly
			imageSrc = path;
			getLogger().log('✅ Using data URL directly');
		} else if (path.startsWith('temp:')) {
			// Temp protocol image - resolve it using ImageReferenceManager
			const tempId = path.replace('temp:', '');
			getLogger().log('🔍 Looking for temp image with ID:', tempId);
			
			const tempData = this.aiManager.getImageReferenceManager().getTempImageData(tempId);
			if (tempData) {
				imageSrc = tempData.dataUrl;
				getLogger().log('✅ Found temp image data:', { source: tempData.source, fileName: tempData.fileName });
			} else {
				getLogger().warn('❌ Temp image not found for ID:', tempId);
				
				imageSrc = 'data:image/svg+xml;base64,' + btoa(`
					<svg width="200" height="100" xmlns="http://www.w3.org/2000/svg">
						<rect width="100%" height="100%" fill="#f0f0f0" stroke="#ccc" stroke-width="2"/>
						<text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="#666">
							Missing Temp Image
						</text>
					</svg>
				`);
			}
		} else if (path.startsWith('[TempPic ') && path.endsWith(']')) {
			// Legacy placeholder path - show a placeholder image
			imageSrc = 'data:image/svg+xml;base64,' + btoa(`
				<svg width="200" height="100" xmlns="http://www.w3.org/2000/svg">
					<rect width="100%" height="100%" fill="#f0f0f0" stroke="#ccc" stroke-width="2"/>
					<text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="#666">
						Temporary Image
					</text>
				</svg>
			`);
		} else {
			// Regular path - try to get vault resource URL first, fallback to direct path
			imageSrc = this.getVaultResourceUrl(path) || path;
			
			// If that fails, try to load as data URL
			if (!imageSrc.startsWith('app://')) {
				const dataUrl = await this.loadImageDataFromPath(path);
				if (dataUrl) {
					imageSrc = dataUrl;
				}
			}
		}
		
		const imageEl = imageContainer.createEl('img', { 
			cls: 'ai-chat-message-image',
			attr: { src: imageSrc, alt: alt }
		});
		
		// Make the image draggable with proper Obsidian integration
		imageEl.draggable = true;
		imageEl.addEventListener('dragstart', (e) => {
			getLogger().log('Image drag started:', fileName, 'path:', path);
			
			// Verify the file exists before drag
			const vault = this.plugin.app.vault;
			const file = vault.getAbstractFileByPath(path);
			
			if (file) {
				getLogger().log('✅ Image file exists in vault:', path);
				
				// Use multiple dataTransfer formats for maximum compatibility
				e.dataTransfer?.setData('text/plain', `![[${file.name}]]`);
				e.dataTransfer?.setData('text/uri-list', path);
				e.dataTransfer?.setData('text/html', `![[${path}]]`);
				e.dataTransfer?.setData('application/x-obsidian-file', JSON.stringify({
					type: 'file',
					path: path,
					name: fileName
				}));
				
				getLogger().log('Set drag data for vault image:', file.name);
			} else {
				getLogger().log('⚠️ Image file not found in vault, using path:', path);
				e.dataTransfer?.setData('text/plain', path);
			}
		});
		
		// Click to show modal
		imageEl.addEventListener('click', () => {
			this.showImageModal(imageSrc);
		});
		
		// 消息块中的图片不显示文件名标签，保持界面简洁
	}

	/**
	 * Render message content as editable textarea
	 */
	private renderMessageContentAsEditor(container: HTMLElement, content: string): void {
		container.empty();
		
		const textarea = container.createEl('textarea', {
			cls: 'message-edit-textarea',
			attr: { placeholder: t('placeholder.editMessageContent') }
		});
		
		textarea.value = content;
		
		// Auto-resize textarea
		textarea.style.minHeight = '100px';
		textarea.addEventListener('input', () => {
			textarea.style.height = 'auto';
			textarea.style.height = Math.min(textarea.scrollHeight, 400) + 'px';
		});
		
		// Focus and auto-resize initially
		setTimeout(() => {
			textarea.focus();
			textarea.style.height = 'auto';
			textarea.style.height = Math.min(textarea.scrollHeight, 400) + 'px';
		}, 10);
	}


	/**
	 * Save edited message content to the conversation
	 */
	private saveEditedMessageToConversation(messageId: string, newContent: string): void {
		const conversation = this.aiManager.getCurrentConversationData();
		if (conversation) {
			const messageIndex = conversation.messages.findIndex(m => m.id === messageId);
			if (messageIndex > -1) {
				conversation.messages[messageIndex].content = newContent;
				conversation.lastUpdated = new Date();
			}
		}
	}

	/**
	 * Insert message content at cursor position in active editor
	 */
	private async insertMessageAtCursor(message: AIMessage): Promise<void> {
		try {
			// Try multiple methods to get active editor
			let activeView: MarkdownView | null = null;
			let editor: Editor | null = null;
			
			// Method 1: Get active view of type MarkdownView
			activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView && activeView.editor) {
				editor = activeView.editor;
			}
			
			// Method 2: Get active leaf and check if it's a markdown view
			if (!editor) {
				const activeLeaf = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeLeaf && activeLeaf instanceof MarkdownView && activeLeaf.editor) {
					editor = activeLeaf.editor;
					activeView = activeLeaf;
				}
			}
			
			// Method 3: Get the most recent active file and try to get its editor
			if (!editor) {
				const activeFile = this.plugin.app.workspace.getActiveFile();
				if (activeFile && activeFile.extension === 'md') {
					// Find any open markdown view for this file
					const leaves = this.plugin.app.workspace.getLeavesOfType('markdown');
					for (const leaf of leaves) {
						const view = leaf.view as MarkdownView;
						if (view.file === activeFile && view.editor) {
							editor = view.editor;
							activeView = view;
							break;
						}
					}
				}
			}
			
			if (!editor || !activeView) {
				new Notice(t('notice.openInMarkdownNote'));
				return;
			}

			// Process message content and convert temp images to attachments
			let contentToInsert = message.content || '';
			
			// Parse and convert temp: references to local files
			if (contentToInsert.includes('temp:')) {
				contentToInsert = await this.convertTempImagesForCursor(contentToInsert, activeView.file);
			}

			// Handle legacy image format (message.image) - convert to data URL
			if (message.image) {
				const allImages = (message as ExtendedMessage).images;
				if (allImages && allImages.length > 1) {
					// Multiple images
					for (const imageData of allImages) {
						let imagePath = imageData.dataUrl; // fallback
						if (imageData.localPath) {
							const formattedPath = this.formatImagePath(imageData.localPath);
							if (formattedPath) {
								imagePath = formattedPath;
							}
						}
						const sourceLabel = this.getImageSourceLabel(imageData);
						contentToInsert = `![${sourceLabel}](${imagePath})\n\n` + contentToInsert;
					}
				} else {
					// Single image
					const singleImageData = (message as ExtendedMessage).imageData;
					const firstImageFromArray = allImages && allImages.length > 0 ? allImages[0] : null;
					
					let imagePath = message.image; // fallback
					
					// Priority 1: Check images array first
					if (firstImageFromArray && firstImageFromArray.localPath) {
						const formattedPath = this.formatImagePath(firstImageFromArray.localPath);
						if (formattedPath) {
							imagePath = formattedPath;
						}
					}
					// Priority 2: Check imageData property
					else if (singleImageData && (message as ExtendedMessage).localPath) {
						const formattedPath = this.formatImagePath((message as ExtendedMessage).localPath!);
						if (formattedPath) {
							imagePath = formattedPath;
						}
					}
					
					const sourceLabel = this.getImageSourceLabel(singleImageData || firstImageFromArray);
					contentToInsert = `![${sourceLabel}](${imagePath})\n\n` + contentToInsert;
				}
			}

			// Insert at cursor position
			const cursor = editor.getCursor();
			editor.replaceRange(contentToInsert, cursor);
			
			// Move cursor to end of inserted content
			const lines = contentToInsert.split('\n');
			const newCursor = {
				line: cursor.line + lines.length - 1,
				ch: lines[lines.length - 1].length
			};
			if (lines.length === 1) {
				newCursor.ch = cursor.ch + contentToInsert.length;
				newCursor.line = cursor.line;
			}
			editor.setCursor(newCursor);

			new Notice(t('notice.contentInsertedAtCursor'));
			
		} catch (error) {
			getLogger().error('Failed to insert content at cursor:', error);
			new Notice(t('notice.failedToInsertContent'));
		}
	}

	/**
	 * Convert temp: image references to local attachments for cursor insertion
	 */
	private async convertTempImagesForCursor(content: string, currentFile: TFile | null): Promise<string> {
		if (!currentFile) {
			return content;
		}

		// Get attachments folder path relative to current file
		const attachmentsFolder = this.getAttachmentsFolderForFile(currentFile);
		
		// Ensure attachments folder exists
		const vault = this.plugin.app.vault;
		if (!await vault.adapter.exists(attachmentsFolder)) {
			await vault.createFolder(attachmentsFolder);
		}

		// Parse temp: references and replace them
		const tempImageRegex = /!\[(.*?)\]\(temp:([^)]+)\)/g;
		let updatedContent = content;
		let match;

		while ((match = tempImageRegex.exec(content)) !== null) {
			const [fullMatch, alt, tempId] = match;

			try {
				// Get temporary image data from ImageReferenceManager
				const tempImageData = this.aiManager.getImageReferenceManager().getTempImageData(tempId);
				if (!tempImageData) {
					continue;
				}

				// Save image to attachments folder
				const savedImagePath = await this.saveTempImageToAttachments(tempId, tempImageData.dataUrl, attachmentsFolder);
				
				// Replace temp: reference with local file path
				const markdownImage = `![${tempImageData.source}](${savedImagePath})`;
				updatedContent = updatedContent.replace(fullMatch, markdownImage);

			} catch (error) {
				getLogger().error(`Failed to save temporary image ${tempId}:`, error);
				// Keep the original reference if saving fails
			}
		}

		return updatedContent;
	}

	/**
	 * Get attachments folder path for a given file (following Obsidian's default behavior)
	 */
	private getAttachmentsFolderForFile(file: TFile): string {
		// Get the directory of the current file
		const fileDir = file.parent?.path || '';
		
		// Return attachments folder in the same directory as the file
		return fileDir ? `${fileDir}/attachments` : 'attachments';
	}

	/**
	 * Save a temporary image to the attachments folder
	 */
	private async saveTempImageToAttachments(tempId: string, dataUrl: string, attachmentsFolder: string): Promise<string> {
		// Get original fileName from ImageReferenceManager
		const tempImageData = this.aiManager.getImageReferenceManager().getTempImageData(tempId);
		const originalFileName = tempImageData?.fileName || 'image';
		
		// Extract image data
		const base64Data = dataUrl.split(',')[1];
		const mimeType = dataUrl.match(/data:(.*?);base64,/)?.[1] || 'image/png';
		const extension = mimeType.split('/')[1] || 'png';
		
		// Generate filename using original fileName
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		
		// Remove extension from original fileName if it exists, then add the correct extension
		const baseFileName = originalFileName.replace(/\.[^/.]+$/, '');
		// Sanitize filename for filesystem compatibility
		const sanitizedBaseName = baseFileName.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_');
		
		const fileName = `${sanitizedBaseName}_${timestamp}.${extension}`;
		const fullPath = `${attachmentsFolder}/${fileName}`;
		
		// Convert base64 to binary
		const binaryString = atob(base64Data);
		const bytes = new Uint8Array(binaryString.length);
		for (let i = 0; i < binaryString.length; i++) {
			bytes[i] = binaryString.charCodeAt(i);
		}
		
		// Save to vault
		await this.plugin.app.vault.createBinary(fullPath, bytes.buffer);
		
		return fullPath;
	}

	/**
	 * Delete a message from the conversation
	 */
	private async deleteMessage(messageId: string): Promise<void> {
		try {
			const conversation = this.aiManager.getCurrentConversationData();
			if (!conversation) {
				new Notice(t('notice.noActiveConversation'));
				return;
			}

			// Find message index
			const messageIndex = conversation.messages.findIndex(m => m.id === messageId);
			if (messageIndex === -1) {
				new Notice(t('notice.messageNotFound'));
				return;
			}

			// Show custom confirmation modal
			const message = conversation.messages[messageIndex];
			const confirmed = await this.showDeleteConfirmation(message);
			
			if (confirmed) {
				// Remove message from conversation
				conversation.messages.splice(messageIndex, 1);
				conversation.lastUpdated = new Date();
				
				// Refresh the view
				await this.updateContent();
				
				new Notice(t('notice.messageDeleted'));
			}
			
		} catch (error) {
			getLogger().error('Failed to delete message:', error);
			new Notice(t('notice.failedToDeleteMessage'));
		}
	}

	/**
	 * Show custom delete confirmation modal
	 */
	private showDeleteConfirmation(message: AIMessage): Promise<boolean> {
		return new Promise((resolve) => {
			const modal = new Modal(this.app);
			
			modal.contentEl.className = 'ai-chat-modal-content';
			
			// Title
			const title = modal.contentEl.createEl('h3', { 
				text: 'Delete Message',
				cls: 'ai-chat-modal-title'
			});
			
			// Message preview
			const isUserMessage = message.type === 'user';
			const messagePreview = (message.content || 'Image message').substring(0, 100);
			const truncated = messagePreview.length < (message.content || '').length;
			
			const description = modal.contentEl.createEl('p', {
				text: `Are you sure you want to delete this ${isUserMessage ? 'user' : 'AI'} message?`,
				cls: 'ai-chat-modal-description'
			});
			
			const preview = modal.contentEl.createEl('div', {
				text: `"${messagePreview}${truncated ? '...' : ''}"`,
				cls: 'ai-chat-modal-preview'
			});
			
			// Button container
			const buttonContainer = modal.contentEl.createEl('div', { cls: 'ai-chat-modal-button-container' });
			
			// Cancel button
			const cancelBtn = buttonContainer.createEl('button', { 
				text: 'Cancel',
				cls: 'ai-chat-modal-button-cancel'
			});
			
			// Delete button
			const deleteBtn = buttonContainer.createEl('button', { 
				text: 'Delete',
				cls: 'ai-chat-modal-button-delete'
			});
			
			// Event handlers
			cancelBtn.addEventListener('click', () => {
				modal.close();
				resolve(false);
			});
			
			deleteBtn.addEventListener('click', () => {
				modal.close();
				resolve(true);
			});
			
			// Handle escape key
			modal.contentEl.addEventListener('keydown', (e) => {
				if (e.key === 'Escape') {
					modal.close();
					resolve(false);
				}
			});
			
			// Focus delete button by default
			setTimeout(() => {
				cancelBtn.focus();
			}, 100);
			
			modal.open();
		});
	}

	// 轻量级方法：只更新send-only按钮的显示状态
	updateSendOnlyButtonVisibility() {
		const sendOnlyButton = this.containerEl.querySelector('.ai-chat-send-only-button') as HTMLElement;
		if (sendOnlyButton) {
			sendOnlyButton.toggleClass('invisible', !this.plugin.settings.showSendOnlyButton); 
		}
	}

	// 重新创建输入区域以应用设置变化（如显示/隐藏仅发送按钮）
	recreateInputArea() {
		// 找到输入区域并重新创建
		const inputArea = this.containerEl.querySelector('.ai-chat-input-area');
		if (inputArea) {
			// 清除现有输入区域
			inputArea.remove();
			// 重新创建输入区域，传递当前对话
			const currentConversation = this.aiManager.getCurrentConversationData();
			this.createInputArea(this.containerEl, currentConversation);
		}
	}
}