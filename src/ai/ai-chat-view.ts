import { ItemView, WorkspaceLeaf, TFile, Notice, MarkdownRenderer, Component, MarkdownView, Modal, Editor } from 'obsidian';
import ImageCapturePlugin from '../main';
import { AIManager, AIMessage, AIConversation } from './ai-manager';
import { ChatHistoryModal } from '../ui/chat-history-modal';
import { t } from '../i18n';
import { getLogger } from '../utils/logger';

export const AI_CHAT_VIEW_TYPE = 'ai-chat';

export class AIChatView extends ItemView {
	private plugin: ImageCapturePlugin;
	private aiManager: AIManager;
	private markdownComponent: Component;
	
	// Auto-save management
	private autoSaveTimer: NodeJS.Timeout | null = null;
	private autoSaveInterval = 30000; // 30 seconds
	private lastAutoSaveContent: string | null = null; // 存储上次自动保存的内容
	private lastAutoSaveTime = 0;
	private currentConversationId: string | null = null;
	
	// AI Chat Mode management  
	private currentMode: import('../types').AIChatMode = 'analyze';
	private modeSelector: HTMLSelectElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: ImageCapturePlugin) {
		super(leaf);
		this.plugin = plugin;
		this.aiManager = plugin.aiManager;
		this.markdownComponent = new Component();
		
		// Initialize current mode from settings
		this.currentMode = plugin.settings.defaultAIChatMode || 'analyze';
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
			this.checkAndResetAutoSaveTracking();
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
		if (oldInputArea && (oldInputArea as any)._currentImageDataList) {
			savedImageQueue = [...(oldInputArea as any)._currentImageDataList];
			getLogger().log('Saved image queue:', savedImageQueue.length, 'images');
		}
		
		container.empty();
		container.addClass('ai-chat-container');

		// Add CSS styles
		this.addStyles();

		// Header with title (remove model selector from header)
		const header = container.createEl('div', { cls: 'ai-chat-header' });
		header.createEl('h3', { text: t('aiChat.title'), cls: 'ai-chat-title' });

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
				(newInputArea as any)._currentImageDataList = savedImageQueue;
				const imagePreviewArea = (newInputArea as any)._imagePreviewArea as HTMLElement;
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
		const updateSendButtonState = (this as any)._updateSendButtonState;
		if (updateSendButtonState) {
			updateSendButtonState();
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
				cls: 'model-dropdown-option',
				attr: { 'data-model-id': modelConfig.id }
			});
			
			// Create option content with vision icon
			const optionContent = option.createEl('span', { cls: 'model-option-content' });
			optionContent.createEl('span', { text: modelConfig.name, cls: 'model-name' });
			
			if (modelConfig.isVisionCapable) {
				const visionIcon = optionContent.createEl('span', { cls: 'vision-icon' });
				// Using Lucide Eye icon with consistent size for dropdown
				visionIcon.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
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
					const imageDataList = (inputArea as any)._currentImageDataList || [];
					if (imageDataList.length > 0) {
						const imagePreviewArea = (inputArea as any)._imagePreviewArea as HTMLElement;
						if (imagePreviewArea) {
							// Re-render image preview with updated model capability
							this.renderImagePreviews(imagePreviewArea, imageDataList, inputArea);
						}
					}
				}
				
				// Update send button state
				const updateSendButtonState = (this as any)._updateSendButtonState;
				if (updateSendButtonState) {
					updateSendButtonState();
				}
				
				// Refresh other model-dependent components (settings page, other AI chat views)
				this.refreshModelDependentComponents();
				
				// Hide dropdown
				dropdown.style.display = 'none';
				const dropdownIcon = selectorButton.querySelector('.model-dropdown-arrow') as HTMLElement;
				if (dropdownIcon) {
					dropdownIcon.innerHTML = '▲';
				}
			});
		});

		// The existing event listeners for button click and document click should still work
		// since we're not removing the wrapper element
	}

	// Method to add image to queue from external sources (like image editor)
	addImageToQueue(imageDataUrl: string, fileName: string, localPath?: string | null): void {
		const inputArea = this.containerEl.querySelector('.ai-chat-input-area') as HTMLElement;
		if (!inputArea) {
			console.error('Input area not found');
			return;
		}
		
		// Check if input area has the required properties
		if (!(inputArea as any)._imagePreviewArea) {
			console.error('Image preview area not initialized');
			return;
		}
		
		// Show image preview by adding to the current image list with local path support
		this.showImagePreview(imageDataUrl, fileName, localPath);
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
			statusEl.innerHTML = `
				<div class="ai-status-warning">
					${t('aiChat.noModelsConfigured')}
				</div>
				<div class="ai-status-desc">
					${t('aiChat.noModelsDescription')}
				</div>
			`;
			statusEl.addEventListener('click', () => {
				// Open settings
				(this.plugin.app as any).setting.open();
				(this.plugin.app as any).setting.openTabById(this.plugin.manifest.id);
			});
		} else {
			const defaultModel = allModels.find(mc => mc.id === this.plugin.settings.defaultModelConfigId) || allModels[0];
			const isDefaultVisionCapable = defaultModel.isVisionCapable;
			
			if (isDefaultVisionCapable) {
				// Vision-capable model - normal green status
				const totalPlural = allModels.length > 1 ? 's' : '';
				statusEl.innerHTML = `
					<div class="ai-status-ready">
						${t('aiChat.readyWithModel', { modelName: defaultModel.name })}
					</div>
					<div class="ai-status-desc">
						${t('aiChat.allModelsConfigured', { 
							total: allModels.length, 
							totalPlural: totalPlural,
							vision: visionModels.length 
						})}
					</div>
				`;
			} else {
				// Text-only model - gray status with notice
				statusEl.classList.add('ai-status-text-only');
				const totalPlural = allModels.length > 1 ? 's' : '';
				statusEl.innerHTML = `
					<div class="ai-status-text-only-ready">
						${t('aiChat.readyWithModelTextOnly', { modelName: defaultModel.name })}
					</div>
					<div class="ai-status-desc">
						${visionModels.length > 0 
							? t('aiChat.allModelsConfigured', { 
								total: allModels.length, 
								totalPlural: totalPlural,
								vision: visionModels.length 
							})
							: t('aiChat.textOnlyModelNotice')
						}
					</div>
				`;
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
			const assistantMessage = {
				id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
				type: 'assistant' as const,
				content: response,
				timestamp: new Date()
			};
			conversation.messages.push(assistantMessage);
			
			// Update conversation title with smart title based on content
			this.aiManager.updateConversationTitle(conversation.id);
			
			await this.updateContent();

		} catch (error) {
			console.error('Failed to send text message:', error);
			// Remove typing indicator
			const conversation = this.aiManager.getCurrentConversationData();
			if (conversation) {
				const typingIndex = conversation.messages.findIndex(m => m.hasOwnProperty('isTyping'));
				if (typingIndex > -1) {
					conversation.messages.splice(typingIndex, 1);
				}
				
				const errorMessage = {
					id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
					type: 'assistant' as const,
					content: `Error: ${error.message}`,
					timestamp: new Date()
				};
				conversation.messages.push(errorMessage);
				await this.updateContent();
			}
		}
	}

	private async callAIForText(message: string, conversation: AIConversation): Promise<string> {
		// Use the new context-aware API for text-only conversations
		// Include modeprompt since this is from the send area
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
			if (file) {
				// Get the resource path that Obsidian can use to display the image
				return this.plugin.app.vault.getResourcePath(file as any);
			}
		} catch (error) {
			console.warn('Failed to get vault resource URL for path:', path, error);
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
			avatarIcon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
			avatarIcon.addClass('user-avatar');
		} else {
			// AI Assistant icon
			avatarIcon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><circle cx="12" cy="5" r="2"/><path d="m12 7-2 4 2 4 2-4-2-4z"/></svg>`;
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
		const isTyping = (message as any).isTyping || false;
		
		// 1. Insert at cursor button
		const insertBtn = actionButtons.createEl('button', { 
			cls: 'message-action-btn',
			attr: { 
				title: t('aiChat.insertToCursorButton'),
				'data-tooltip': t('aiChat.insertToCursorButton')
			}

		});
		insertBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`;
		if (isTyping) {
			insertBtn.disabled = true;
			insertBtn.style.opacity = '0.4';
			insertBtn.style.cursor = 'not-allowed';
		}
		
		// 2. Copy button  
		const copyBtn = actionButtons.createEl('button', { 
			cls: 'message-action-btn',
			attr: { 
				title: t('aiChat.copyMessageButton'),
				'data-tooltip': t('aiChat.copyMessageButton')
			}
		});
		copyBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
		if (isTyping) {
			copyBtn.disabled = true;
			copyBtn.style.opacity = '0.4';
			copyBtn.style.cursor = 'not-allowed';
		}
		
		// 3. Toggle edit/read view button
		const editBtn = actionButtons.createEl('button', { 
			cls: 'message-action-btn',
			attr: { 
				title: t('aiChat.switchEditViewButton'),
				'data-tooltip': t('aiChat.switchEditViewButton')
			}

		});
		editBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
		if (isTyping) {
			editBtn.disabled = true;
			editBtn.style.opacity = '0.4';
			editBtn.style.cursor = 'not-allowed';
		}
		
		// 4. Delete button
		const deleteBtn = actionButtons.createEl('button', { 
			cls: 'message-action-btn delete-btn',
			attr: { 
				title: t('aiChat.deleteMessageButton'),
				'data-tooltip': t('aiChat.deleteMessageButton')
			}
		});
		deleteBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c0 1 1 2 2 2v2"/></svg>`;
		if (isTyping) {
			deleteBtn.disabled = true;
			deleteBtn.style.opacity = '0.4';
			deleteBtn.style.cursor = 'not-allowed';
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
		if ((message as any).isTyping) {
			const typingEl = messageContent.createEl('div', { cls: 'ai-chat-typing-indicator' });
			typingEl.innerHTML = `
				<span class="typing-dot"></span>
				<span class="typing-dot"></span>
				<span class="typing-dot"></span>
			`;
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
			console.error('Failed to copy message:', error);
			new Notice(t('aiChat.copyFailed'));
		}
	}

	private async copyImage(imageDataUrl: string): Promise<void> {
		try {
			// Convert data URL to blob
			const response = await fetch(imageDataUrl);
			const blob = await response.blob();
			
			// Copy to clipboard
			await navigator.clipboard.write([
				new ClipboardItem({ [blob.type]: blob })
			]);
			new Notice(t('aiChat.imageCopied'));
		} catch (error) {
			console.error('Failed to copy image:', error);
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
			console.error('Failed to copy selection:', error);
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
						const allImages = (message as any).images;
						if (allImages && allImages.length > 0) {
							// Find matching image data
							const imageData = allImages.find((img: any) => 
								img.dataUrl === src || 
								(img.localPath && this.getVaultResourceUrl(img.localPath) === src)
							);
							if (imageData && imageData.localPath) {
								// Use standard Markdown format with local path
								markdown += `![${alt}](${imageData.localPath})`;
							} else {
								// Fallback to src (might be dataUrl)
								markdown += `![${alt}](${src})`;
							}
						} else {
							// Single image case
							const singleImageData = (message as any).imageData;
							if (singleImageData && singleImageData.localPath) {
								markdown += `![${alt}](${singleImageData.localPath})`;
							} else {
								markdown += `![${alt}](${src})`;
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
			const singleImageData = (message as any).imageData;
			const allImages = (message as any).images;
			
			let imagePath = message.image; // fallback to base64
			
			// Try to get local path
			if (allImages && allImages.length > 0 && allImages[0].localPath) {
				imagePath = allImages[0].localPath;
			} else if (singleImageData && singleImageData.localPath) {
				imagePath = singleImageData.localPath;
			}
				
			if (selectedText) {
				markdown = `![Screenshot](${imagePath})\n\n${markdown}`;
			} else {
				markdown = `![Screenshot](${imagePath})`;
			}
		}

		return markdown.trim();
	}

	private async copyImageAndText(imageDataUrl: string, text: string): Promise<void> {
		try {
			// Convert data URL to blob
			const response = await fetch(imageDataUrl);
			const blob = await response.blob();
			
			// Copy both image and text to clipboard
			await navigator.clipboard.write([
				new ClipboardItem({
					[blob.type]: blob,
					'text/plain': new Blob([text], { type: 'text/plain' })
				})
			]);
			new Notice('Image and text copied to clipboard');
		} catch (error) {
			console.error('Failed to copy image and text:', error);
			// Fallback to copying just text
			try {
				await navigator.clipboard.writeText(text);
				new Notice('Text copied to clipboard (image copy failed)');
			} catch (textError) {
				new Notice('Failed to copy message');
			}
		}
	}

	private createModeSelector(container: HTMLElement): void {
		const { AI_CHAT_MODES } = require('../types');
		
		// Create custom dropdown that opens upward (similar to model selector)
		const modeSelectorWrapper = container.createEl('div', { cls: 'mode-selector-wrapper' });
		
		// Current mode display button
		const currentModeData = AI_CHAT_MODES.find((mode: any) => mode.id === this.currentMode) || AI_CHAT_MODES[0];
		const selectorButton = modeSelectorWrapper.createEl('button', { 
			cls: 'mode-selector-button'
		});
		
		// Update selector button content
		this.updateModeSelectorButtonContent(selectorButton, currentModeData);
		
		// Dropdown arrow
		const dropdownIcon = selectorButton.createEl('span', { cls: 'mode-dropdown-arrow' });
		dropdownIcon.innerHTML = '▲';
		
		// Dropdown menu (initially hidden)
		const dropdown = modeSelectorWrapper.createEl('div', { cls: 'mode-dropdown-menu' });
		dropdown.style.display = 'none';
		
		// Add mode options
		AI_CHAT_MODES.forEach((mode: any) => {
			const option = dropdown.createEl('div', { 
				cls: 'mode-dropdown-option',
				attr: { 'data-mode-id': mode.id }
			});
			
			// Create option content
			const optionContent = option.createEl('span', { cls: 'mode-option-content' });
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
				this.plugin.settings.defaultAIChatMode = this.currentMode;
				await this.plugin.saveSettings();
				
				// Hide dropdown
				dropdown.style.display = 'none';
				const dropdownIconEl = selectorButton.querySelector('.mode-dropdown-arrow') as HTMLElement;
				if (dropdownIconEl) {
					dropdownIconEl.innerHTML = '▲';
				}
			});
		});
		
		// Toggle dropdown on button click
		selectorButton.addEventListener('click', (e) => {
			e.stopPropagation();
			const isVisible = dropdown.style.display === 'block';
			
			if (isVisible) {
				dropdown.style.display = 'none';
				dropdownIcon.innerHTML = '▲';
			} else {
				dropdown.style.display = 'block';
				dropdownIcon.innerHTML = '▼';
			}
		});
		
		// Hide dropdown when clicking outside
		document.addEventListener('click', () => {
			dropdown.style.display = 'none';
			dropdownIcon.innerHTML = '▲';
		});
		
		// Store reference for later use
		this.modeSelector = selectorButton as any;
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
			cls: 'ai-chat-action-btn',
			attr: { 
				title: t('aiChat.saveConversationButton'),
				'data-tooltip': t('aiChat.saveConversationButton')
			}
		});
		saveBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17,21 17,13 7,13 7,21"/><polyline points="7,3 7,8 15,8"/></svg>`;
		
		// Chat History button with Lucide history icon
		const historyBtn = rightActions.createEl('button', { 
			cls: 'ai-chat-action-btn',
			attr: { 
				title: t('aiChat.loadHistoryButton'),
				'data-tooltip': t('aiChat.loadHistoryButton')
			}
		});
		historyBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>`;
		
		// New chat button with Lucide plus icon
		const newChatBtn = rightActions.createEl('button', { 
			cls: 'ai-chat-action-btn',
			attr: { 
				title: t('aiChat.newConversationButton'),
				'data-tooltip': t('aiChat.newConversationButton')
			}
		});
		newChatBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
		
		// Menu button with Lucide more-vertical icon
		const menuBtn = rightActions.createEl('button', { 
			cls: 'ai-chat-action-btn',
			attr: { 
				title: t('aiChat.menuButton'),
				'data-tooltip': t('aiChat.menuButton')
			}
		});
		menuBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>`;
		
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
		dropIcon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/></svg>`;
		
		const dropText = dropZoneContent.createEl('span');
		dropText.innerHTML = t('aiChat.dragImageHere') + ' ';
		
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

		// Send button (moved to bottom row, with tooltip)
		const sendButton = bottomRow.createEl('button', { 
			cls: 'ai-chat-send-button-bottom',
			attr: { title: t('aiChat.sendMessageTooltip') }
		});
		sendButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22,2 15,22 11,13 2,9 22,2"/></svg>`;

		// Setup drag and drop on the entire input area
		this.setupDragAndDrop(inputArea);

		// Store references for image handling
		(inputArea as any)._imagePreviewArea = imagePreviewArea;
		(inputArea as any)._textInput = textInput;
		(inputArea as any)._sendButton = sendButton;
		(inputArea as any)._currentImageDataList = [];

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

		const sendMessage = async () => {
			const message = textInput.value.trim();
			const imageDataList = (inputArea as any)._currentImageDataList || [];
			
			if (!message && imageDataList.length === 0) return;

			// Check if any models are configured
			if (!checkModelConfigured()) {
				new Notice('Please configure at least one AI model in Settings > Set Keys');
				return;
			}

			// Get current model to check vision capability
			const allModels = this.plugin.settings.modelConfigs;
			const currentModel = allModels.find(mc => mc.id === this.plugin.settings.defaultModelConfigId) || allModels[0];
			const isVisionCapable = currentModel?.isVisionCapable || false;

			// Clear text input
			textInput.value = '';
			sendButton.disabled = true;
			sendButton.innerHTML = '⏳';

			try {
				if (imageDataList.length > 0 && isVisionCapable) {
					// Send all images with optional text for vision-capable models
					this.clearImagePreview(inputArea);
					await this.plugin.aiManager.sendImagesToAI(imageDataList.map((img: any) => ({
						dataUrl: img.dataUrl,
						fileName: img.fileName,
						localPath: img.localPath
					})), message || '');
					
					// Reset auto-save content tracking since conversation content changed
					this.lastAutoSaveContent = null;
				} else if (imageDataList.length > 0 && !isVisionCapable) {
					// For non-vision models, keep images in preview and only send text
					if (message) {
						if (conversation && conversation.messages.length > 0) {
							await this.sendFollowUpMessage(conversation, message);
						} else {
							await this.sendTextMessage(message);
						}
						// Reset auto-save content tracking since conversation content changed
						this.lastAutoSaveContent = null;
						
						// Keep images in preview but update warning message
						this.updateImagePreviewForNonVisionModel(inputArea, imageDataList);
					} else {
						// If no text message, just show a notice and keep images
						new Notice(t('aiChat.nonVisionModelCannotSendImages'));
						this.updateImagePreviewForNonVisionModel(inputArea, imageDataList);
					}
				} else if (conversation && conversation.messages.length > 0) {
					// Follow-up text message in existing conversation
					await this.sendFollowUpMessage(conversation, message);
					
					// Reset auto-save content tracking since conversation content changed
					this.lastAutoSaveContent = null;
				} else {
					// New text-only conversation
					await this.sendTextMessage(message);
					
					// Reset auto-save content tracking since conversation content changed
					this.lastAutoSaveContent = null;
				}
			} catch (error) {
				console.error('Failed to send message:', error);
				// Restore text input on error
				textInput.value = message;
			} finally {
				sendButton.disabled = false;
				sendButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22,2 15,22 11,13 2,9 22,2"/></svg>`;
			}
		};

		sendButton.addEventListener('click', sendMessage);

		// Send on Enter (not Shift+Enter) - only if models are configured
		textInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				if (checkModelConfigured()) {
					sendMessage();
				} else {
					new Notice('Please configure at least one AI model in Settings > Set Keys');
				}
			}
		});

		// Auto-resize textarea
		textInput.addEventListener('input', () => {
			textInput.style.height = 'auto';
			textInput.style.height = Math.min(textInput.scrollHeight, 120) + 'px';
		});

		// Store update function for later use
		(this as any)._updateSendButtonState = updateSendButtonState;
		
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
		const selectorWrapper = container.createEl('div', { cls: 'model-selector-wrapper' });
		
		// Current model display button
		const currentModel = allModels.find(mc => mc.id === this.plugin.settings.defaultModelConfigId) || allModels[0];
		const selectorButton = selectorWrapper.createEl('button', { 
			cls: 'model-selector-button'
		});
		
		// Update selector button content with vision icon if applicable
		this.updateSelectorButtonContent(selectorButton, currentModel);
		
		// Dropdown arrow
		const dropdownIcon = selectorButton.createEl('span', { cls: 'model-dropdown-arrow' });
		dropdownIcon.innerHTML = '▲';
		
		// Dropdown menu (initially hidden)
		const dropdown = selectorWrapper.createEl('div', { cls: 'model-dropdown-menu' });
		dropdown.style.display = 'none';
		
		// Add model options
		allModels.forEach(modelConfig => {
			const option = dropdown.createEl('div', { 
				cls: 'model-dropdown-option',
				attr: { 'data-model-id': modelConfig.id }
			});
			
			// Create option content with vision icon
			const optionContent = option.createEl('span', { cls: 'model-option-content' });
			optionContent.createEl('span', { text: modelConfig.name, cls: 'model-name' });
			
			if (modelConfig.isVisionCapable) {
				const visionIcon = optionContent.createEl('span', { cls: 'vision-icon' });
				// Using Lucide Eye icon with consistent size for dropdown
				visionIcon.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
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
					const imageDataList = (inputArea as any)._currentImageDataList || [];
					if (imageDataList.length > 0) {
						const imagePreviewArea = (inputArea as any)._imagePreviewArea as HTMLElement;
						if (imagePreviewArea) {
							// Re-render image preview with updated model capability
							this.renderImagePreviews(imagePreviewArea, imageDataList, inputArea);
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
				const updateSendButtonState = (this as any)._updateSendButtonState;
				if (updateSendButtonState) {
					updateSendButtonState();
				}
				
				// Refresh other model-dependent components (settings page, other AI chat views)
				this.refreshModelDependentComponents();
				
				// Hide dropdown
				dropdown.style.display = 'none';
				dropdownIcon.innerHTML = '▲';
			});
		});
		
		// Handle button click to toggle dropdown
		selectorButton.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			
			const isVisible = dropdown.style.display === 'block';
			if (isVisible) {
				dropdown.style.display = 'none';
				dropdownIcon.innerHTML = '▲';
			} else {
				dropdown.style.display = 'block';
				dropdownIcon.innerHTML = '▼';
			}
		});
		
		// Create a cleanup function for document listener and store it
		const clickOutsideHandler = (e: MouseEvent) => {
			if (!selectorWrapper.contains(e.target as Node)) {
				dropdown.style.display = 'none';
				dropdownIcon.innerHTML = '▲';
			}
		};
		
		// Store the handler for cleanup
		(selectorWrapper as any)._clickOutsideHandler = clickOutsideHandler;
		
		// Add document listener
		document.addEventListener('click', clickOutsideHandler);
		
		// Clean up previous handler if it exists
		const prevHandler = (container as any)._prevClickOutsideHandler;
		if (prevHandler) {
			document.removeEventListener('click', prevHandler);
		}
		(container as any)._prevClickOutsideHandler = clickOutsideHandler;
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
					
					// Check if the file is already in the vault
					const vault = this.plugin.app.vault;
					let localPath: string | null = null;
					
					// Try to check if it's a vault file (this is tricky with file picker)
					// For now, we'll treat all browse files as external and save them
					localPath = await this.saveExternalImageToVault(dataUrl, file.name);
					
					this.showImagePreview(dataUrl, file.name, localPath);
				} catch (error) {
					console.error('Failed to process selected image:', error);
					new Notice(`Failed to process image: ${error.message}`);
				}
			}
		});
		input.click();
	}

	private updateImagePreviewForNonVisionModel(inputArea: HTMLElement, imageDataList: any[]): void {
		const imagePreviewArea = (inputArea as any)._imagePreviewArea as HTMLElement;
		if (!imagePreviewArea) return;
		
		// Update the current image data list
		(inputArea as any)._currentImageDataList = imageDataList;
		
		// Re-render with automatic model capability detection
		this.renderImagePreviews(imagePreviewArea, imageDataList, inputArea);
	}

	private renderImagePreviews(container: HTMLElement, imageDataList: any[], inputArea: HTMLElement, isNonVisionModel: boolean = false): void {
		container.innerHTML = '';
		
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
			cls: 'ai-chat-action-btn',
			attr: { 
				title: t('aiChat.clearAllImages'),
				'data-tooltip': t('aiChat.clearAllImages')
			}
		});
		clearAllBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c0 1 1 2 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;
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
					console.warn('⚠️ Image dragged without local path - this will result in pasted image behavior:', imageData);
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
			removeBtn.innerHTML = '✕'; // Use heavy multiplication X (更粗的斜十字)
			removeBtn.title = t('aiChat.removeThisImage');
			removeBtn.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.removeImageFromPreview(imageData.id, inputArea);
			});
		});
	}

	private removeImageFromPreview(imageId: string, inputArea: HTMLElement): void {
		const imageDataList = (inputArea as any)._currentImageDataList || [];
		const filteredList = imageDataList.filter((img: any) => img.id !== imageId);
		(inputArea as any)._currentImageDataList = filteredList;
		
		const imagePreviewArea = (inputArea as any)._imagePreviewArea as HTMLElement;
		this.renderImagePreviews(imagePreviewArea, filteredList, inputArea);
	}

	private showImagePreview(dataUrl: string, fileName: string, localPath?: string | null): void {
		const inputArea = this.containerEl.querySelector('.ai-chat-input-area') as HTMLElement;
		if (!inputArea) return;

		const imagePreviewArea = (inputArea as any)._imagePreviewArea as HTMLElement;
		if (!imagePreviewArea) return;
		
		const imageDataList = (inputArea as any)._currentImageDataList || [];
		
		// Add new image to the list with local path support
		const newImageData = { 
			dataUrl, 
			fileName, 
			id: Date.now().toString(),
			localPath: localPath || null  // Store local path if available
		};
		imageDataList.push(newImageData);
		(inputArea as any)._currentImageDataList = imageDataList;
		
		imagePreviewArea.style.display = 'block';
		
		// Render all images in preview
		this.renderImagePreviews(imagePreviewArea, imageDataList, inputArea);
	}

	private clearImagePreview(inputArea: HTMLElement): void {
		const imagePreviewArea = (inputArea as any)._imagePreviewArea as HTMLElement;
		imagePreviewArea.style.display = 'none';
		imagePreviewArea.innerHTML = '';
		(inputArea as any)._currentImageDataList = [];
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
							this.showImagePreview(dataUrl, abstractFile.name, filePath);
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
						this.showImagePreview(dataUrl, vaultFile.name, extractedPath);
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
				new Notice('Please drop image files only');
				return;
			}

			try {
				// Process all external image files and save them to vault
				for (const file of imageFiles) {
					const dataUrl = await this.fileToDataUrl(file);
					// Save external image to vault to get local path
					const localPath = await this.saveExternalImageToVault(dataUrl, file.name);
					this.showImagePreview(dataUrl, file.name, localPath);
				}
			} catch (error) {
				console.error('Failed to process dropped images:', error);
				new Notice(`Failed to process images: ${error.message}`);
			}
		};

		// 只监听dropZone本身的事件
		dropZone.addEventListener('dragenter', handleDragEnter);
		dropZone.addEventListener('dragleave', handleDragLeave);
		dropZone.addEventListener('dragover', handleDragOver);
		dropZone.addEventListener('drop', handleDrop);

		// Store cleanup function
		(dropZone as any)._dragCleanup = () => {
			dropZone.removeEventListener('dragenter', handleDragEnter);
			dropZone.removeEventListener('dragleave', handleDragLeave);
			dropZone.removeEventListener('dragover', handleDragOver);
			dropZone.removeEventListener('drop', handleDrop);
		};
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
				await vault.createFolder(saveLocation);
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
			console.error('Failed to save external image to vault:', error);
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
			const file = abstractFile as TFile;
			getLogger().log('Reading vault file:', file.path);
			
			const buffer = await vault.readBinary(file);
			const mimeType = this.getMimeType(file.extension);
			const blob = new Blob([buffer], { type: mimeType });
			
			return new File([blob], file.name, { type: mimeType });
			
		} catch (error) {
			console.error('Failed to handle vault file drop:', error);
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
			const assistantMessage: AIMessage = {
				id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
				type: 'assistant',
				content: response,
				timestamp: new Date()
			};
			conversation.messages.push(assistantMessage);
			
			// Update conversation title with smart title based on content
			this.aiManager.updateConversationTitle(conversation.id);
			
			this.updateContent();

		} catch (error) {
			console.error('Follow-up message failed:', error);
			
			// Remove typing indicator
			const typingIndex = conversation.messages.findIndex(m => m.hasOwnProperty('isTyping'));
			if (typingIndex > -1) {
				conversation.messages.splice(typingIndex, 1);
			}
			
			// Add error message
			const errorMessage: AIMessage = {
				id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
				type: 'assistant',
				content: `Error: ${error.message}`,
				timestamp: new Date()
			};
			conversation.messages.push(errorMessage);
			this.updateContent();
		}
	}

	private async callAIForFollowUp(message: string, imageDataUrl: string, conversation: AIConversation): Promise<string> {
		// Use the new context-aware API for follow-up questions
		// Don't include modeprompt for follow-up calls (only initial send area calls should have it)
		return await this.aiManager.callAIWithContext(conversation, message, [imageDataUrl], undefined, false);
	}

	private async renderMarkdown(container: HTMLElement, content: string): Promise<void> {
		// First, extract and render thinking blocks
		let processedContent = this.extractAndRenderThinkingBlocks(container, content);
		
		// LaTeX delimiter conversion - be very precise about what we capture
		// \[ ... \] -> $$...$$  (capture content inside brackets)
		processedContent = processedContent.replace(/\\\(\s*([^]*?)\s*\\\)/g, function(match, formula) {
			return ' $' + formula.trim() + '$ ';
		});
		
		// \( ... \) -> $...$ (capture content inside parentheses, exclude the parentheses themselves)
		processedContent = processedContent.replace(/\\\[\s*([^]*?)\s*\\\]/g, function(match, formula) {
			return ' $$' + formula.trim() + '$$ ';
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
			console.error('Failed to render markdown:', error);
			markdownContainer.createEl('div', { text: processedContent });
		}
	}

	private styleRenderedMarkdown(container: HTMLElement): void {
		// Add custom CSS classes for better integration with the chat interface
		container.addClass('ai-chat-markdown-content');
		
		// Ensure proper spacing for elements
		const elements = container.querySelectorAll('p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre, table');
		elements.forEach((el) => {
			(el as HTMLElement).style.marginBottom = '8px';
			(el as HTMLElement).style.marginTop = '0';
		});
		
		// Style code blocks
		const codeBlocks = container.querySelectorAll('pre');
		codeBlocks.forEach((block) => {
			(block as HTMLElement).style.background = 'var(--background-secondary)';
			(block as HTMLElement).style.border = '1px solid var(--background-modifier-border)';
			(block as HTMLElement).style.borderRadius = '4px';
			(block as HTMLElement).style.padding = '8px';
			(block as HTMLElement).style.fontSize = '14px';
			(block as HTMLElement).style.fontFamily = 'var(--font-monospace)';
		});
		
		// Style inline code
		const inlineCodes = container.querySelectorAll('code:not(pre code)');
		inlineCodes.forEach((code) => {
			(code as HTMLElement).style.background = 'var(--background-secondary)';
			(code as HTMLElement).style.padding = '2px 4px';
			(code as HTMLElement).style.borderRadius = '3px';
			(code as HTMLElement).style.fontSize = '0.9em';
			(code as HTMLElement).style.fontFamily = 'var(--font-monospace)';
		});
		
		// Style tables
		const tables = container.querySelectorAll('table');
		tables.forEach((table) => {
			(table as HTMLElement).style.borderCollapse = 'collapse';
			(table as HTMLElement).style.width = '100%';
			(table as HTMLElement).style.fontSize = '14px';
		});
		
		// Style table cells
		const tableCells = container.querySelectorAll('td, th');
		tableCells.forEach((cell) => {
			(cell as HTMLElement).style.border = '1px solid var(--background-modifier-border)';
			(cell as HTMLElement).style.padding = '6px 8px';
		});
		
		// Style table headers
		const tableHeaders = container.querySelectorAll('th');
		tableHeaders.forEach((header) => {
			(header as HTMLElement).style.background = 'var(--background-secondary)';
			(header as HTMLElement).style.fontWeight = '600';
		});
		
		// Style blockquotes
		const blockquotes = container.querySelectorAll('blockquote');
		blockquotes.forEach((quote) => {
			(quote as HTMLElement).style.borderLeft = '4px solid var(--interactive-accent)';
			(quote as HTMLElement).style.paddingLeft = '12px';
			(quote as HTMLElement).style.marginLeft = '0';
			(quote as HTMLElement).style.fontStyle = 'italic';
			(quote as HTMLElement).style.color = 'var(--text-muted)';
		});
		
		// Ensure LaTeX math renders properly
		const mathElements = container.querySelectorAll('.math, .math-block, .math-inline');
		mathElements.forEach((math) => {
			(math as HTMLElement).style.fontSize = '16px';
			(math as HTMLElement).style.lineHeight = '1.4';
		});
		
		// Handle links
		const links = container.querySelectorAll('a');
		links.forEach((link) => {
			(link as HTMLElement).style.color = 'var(--interactive-accent)';
			(link as HTMLElement).style.textDecoration = 'none';
			
			// Add hover effect
			link.addEventListener('mouseenter', () => {
				(link as HTMLElement).style.textDecoration = 'underline';
			});
			link.addEventListener('mouseleave', () => {
				(link as HTMLElement).style.textDecoration = 'none';
			});
		});
	}

	private extractAndRenderThinkingBlocks(container: HTMLElement, content: string): string {
		// Define thinking-related tags to look for
		const thinkingTags = ['think', 'thinking', 'reasoning', 'plan', 'analysis', 'internal', 'reflection', 'decision'];
		
		let processedContent = content;
		
		// Process each thinking tag type
		for (const tag of thinkingTags) {
			// Match both ◁/tagname▷ and <tagname> patterns
			const patterns = [
				new RegExp(`◁/${tag}▷([\\s\\S]*?)◁/${tag}▷`, 'gi'),
				new RegExp(`<${tag}([^>]*)>([\\s\\S]*?)</${tag}>`, 'gi'),
				new RegExp(`◁${tag}▷([\\s\\S]*?)◁/${tag}▷`, 'gi')
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
					toggleIcon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>`;
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
							toggleIcon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
						} else {
							toggleIcon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>`;
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
				// Handle basic formatting
				let text = line;
				text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
				text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
				text = text.replace(/`(.*?)`/g, '<code>$1</code>');
				p.innerHTML = text;
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
		modal.className = 'ai-image-modal';
		modal.style.cssText = `
			position: fixed;
			top: 0;
			left: 0;
			width: 100%;
			height: 100%;
			background: rgba(0, 0, 0, 0.8);
			display: flex;
			align-items: center;
			justify-content: center;
			z-index: 1000;
			cursor: pointer;
		`;

		const img = document.createElement('img');
		img.src = imageSrc;
		img.style.cssText = `
			max-width: 90%;
			max-height: 90%;
			object-fit: contain;
		`;

		modal.appendChild(img);
		modal.addEventListener('click', () => {
			document.body.removeChild(modal);
		});

		document.body.appendChild(modal);
	}

	private addStyles(): void {
		// Add CSS styles for the AI chat interface
		if (!document.getElementById('ai-chat-styles')) {
			const style = document.createElement('style');
			style.id = 'ai-chat-styles';
			style.textContent = `
				.ai-chat-container {
					display: flex;
					flex-direction: column;
					height: 100%;
					padding: 0;
				}

				.ai-chat-header {
					padding: 16px;
					border-bottom: 1px solid var(--background-modifier-border);
					background: var(--background-secondary);
				}

				.ai-chat-title {
					margin: 0 0 8px 0;
					font-size: 16px;
					font-weight: 600;
				}

				.model-selector {
					display: flex;
					align-items: center;
					gap: 8px;
				}

				.model-select {
					padding: 4px 8px;
					border: 1px solid var(--background-modifier-border);
					border-radius: 4px;
					background: var(--background-primary);
					color: var(--text-normal);
					font-size: 12px;
					min-width: 150px;
				}

				.current-model {
					font-size: 12px;
					color: var(--text-muted);
					padding: 4px 8px;
					background: var(--background-primary);
					border-radius: 4px;
					border: 1px solid var(--background-modifier-border);
				}

				.no-models {
					font-size: 12px;
					color: var(--text-warning);
					cursor: pointer;
					padding: 4px 8px;
					border-radius: 4px;
					text-decoration: underline;
				}

				.no-models:hover {
					background: var(--background-modifier-hover);
				}

				.ai-chat-area {
					flex: 1;
					overflow-y: scroll;
					padding: 16px 0;
					/* Always reserve space for scrollbar to prevent layout shifts */
					scrollbar-gutter: stable;
				}

				.ai-chat-empty {
					text-align: center;
					padding: 16px 16px;
					color: var(--text-muted);
				}

				.ai-chat-empty-icon {
					font-size: 48px;
					margin-bottom: 16px;
				}

				.ai-chat-empty-title {
					font-size: 18px;
					font-weight: 600;
					margin-bottom: 8px;
					color: var(--text-normal);
				}

				.ai-chat-empty-desc {
					font-size: 14px;
					line-height: 1.4;
					margin-bottom: 16px;
				}

				.ai-chat-empty-actions {
					margin: 16px 0;
					text-align: left;
				}

				.ai-chat-empty-action {
					margin: 8px 0;
					font-size: 13px;
					line-height: 1.4;
				}

				.ai-chat-quick-actions {
					display: flex;
					gap: 8px;
					justify-content: center;
					margin-top: 20px;
				}

				.ai-chat-quick-btn {
					padding: 8px 12px;
					background: var(--interactive-accent);
					color: var(--text-on-accent);
					border: none;
					border-radius: 4px;
					cursor: pointer;
					font-size: 12px;
					font-weight: 500;
				}

				.ai-chat-quick-btn:hover {
					background: var(--interactive-accent-hover);
				}

				.ai-chat-title-section {
					text-align: center;
					margin-bottom: 24px;
				}

				.ai-chat-main-title {
					margin: 0;
					font-size: 20px;
					font-weight: 600;
					color: var(--text-normal);
				}

				.ai-chat-prompts-section {
					margin-bottom: 24px;
				}

				.ai-chat-section-title {
					padding-top: 20px;  /* 添加上内边距 */
					margin: 0 0 12px 0;
					font-size: 14px;
					font-weight: 600;
					color: var(--text-normal);
				}

				.ai-chat-note-indicator {
					font-size: 12px;
					color: var(--text-muted);
					margin-bottom: 8px;
				}

				.ai-chat-new-chat-btn {
					width: 100%;
					padding: 8px 12px;
					background: var(--interactive-accent);
					color: var(--text-on-accent);
					border: none;
					border-radius: 4px;
					cursor: pointer;
					font-size: 12px;
					font-weight: 500;
					margin-bottom: 12px;
				}

				.ai-chat-new-chat-btn:hover {
					background: var(--interactive-accent-hover);
				}

				.ai-chat-prompts-list {
					display: flex;
					flex-direction: column;
					gap: 6px;
				}

				.ai-chat-prompt-item {
					padding: 8px 12px;
					background: var(--background-secondary);
					border: 1px solid var(--background-modifier-border);
					border-radius: 4px;
					cursor: pointer;
					font-size: 12px;
					line-height: 1.3;
					color: var(--text-normal);
					transition: background-color 0.2s;
				}

				.ai-chat-prompt-item:hover {
					background: var(--background-modifier-hover);
				}

				.ai-chat-instructions-section {
					margin-bottom: 20px;
				}

				.ai-chat-instructions-list {
					display: flex;
					flex-direction: column;
					align-items: center;  /* 水平居中 */
					gap: 8px;
				}

				.ai-chat-instruction-item {
					display: flex;
					align-items: flex-start;
					gap: 8px;
					font-size: 12px;
					line-height: 1.4;
				}

				.ai-chat-instruction-icon {
					font-size: 14px;
					flex-shrink: 0;
				}

				.ai-chat-instruction-text {
					color: var(--text-muted);
				}

				.ai-status {
					margin-top: 12px;
					padding: 8px;
					border-radius: 6px;
					text-align: center;
				}

				.ai-status-warning {
					color: var(--text-warning);
					font-weight: 600;
					margin-bottom: 4px;
				}

				.ai-status-ready {
					color: var(--text-success);
					font-weight: 600;
					margin-bottom: 4px;
				}

				.ai-status-text-only-ready {
					color: var(--text-muted);
					font-weight: 600;
					margin-bottom: 4px;
				}

				.ai-status-desc {
					font-size: 12px;
					color: var(--text-muted);
				}

				.ai-status:hover {
					background: var(--background-modifier-hover);
					cursor: pointer;
				}

				.ai-chat-messages {
					flex: 1;
					display: flex;
					flex-direction: column;
					gap: 16px;
					padding: 0 16px;
					max-height: 100%;
					overflow-y: scroll; /* Always show scrollbar to prevent width jumping */
					scrollbar-gutter: stable; /* Reserve space for scrollbar */
				}
				
				/* Custom scrollbar styling for better appearance */
				.ai-chat-messages::-webkit-scrollbar {
					width: 8px;
				}
				
				.ai-chat-messages::-webkit-scrollbar-track {
					background: var(--background-secondary);
					border-radius: 4px;
				}
				
				.ai-chat-messages::-webkit-scrollbar-thumb {
					background: var(--background-modifier-border);
					border-radius: 4px;
				}
				
				.ai-chat-messages::-webkit-scrollbar-thumb:hover {
					background: var(--background-modifier-border-hover);
				}

				/* New message block layout */
				.ai-chat-message {
					display: flex;
					flex-direction: column;
					width: 100%;
					background: var(--background-secondary);
					border: 2px solid var(--background-modifier-border);
					border-radius: 6px;
					padding: 6px;
					transition: all 0.2s ease;
					margin-bottom: 8px;
				}

				.ai-chat-message:hover {
					border-color: var(--background-modifier-hover);
					box-shadow: 0 1px 6px rgba(0, 0, 0, 0.12);
				}

				.ai-chat-message-row {
					display: flex;
					gap: 8px;
					width: 100%;
				}

				/* Avatar section */
				.ai-chat-message-avatar {
					flex-shrink: 0;
					width: 32px;
					display: flex;
					flex-direction: column;
					align-items: center;
				}

				.ai-chat-avatar-icon {
					width: 28px;
					height: 28px;
					border-radius: 50%;
					display: flex;
					align-items: center;
					justify-content: center;
				}

				.ai-chat-avatar-icon.user-avatar {
					background: var(--background-secondary);
					color: var(--text-muted);
				}

				.ai-chat-avatar-icon.ai-avatar {
					background: var(--background-secondary);
					color: var(--text-muted);
				}

				/* Content section takes remaining width */
				.ai-chat-message-content-section {
					flex: 1;
					display: flex;
					flex-direction: column;
					gap: 4px;
					min-width: 0;
				}

				.ai-chat-message-header {
					display: flex;
					justify-content: space-between;
					align-items: center;
					font-size: 12px;
					color: var(--text-muted);
					margin-bottom: 6px;
					padding: 4px 0;
					min-height: 24px;
				}

				.ai-chat-message-time {
					opacity: 0.8;
					font-size: 11px;
					font-weight: 500;
				}

				.ai-chat-message-content {
					background: transparent;
					border: none;
					padding: 0;
					width: 100%;
					line-height: 1.3;
					font-size: 14px;
				}

				/* Action buttons - now in header on right */
				.ai-chat-message-actions {
					display: flex;
					gap: 2px;
					opacity: 0.6;
					transition: opacity 0.2s ease;
				}

				.ai-chat-message:hover .ai-chat-message-actions {
					opacity: 1;
				}

				.message-action-btn {
					background: transparent !important;
					border: none !important;
					padding: 6px !important;
					border-radius: 4px !important;
					color: #9CA3AF !important;
					cursor: pointer !important;
					transition: all 0.2s ease !important;
					display: flex !important;
					align-items: center !important;
					justify-content: center !important;
					width: 24px !important;
					height: 24px !important;
					position: relative !important;
					outline: none !important;
					box-shadow: none !important;
				}

				.message-action-btn:hover {
					background: transparent !important;
					color: #1F2937 !important;
					border: none !important;
					outline: none !important;
					box-shadow: none !important;
				}

				.theme-dark .message-action-btn {
					color: #6B7280 !important;
				}

				.theme-dark .message-action-btn:hover {
					color: #F9FAFB !important;
				}

				.message-action-btn:disabled {
					opacity: 0.4 !important;
					cursor: not-allowed !important;
					pointer-events: auto !important;
				}

				.message-action-btn:disabled:hover {
					background: transparent !important;
					color: #9CA3AF !important;
				}

				.theme-dark .message-action-btn:disabled:hover {
					color: #6B7280 !important;
				}

				.message-action-btn.delete-btn:hover {
					color: var(--text-error) !important;
				}

				/* Enhanced tooltip styles */
				.message-action-btn::after {
					content: attr(data-tooltip);
					position: absolute;
					left: 50%;
					top: 100%;
					margin-top: 8px;
					transform: translateX(-50%);
					background: #374151;
					color: white;
					padding: 6px 8px;
					border-radius: 4px;
					font-size: 12px;
					white-space: nowrap;
					opacity: 0;
					pointer-events: none;
					transition: opacity 0.2s ease;
					z-index: 1000;
				}

				.message-action-btn:hover::after {
					opacity: 1;
				}

				.ai-chat-message-image {
					max-width: 200px;
					max-height: 200px;
					border-radius: 4px;
					cursor: pointer;
					margin-bottom: 8px;
					object-fit: contain;
					transition: all 0.2s ease;
					border: 2px solid transparent;
				}

				/* Image selection and hover effects */
				.ai-chat-message-image::selection {
					background: rgba(0, 123, 255, 0.4);
					outline: 3px solid rgba(0, 123, 255, 0.6);
					border-radius: 6px;
				}

				.ai-chat-message-image::-moz-selection {
					background: rgba(0, 123, 255, 0.4);
					outline: 3px solid rgba(0, 123, 255, 0.6);
					border-radius: 6px;
				}

				.ai-chat-message-image:hover {
					border-color: rgba(0, 123, 255, 0.3);
					transform: scale(1.02);
				}

				/* Enhance selection visibility when part of text selection */
				.ai-chat-message-content:has(*::selection) .ai-chat-message-image {
					outline: 2px solid rgba(0, 123, 255, 0.5);
					outline-offset: 2px;
				}

				.ai-chat-message-images-grid {
					display: grid;
					grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
					gap: 12px;
					margin-bottom: 8px;
				}

				.ai-chat-message-image-wrapper {
					display: flex;
					flex-direction: column;
					align-items: center;
					gap: 4px;
				}

				.ai-chat-message-image-wrapper .ai-chat-message-image {
					width: 100%;
					max-width: 180px;
					max-height: 180px;
					margin-bottom: 0;
					transition: all 0.2s ease;
					border: 2px solid transparent;
				}

				/* Grid image selection and hover effects */
				.ai-chat-message-image-wrapper .ai-chat-message-image::selection {
					background: rgba(0, 123, 255, 0.4);
					outline: 3px solid rgba(0, 123, 255, 0.6);
					border-radius: 6px;
				}

				.ai-chat-message-image-wrapper .ai-chat-message-image::-moz-selection {
					background: rgba(0, 123, 255, 0.4);
					outline: 3px solid rgba(0, 123, 255, 0.6);
					border-radius: 6px;
				}

				.ai-chat-message-image-wrapper .ai-chat-message-image:hover {
					border-color: rgba(0, 123, 255, 0.3);
					transform: scale(1.02);
				}

				.ai-chat-message-image-filename {
					font-size: 10px;
					color: var(--text-muted);
					text-align: center;
					word-break: break-all;
					max-width: 180px;
				}

				.ai-chat-image-count-indicator {
					font-size: 11px;
					color: var(--text-muted);
					background: var(--background-modifier-border);
					padding: 2px 6px;
					border-radius: 10px;
					margin-top: 4px;
					display: inline-block;
					font-weight: 500;
				}

				.ai-chat-message-text {
					line-height: 1.3;
					font-size: 14px;
				}

				.ai-chat-message-text p {
					margin: 0 0 4px 0;
					line-height: 1.3;
				}

				.ai-chat-message-text p:last-child {
					margin-bottom: 0;
				}

				.ai-chat-message-text h1,
				.ai-chat-message-text h2,
				.ai-chat-message-text h3 {
					margin: 6px 0 3px 0;
					line-height: 1.2;
				}

				.ai-chat-message-text ul,
				.ai-chat-message-text ol {
					margin: 4px 0;
					padding-left: 16px;
					line-height: 1.3;
				}

				.ai-chat-message-text li {
					margin: 2px 0;
				}

				.ai-chat-message-text code {
					background: var(--background-secondary);
					padding: 1px 3px;
					border-radius: 2px;
					font-family: var(--font-monospace);
					font-size: 0.9em;
				}

				.ai-chat-typing-indicator {
					display: flex;
					align-items: center;
					gap: 4px;
					padding: 8px 0;
				}

				.typing-dot {
					width: 8px;
					height: 8px;
					border-radius: 50%;
					background: var(--text-muted);
					animation: typingDots 1.4s infinite ease-in-out;
				}

				.typing-dot:nth-child(1) {
					animation-delay: 0s;
				}

				.typing-dot:nth-child(2) {
					animation-delay: 0.2s;
				}

				.typing-dot:nth-child(3) {
					animation-delay: 0.4s;
				}

				@keyframes typingDots {
					0%, 60%, 100% {
						transform: translateY(0);
						opacity: 0.4;
					}
					30% {
						transform: translateY(-10px);
						opacity: 1;
					}
				}

				.ai-chat-input-area {
					border-top: 1px solid var(--background-modifier-border);
					padding: 2px 4px 4px 4px;
				}

				/* Top action bar */
				.ai-chat-top-action-bar {
					display: flex;
					justify-content: space-between;
					align-items: center;
					margin-bottom: 2px;
					padding: 0;
				}

				.ai-chat-left-actions-top {
					display: flex;
					gap: 4px;
					align-items: center;
				}

				.ai-chat-right-actions-top {
					display: flex;
					gap: 4px;
				}

				.ai-chat-action-btn {
					background: transparent !important;
					border: none !important;
					outline: none !important;
					box-shadow: none !important;
					font-size: 16px;
					padding: 8px;
					border-radius: 0;
					cursor: pointer;
					transition: color 0.2s ease;
					color: #9CA3AF !important; /* Ensure gray color is applied with !important */
					display: flex;
					align-items: center;
					justify-content: center;
					min-width: 32px;
					height: 32px;
					position: relative;
				}

				.ai-chat-action-btn:hover {
					color: #1F2937 !important; /* Darker black on hover */
					background: transparent !important;
					border: none !important;
					box-shadow: none !important;
				}

				.ai-chat-action-btn:focus {
					outline: none !important;
					border: none !important;
					box-shadow: none !important;
				}

				.theme-dark .ai-chat-action-btn {
					color: #6B7280 !important; /* Lighter gray for dark theme with !important */
				}

				.theme-dark .ai-chat-action-btn:hover {
					color: #F9FAFB !important; /* Light color on hover in dark theme */
				}

				/* Tooltip styles */
				.ai-chat-action-btn::after {
					content: attr(data-tooltip);
					position: absolute;
					left: 50%;
					bottom: 100%;
					margin-bottom: 8px;
					transform: translateX(-50%);
					background: #374151;
					color: white;
					padding: 6px 8px;
					border-radius: 4px;
					font-size: 12px;
					white-space: nowrap;
					opacity: 0;
					pointer-events: none;
					transition: opacity 0.2s ease;
					z-index: 1000;
				}

				.ai-chat-action-btn:hover::after {
					opacity: 1;
				}

				/* Drag and drop zone - ultra minimalist */
				.ai-chat-drop-zone {
					border: 2px dashed #E5E7EB;
					border-radius: 4px;
					padding: 6px;
					margin-bottom: 2px;
					text-align: center;
					transition: border-color 0.2s ease;
					background: transparent;
				}

				.ai-chat-drop-zone:hover {
					border-color: #9CA3AF;
				}

				.ai-chat-drop-zone-active {
					border: 2px dashed var(--interactive-accent) !important;
					background: var(--background-modifier-border) !important;
					transform: scale(1.02);
				}

				.ai-chat-drop-zone-content {
					display: flex;
					align-items: center;
					justify-content: center;
					gap: 8px;
					color: var(--text-muted);
					font-size: 14px;
				}

				.ai-chat-drop-zone-icon {
					font-size: 18px;
				}

				.file-picker-link {
					color: var(--interactive-accent);
					text-decoration: none;
					cursor: pointer;
				}

				.file-picker-link:hover {
					text-decoration: underline;
				}

				/* Input container - completely borderless */
				.ai-chat-input-container {
					position: relative;
					display: flex;
					align-items: flex-end;
					background: transparent;
					border: none !important;
					outline: none !important;
					border-radius: 0;
					padding: 8px 4px;
					margin-bottom: 2px;
					transition: none;
					box-shadow: none !important;
					min-height: 60px;
				}

				.ai-chat-input-container:focus-within {
					border: none !important;
					outline: none !important;
					box-shadow: none !important;
				}

				.ai-chat-input {
					flex: 1;
					border: none;
					outline: none;
					background: transparent;
					color: var(--text-normal);
					font-family: inherit;
					font-size: 16px;
					line-height: 1.6;
					resize: none;
					min-height: 80px;
					max-height: 200px;
					overflow-y: auto;
					padding-right: 8px; /* Reduced padding since send button moved */
				}

				.ai-chat-input::placeholder {
					color: #D1D5DB; /* Lighter gray for placeholder text */
				}

				.theme-dark .ai-chat-input::placeholder {
					color: #6B7280; /* Appropriate gray for dark theme */
				}

				

				/* Bottom row - revised layout */
				.ai-chat-bottom-row {
					display: flex;
					align-items: center;
					justify-content: space-between;
					padding: 0 1px;
					margin-top: 1px;
					height: 32px; /* 固定高度防止layout shift */
					position: relative; /* 为dropdown提供定位上下文 */
				}

				.model-selector-container {
					flex: 1;
					height: 32px; /* 固定高度与wrapper一致 */
					overflow: visible; /* 允许dropdown超出容器 */
				}

				/* Send button in bottom row */
				.ai-chat-send-button-bottom {
					background: transparent !important;
					border: none !important;
					outline: none !important;
					box-shadow: none !important;
					color: #D1D5DB; /* Lighter gray default */
					font-size: 16px;
					padding: 6px;
					border-radius: 4px;
					cursor: pointer;
					transition: color 0.2s ease;
					display: flex;
					align-items: center;
					justify-content: center;
					width: 32px;
					height: 32px;
					margin-left: 8px;
				}

				.ai-chat-send-button-bottom:hover:not(:disabled) {
					color: #1F2937 !important; /* Darker black on hover */
					background: transparent !important;
				}

				.theme-dark .ai-chat-send-button-bottom {
					color: #6B7280; /* Lighter gray for dark theme */
				}

				.theme-dark .ai-chat-send-button-bottom:hover:not(:disabled) {
					color: #F9FAFB !important; /* Light color on hover in dark theme */
				}

				.ai-chat-send-button-bottom:disabled {
					color: #D1D5DB;
					cursor: not-allowed;
				}

				.ai-chat-send-button-bottom.no-models-disabled {
					opacity: 0.3;
					cursor: not-allowed;
					background-color: var(--background-modifier-border);
					color: var(--text-muted);
					border-color: var(--background-modifier-border);
				}

				.ai-chat-right-actions {
					display: flex;
					gap: 8px;
				}

				.ai-chat-action-secondary {
					padding: 6px 12px;
					background: var(--background-secondary);
					border: 1px solid var(--background-modifier-border);
					border-radius: 4px;
					color: var(--text-muted);
					cursor: pointer;
					font-size: 13px;
					transition: all 0.2s ease;
				}

				.ai-chat-action-secondary:hover {
					background: var(--background-modifier-hover);
					color: var(--text-normal);
				}

				/* Model selector with upward popup */
				.model-selector-wrapper {
					position: relative;
					height: 32px; /* 固定高度防止layout shift */
					overflow: visible; /* 确保dropdown可以显示在外面 */
				}

				.model-selector-button {
					display: flex;
					align-items: center;
					justify-content: flex-start; /* 确保内容左对齐 */
					gap: 4px;
					padding: 4px 8px;
					background: transparent !important;
					border: none !important;
					border-radius: 4px;
					color: #9CA3AF !important; /* Gray default with !important */
					cursor: pointer;
					font-size: 11px;
					line-height: 1.2; /* 添加固定行高 */
					transition: color 0.2s ease;
					outline: none !important;
					box-shadow: none !important;
					white-space: nowrap; /* 防止文字换行 */
				}

				.model-selector-button:hover {
					color: #1F2937 !important; /* Darker black on hover */
					background: transparent !important;
					border: none !important;
					outline: none !important;
					box-shadow: none !important;
				}

				.theme-dark .model-selector-button {
					color: #6B7280 !important; /* Lighter gray for dark theme with !important */
				}

				.theme-dark .model-selector-button:hover {
					color: #F9FAFB !important; /* Light color on hover in dark theme */
				}

				.model-dropdown-arrow {
					font-size: 10px;
					margin-left: 4px;
				}

				.model-dropdown-menu {
					position: absolute;
					bottom: 100%;
					left: 0;
					min-width: 160px;
					max-width: 300px;
					width: max-content;
					background: var(--background-primary);
					border: 1px solid var(--background-modifier-border);
					border-radius: 6px;
					box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.15);
					z-index: 1000;
					margin-bottom: 4px;
					max-height: 200px;
					overflow-y: auto;
					/* 确保不影响父容器布局 */
					transform: translateZ(0); /* 创建新的stacking context */
				}

				.model-dropdown-option {
					padding: 8px 12px;
					cursor: pointer;
					font-size: 11px;
					color: var(--text-normal);
					transition: background-color 0.2s ease;
				}

				.model-dropdown-option:hover {
					background: var(--background-modifier-hover);
				}

				.model-dropdown-option.selected {
					background: var(--interactive-accent);
					color: var(--text-on-accent);
				}

				.model-option-content {
					display: flex;
					align-items: center;
					gap: 6px;
					width: 100%;
				}

				.model-option-content .model-name {
					font-size: 11px;
					color: inherit;
					flex: 1;
				}

				.vision-icon {
					color: #8b5cf6;
					display: inline-flex;
					align-items: center;
					flex-shrink: 0;
				}

				.vision-icon svg {
					width: 12px;
					height: 12px;
					stroke: #8b5cf6;
				}

				/* Specific styles for vision icons in dropdown options */
				.model-dropdown-option .vision-icon {
					color: #8b5cf6;
					display: inline-flex;
					align-items: center;
					flex-shrink: 0;
				}

				.model-dropdown-option .vision-icon svg {
					width: 12px;
					height: 12px;
					stroke: #8b5cf6;
				}

				/* Ensure model name in selector button maintains button color */
				.model-selector-button .model-name {
					color: inherit;
					font-size: inherit;
				}

				.model-dropdown-option:first-child {
					border-radius: 6px 6px 0 0;
				}

				.model-dropdown-option:last-child {
					border-radius: 0 0 6px 6px;
				}

				/* Mode selector styles (match model selector) */
				.mode-selector-wrapper {
					position: relative;
					height: 32px;
					overflow: visible;
				}

				.mode-selector-button {
					display: flex;
					align-items: center;
					justify-content: flex-start;
					gap: 4px;
					padding: 4px 8px;
					background: transparent !important;
					border: none !important;
					border-radius: 4px;
					color: #9CA3AF !important;
					cursor: pointer;
					font-size: 11px;
					line-height: 1.2;
					transition: color 0.2s ease;
					outline: none !important;
					box-shadow: none !important;
					white-space: nowrap;
				}

				.mode-selector-button:hover {
					color: #1F2937 !important;
					background: transparent !important;
					border: none !important;
					outline: none !important;
					box-shadow: none !important;
				}

				.theme-dark .mode-selector-button {
					color: #6B7280 !important;
				}

				.theme-dark .mode-selector-button:hover {
					color: #F9FAFB !important;
				}

				.mode-dropdown-arrow {
					font-size: 10px;
					margin-left: 4px;
				}

				.mode-dropdown-menu {
					position: absolute;
					bottom: 100%;
					left: 0;
					min-width: 120px;
					max-width: 200px;
					width: max-content;
					background: var(--background-primary);
					border: 1px solid var(--background-modifier-border);
					border-radius: 6px;
					box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.15);
					z-index: 1000;
					margin-bottom: 4px;
					max-height: 200px;
					overflow-y: auto;
					transform: translateZ(0);
				}

				.mode-dropdown-option {
					padding: 8px 12px;
					cursor: pointer;
					font-size: 11px;
					color: var(--text-normal);
					transition: background-color 0.2s ease;
				}

				.mode-dropdown-option:hover {
					background: var(--background-modifier-hover);
				}

				.mode-dropdown-option.selected {
					background: var(--interactive-accent);
					color: var(--text-on-accent);
				}

				.mode-option-content {
					display: flex;
					align-items: center;
					gap: 6px;
					width: 100%;
				}

				.mode-option-content .mode-name {
					font-size: 11px;
					color: inherit;
					flex: 1;
				}

				.mode-selector-button .mode-name {
					color: inherit;
					font-size: inherit;
				}

				.mode-dropdown-option:first-child {
					border-radius: 6px 6px 0 0;
				}

				.mode-dropdown-option:last-child {
					border-radius: 0 0 6px 6px;
				}

				.no-models-indicator {
					font-size: 13px;
					color: var(--text-warning);
					padding: 6px 12px;
					background: transparent !important;
					border: none !important;
					border-radius: 4px;
					outline: none !important;
					box-shadow: none !important;
				}

				.ai-chat-input-drag-active .ai-chat-drop-zone {
					border-color: var(--interactive-accent) !important;
					background: var(--background-modifier-border) !important;
					transform: scale(1.02);
				}

				.ai-chat-image-preview-area {
					margin-bottom: 8px;
					padding: 8px;
					background: var(--background-secondary);
					border-radius: 6px;
					border: 1px solid var(--background-modifier-border);
				}

				.images-preview-container {
					display: flex;
					flex-direction: column;
					gap: 8px;
				}

				.preview-header {
					display: flex;
					justify-content: space-between;
					align-items: center;
					padding-bottom: 6px;
					border-bottom: 1px solid var(--background-modifier-border);
				}

				.preview-count {
					font-size: 12px;
					color: var(--text-normal);
					font-weight: 500;
				}

				.preview-count.non-vision-warning {
					color: var(--text-warning);
					font-weight: 600;
				}

				.images-grid {
					display: grid;
					grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
					gap: 8px;
					max-height: 200px;
					overflow-y: auto;
				}

				.preview-image-item {
					position: relative;
					border-radius: 4px;
					overflow: hidden;
					border: 1px solid var(--background-modifier-border);
					cursor: pointer;
				}

				.preview-image-thumb {
					width: 100%;
					height: 80px;
					object-fit: cover;
					display: block;
					cursor: pointer;
					transition: opacity 0.2s ease;
				}

				.preview-image-thumb:hover {
					opacity: 0.8;
				}

				.image-info-overlay {
					position: absolute;
					bottom: 0;
					left: 0;
					right: 0;
					background: linear-gradient(transparent, rgba(0,0,0,0.8));
					color: white;
					padding: 4px 6px;
					display: flex;
					justify-content: space-between;
					align-items: center;
					opacity: 0;
					transition: opacity 0.2s;
				}

				.preview-image-item:hover .image-info-overlay {
					opacity: 1;
				}

				.image-filename-overlay {
					font-size: 10px;
					white-space: nowrap;
					overflow: hidden;
					text-overflow: ellipsis;
					flex: 1;
				}

				.remove-single-image-btn {
					width: 24px;
					height: 24px;
					border-radius: 50%;
					border: 1px solid #9CA3AF; /* Gray border to match other buttons */
					background: transparent !important;
					color: #9CA3AF !important; /* Gray color to match border */
					cursor: pointer;
					display: flex;
					align-items: center;
					justify-content: center;
					position: absolute;
					top: 4px;
					right: 4px;
					z-index: 10;
					transition: all 0.2s ease;
					outline: none;
					box-shadow: none;
					font-size: 16px; /* Larger size for better visibility */
					font-weight: normal; /* Let the symbol speak for itself */
					line-height: 1;
					font-family: Arial, sans-serif;
					padding: 0;
					margin: 0;
					text-align: center;
					vertical-align: middle;
				}

				.remove-single-image-btn:hover {
					background: transparent !important;
					color: #1F2937 !important; /* Dark color on hover to match other buttons */
					border-color: #1F2937 !important; /* Dark border on hover to match text */
				}

				.remove-single-image-btn:focus {
					outline: none !important;
					box-shadow: none !important;
				}

				.image-preview-container {
					display: flex;
					align-items: center;
					gap: 12px;
				}

				.preview-image {
					width: 80px;
					height: 80px;
					object-fit: cover;
					border-radius: 4px;
					border: 1px solid var(--background-modifier-border);
				}

				.image-preview-info {
					flex: 1;
					display: flex;
					justify-content: space-between;
					align-items: center;
				}

				.image-filename {
					font-size: 12px;
					color: var(--text-normal);
					font-weight: 500;
				}

				.remove-image-btn {
					width: 20px;
					height: 20px;
					border-radius: 50%;
					border: none;
					background: var(--interactive-critical);
					color: white;
					cursor: pointer;
					font-size: 14px;
					display: flex;
					align-items: center;
					justify-content: center;
					line-height: 1;
				}

				.remove-image-btn:hover {
					background: var(--interactive-critical-hover);
				}

				.ai-chat-input {
					flex: 1;
					resize: none;
					border: 1px solid var(--background-modifier-border);
					border-radius: 4px;
					padding: 8px;
					background: var(--background-primary);
					color: var(--text-normal);
					font-family: inherit;
				}

				.ai-chat-send-button {
					padding: 12px 20px;
					background: #4A9EFF;
					color: white;
					border: none;
					border-radius: 6px;
					cursor: pointer;
					font-size: 14px;
					font-weight: 500;
					white-space: nowrap;
					align-self: center;
					transition: background-color 0.2s;
				}

				.ai-chat-send-button:hover:not(:disabled) {
					background: #3B8BFF;
				}

				.ai-chat-send-button:disabled {
					background: #A0A0A0;
					color: white;
					cursor: not-allowed;
				}

				.ai-chat-message-content {
					user-select: text;
					-webkit-user-select: text;
					-moz-user-select: text;
					-ms-user-select: text;
					word-wrap: break-word;
					overflow-wrap: break-word;
					word-break: break-word;
					white-space: pre-wrap;
					max-width: 100%;
					overflow-x: hidden;
				}

				/* Improve text selection visibility */
				.ai-chat-message-content ::selection {
					background: rgba(0, 123, 255, 0.3);
					color: var(--text-normal);
				}

				.ai-chat-message-content ::-moz-selection {
					background: rgba(0, 123, 255, 0.3);
					color: var(--text-normal);
				}

				/* Special selection for user messages with accent background */
				.ai-chat-message-user .ai-chat-message-content ::selection {
					background: rgba(255, 255, 255, 0.4);
					color: var(--text-on-accent);
				}

				.ai-chat-message-user .ai-chat-message-content ::-moz-selection {
					background: rgba(255, 255, 255, 0.4);
					color: var(--text-on-accent);
				}

				/* Thinking blocks styling */
				.ai-thinking-block {
					margin: 12px 0;
					border: 1px solid var(--background-modifier-border);
					border-radius: 8px;
					background: var(--background-secondary);
					overflow: hidden;
					transition: all 0.2s ease;
				}

				.ai-thinking-block.collapsed {
					background: var(--background-primary);
				}

				.ai-thinking-header {
					display: flex;
					align-items: center;
					gap: 8px;
					padding: 10px 12px;
					background: var(--background-modifier-border);
					cursor: pointer;
					user-select: none;
					transition: background-color 0.2s ease;
					border-bottom: 1px solid var(--background-modifier-border);
				}

				.ai-thinking-header:hover {
					background: var(--background-modifier-hover);
				}

				.ai-thinking-toggle {
					display: flex;
					align-items: center;
					justify-content: center;
					color: var(--text-muted);
					transition: transform 0.2s ease, color 0.2s ease;
					flex-shrink: 0;
					width: 20px;
					height: 20px;
				}

				.ai-thinking-toggle:hover {
					color: var(--text-normal);
				}

				.ai-thinking-block.collapsed .ai-thinking-toggle {
					transform: rotate(0deg);
				}

				.ai-thinking-label {
					font-size: 13px;
					font-weight: 600;
					color: var(--text-normal);
					text-transform: uppercase;
					letter-spacing: 0.5px;
				}

				.ai-thinking-content {
					padding: 12px;
					border-top: none;
					background: var(--background-secondary);
					font-size: 14px;
					line-height: 1.5;
				}

				.ai-thinking-text {
					margin: 0 0 8px 0;
					color: var(--text-muted);
					font-style: normal;
				}

				.ai-thinking-text:last-child {
					margin-bottom: 0;
				}

				.ai-thinking-text strong {
					color: var(--text-normal);
					font-weight: 600;
				}

				.ai-thinking-text em {
					color: var(--text-accent);
				}

				/* Markdown rendering with extremely compact spacing */
				.markdown-rendered p {
					margin: 0.1em 0 !important;
					line-height: 1.3 !important;
				}
				
				.markdown-rendered h1 { 
					margin: 0.3em 0 0.05em 0 !important;
					line-height: 1.1 !important;
					font-size: 1.4em !important;
				}
				
				.markdown-rendered h2 { 
					margin: 0.25em 0 0.05em 0 !important;
					line-height: 1.1 !important;
					font-size: 1.25em !important;
				}
				
				.markdown-rendered h3 { 
					margin: 0.2em 0 0.03em 0 !important;
					line-height: 1.1 !important;
					font-size: 1.15em !important;
				}
				
				.markdown-rendered h4,
				.markdown-rendered h5,
				.markdown-rendered h6 {
					margin: 0.15em 0 0.03em 0 !important;
					line-height: 1.1 !important;
					font-size: 1.05em !important;
				}
				
				/* Extremely compact lists */
				.markdown-rendered ul,
				.markdown-rendered ol {
					margin: 0.1em 0 !important;
					padding-left: 1.5em !important; /* Increased to prevent bullet cutoff */
					margin-left: 0 !important;
				}
				
				.markdown-rendered li {
					margin: 0 !important;
					padding: 0 !important;
					line-height: 1.3 !important;
					list-style-position: outside !important; /* Ensure bullets are outside */
				}
				
				.markdown-rendered li p {
					margin: 0 !important;
					padding: 0 !important;
				}
				
				/* Nested lists even more compact */
				.markdown-rendered li ul,
				.markdown-rendered li ol {
					margin: 0 !important;
					padding-left: 1.2em !important; /* Slightly less for nested */
				}
				
				.markdown-rendered blockquote {
					margin: 0.1em 0 !important;
					padding: 0.2em 0.6em !important;
				}
				
				.markdown-rendered pre {
					margin: 0.1em 0 !important;
					padding: 0.3em !important;
				}
				
				.markdown-rendered hr {
					margin: 0.2em 0 !important;
				}
				
				.markdown-rendered table {
					margin: 0.1em 0 !important;
				}
				
				/* Compact LaTeX formulas */
				.markdown-rendered .math-block,
				.markdown-rendered .math {
					margin: 0.1em 0 !important;
					line-height: 1.2 !important;
				}
				
				.markdown-rendered mjx-container {
					margin: 0.05em 0 !important;
				}
				
				.markdown-rendered mjx-container[display="block"] {
					margin: 0.15em 0 !important;
				}
				
				/* Remove extra spacing from math elements */
				.markdown-rendered .MathJax {
					margin: 0 !important;
				}
				
				.markdown-rendered .MathJax_Display {
					margin: 0.1em 0 !important;
				}

				.ai-chat-thinking-text code {
					background: var(--background-primary);
					padding: 2px 4px;
					border-radius: 3px;
					font-family: var(--font-monospace);
					font-size: 0.9em;
					color: var(--text-normal);
				}

				/* Message editing styles */
				.message-edit-textarea {
					width: 100%;
					border: 1px solid var(--background-modifier-border);
					border-radius: 4px;
					padding: 8px;
					background: var(--background-primary);
					color: var(--text-normal);
					font-family: inherit;
					font-size: 14px;
					line-height: 1.5;
					resize: vertical;
					min-height: 100px;
					outline: none;
				}

				.message-edit-textarea:focus {
					border-color: var(--interactive-accent);
					box-shadow: 0 0 0 2px rgba(var(--interactive-accent-rgb), 0.2);
				}

				.ai-chat-message.editing-mode {
					background: var(--background-primary);
					border-color: var(--interactive-accent);
				}

				.ai-chat-message.editing-mode .ai-chat-message-content {
					margin: 4px 0;
				}
			`;
			document.head.appendChild(style);
		}
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
		if (dropZone && (dropZone as any)._dragCleanup) {
			(dropZone as any)._dragCleanup();
		}
	}

	private cleanupEventListeners(): void {
		const container = this.containerEl.children[1] as HTMLElement;
		if (container) {
			const prevHandler = (container as any)._prevClickOutsideHandler;
			if (prevHandler) {
				document.removeEventListener('click', prevHandler);
				(container as any)._prevClickOutsideHandler = null;
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
			console.error('Periodic auto-save failed:', error);
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
			console.error('Final auto-save failed:', error);
		}
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

			// Use conversation ID for consistent filename - this will overwrite the same file
			const conversationIdShort = conversation.id.slice(-8); // Last 8 chars of conversation ID
			const fileName = `auto-saved-${conversationIdShort}.md`;

			// Generate markdown content first to check for changes
			const markdownContent = this.generateConversationMarkdown(conversation);
			
			// Check if content has changed since last save
			if (this.lastAutoSaveContent && this.lastAutoSaveContent === markdownContent) {
				getLogger().log('Auto-save skipped: No content changes detected for conversation', conversationIdShort);
				return;
			}

			getLogger().log('Auto-save proceeding: Content changes detected for conversation', conversationIdShort, 
				'(previous content length:', this.lastAutoSaveContent?.length || 0, 
				', new content length:', markdownContent.length, ')');

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
			if (existingFile) {
				// File exists, modify it to avoid closing it if it's open
				await vault.modify(existingFile as any, markdownContent);
			} else {
				// File doesn't exist, create it
				await vault.create(fullPath, markdownContent);
			}

			// Update the last saved content after successful save
			this.lastAutoSaveContent = markdownContent;

			// Clean up old auto-saved conversations to enforce limit
			await this.cleanupOldAutoSavedConversations();

			getLogger().log('Auto-saved conversation to:', fullPath);

		} catch (error: any) {
			console.error('Failed to auto-save conversation with timestamp:', error);
		}
	}

	private async saveConversation(): Promise<void> {
		try {
			const conversation = this.aiManager.getCurrentConversationData();
			if (!conversation || conversation.messages.length === 0) {
				new Notice('❌ No conversation to save');
				return;
			}

			// Generate or use existing conversation ID
			const conversationId = conversation.id.startsWith('loaded_') ? 
				this.generateConversationId(conversation) : conversation.id;

			// Generate markdown content
			const markdownContent = this.generateConversationMarkdown(conversation);

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

		} catch (error: any) {
			console.error('Failed to save conversation:', error);
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
			console.error('Failed to search for existing conversation file:', error);
			return null;
		}
	}

	/**
	 * Sanitize filename by removing or replacing invalid characters
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

			// Get all auto-saved conversation files
			const autoSaveFolder = vault.getAbstractFileByPath(autoSaveLocation);
			if (!autoSaveFolder) return;

			const files = vault.getMarkdownFiles().filter(file => 
				file.path.startsWith(autoSaveLocation) && 
				file.name.startsWith('auto-saved-')
			);

			// Sort by modification time (newest first)
			files.sort((a, b) => b.stat.mtime - a.stat.mtime);

			// Delete excess files
			if (files.length > maxConversations) {
				const filesToDelete = files.slice(maxConversations);
				for (const file of filesToDelete) {
					await vault.delete(file);
					getLogger().log('Deleted old auto-saved conversation:', file.path);
				}
			}
		} catch (error: any) {
			console.error('Failed to cleanup old auto-saved conversations:', error);
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

	private generateConversationMarkdown(conversation: AIConversation): string {
		// Generate or use existing conversation ID
		const conversationId = conversation.id.startsWith('loaded_') ? 
			this.generateConversationId(conversation) : conversation.id;
			
		// Format title similar to BestNote style
		let markdown = ``;
		
		// Properties section (similar to BestNote)
		markdown += `---
conversationID: ${conversationId}
model: ${this.plugin.settings.defaultModelConfigId || 'default'}
tags:
  - ai-conversation
---`;
		markdown += `\n`
		// Generate messages in BestNote style
		conversation.messages.forEach((message, index) => {
			const messageType = message.type === 'user' ? 'user' : 'ai';
			const timestamp = message.timestamp.toISOString().replace('T', ' ').split('.')[0].replace(/-/g, '/');
			
			// Message header with BestNote format
			markdown += `${messageType}: \n`;
			
			// Add text content first if present
			if (message.content) {
				markdown += message.content + '\n';
			}

			// Add image content if present - inline with content
			if (message.image) {
				const allImages = (message as any).images;
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
						markdown += `![${fileName}](${imagePath})\n`;
					});
				} else {
					// Single image - check for local path in multiple places
					const singleImageData = (message as any).imageData;
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
					else if (singleImageData && singleImageData.localPath) {
						const formattedPath = this.formatImagePath(singleImageData.localPath);
						if (formattedPath) {
							imagePath = formattedPath;
						}
					}
					// Priority 3: Check if the message itself has localPath metadata
					else if ((message as any).localPath) {
						const formattedPath = this.formatImagePath((message as any).localPath);
						if (formattedPath) {
							imagePath = formattedPath;
						}
					}
					
					markdown += `![Screenshot](${imagePath})\n`;
				}
			}
			
			// If this is not the last message, add timestamp and spacing
			if (index < conversation.messages.length - 1) {
				markdown += `[Timestamp: ${timestamp}]\n\n`;
			}
		});
		
		// Add final timestamp for the last message
		if (conversation.messages.length > 0) {
			const lastMessage = conversation.messages[conversation.messages.length - 1];
			const lastTimestamp = lastMessage.timestamp.toISOString().replace('T', ' ').split('.')[0].replace(/-/g, '/');
			markdown += `[Timestamp: ${lastTimestamp}]\n`;
		}
		
		return markdown;
	}

	private async showHistoryModal(): Promise<void> {
		try {
			const modal = new ChatHistoryModal(this.plugin, async (conversation: AIConversation) => {
				await this.loadConversationIntoChat(conversation);
			});
			modal.open();
		} catch (error: any) {
			console.error('Failed to show history modal:', error);
			new Notice(`❌ Failed to open history: ${error.message}`);
		}
	}

	private async loadImageDataFromPath(localPath: string): Promise<string | null> {
		try {
			const vault = this.plugin.app.vault;
			const file = vault.getAbstractFileByPath(localPath);
			
			if (!file) {
				console.warn(`Image file not found: ${localPath}`);
				return null;
			}
			
			const buffer = await vault.readBinary(file as any);
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
			console.error(`Failed to load image data from path ${localPath}:`, error);
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
						console.warn(`⚠️ Could not restore dataUrl for image: ${imageData.localPath}`);
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
				console.warn(`⚠️ Could not restore dataUrl for single image: ${message.imageData.localPath}`);
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
				console.warn(`⚠️ Could not restore dataUrl for message image: ${message.image}`);
			}
		}
	}

	private async loadConversationIntoChat(conversation: AIConversation): Promise<void> {
		try {
			// Create a new conversation in the AI manager based on the loaded one
			const newConversation = this.aiManager.createNewConversation(conversation.title);
			
			// Copy all messages from the loaded conversation
			for (const message of conversation.messages) {
				const newMessage: AIMessage = {
					id: 'loaded_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
					type: message.type,
					content: message.content, // Markdown content includes image references
					timestamp: new Date() // Use current time for loaded messages
				};
				
				// Preserve image data if it exists
				if ((message as any).image) {
					(newMessage as any).image = (message as any).image;
				}
				if ((message as any).imageData) {
					(newMessage as any).imageData = (message as any).imageData;
				}
				if ((message as any).images) {
					(newMessage as any).images = (message as any).images;
				}
				
				newConversation.messages.push(newMessage);
			}

			// Update the chat view to show the loaded conversation
			await this.updateContent();
			
			// Reset last saved content for loaded conversation to allow initial auto-save
			this.lastAutoSaveContent = null;
			
			new Notice(`✅ Loaded conversation: ${conversation.title}`);
		} catch (error: any) {
			console.error('Failed to load conversation:', error);
			new Notice(`❌ Failed to load conversation: ${error.message}`);
		}
	}

	private updateSelectorButtonContent(button: HTMLButtonElement, modelConfig: any) {
		// Clear existing content (except dropdown arrow)
		const dropdownArrow = button.querySelector('.model-dropdown-arrow');
		button.innerHTML = '';
		
		// Add model name
		const modelName = button.createEl('span', { text: modelConfig.name, cls: 'model-name' });
		
		// Add vision icon if applicable (smaller size for selector button)
		if (modelConfig.isVisionCapable) {
			const visionIcon = button.createEl('span', { cls: 'vision-icon' });
			visionIcon.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
		}
		
		// Re-add dropdown arrow
		if (dropdownArrow) {
			button.appendChild(dropdownArrow);
		}
	}

	private refreshModelDependentComponents() {
		// Update send button state based on model configuration
		const updateSendButtonState = (this as any)._updateSendButtonState;
		if (updateSendButtonState) {
			updateSendButtonState();
		}

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

		// Refresh other AI chat views (not the current one)
		const aiChatLeaves = this.plugin.app.workspace.getLeavesOfType('ai-chat');
		aiChatLeaves.forEach(leaf => {
			const view = leaf.view as any;
			if (view && view !== this && typeof view.updateContent === 'function') {
				view.updateContent();
			}
		});
	}

	getCurrentMode(): import('../types').AIChatMode {
		return this.currentMode;
	}

	private checkAndResetAutoSaveTracking(): void {
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

		// Generate current conversation markdown to compare with last saved content
		const currentMarkdownContent = this.generateConversationMarkdown(conversation);
		
		// If content has changed, reset the tracking so next auto-save will proceed
		if (this.lastAutoSaveContent !== currentMarkdownContent) {
			getLogger().log('Conversation content changed, resetting auto-save tracking');
			this.lastAutoSaveContent = null;
		}
	}

	private updateModeSelectorButtonContent(button: HTMLButtonElement, modeData: any) {
		// Clear existing content (except dropdown arrow)
		const dropdownArrow = button.querySelector('.mode-dropdown-arrow');
		button.innerHTML = '';
		
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
				editBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2-2v-7"/><path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
				editBtn.setAttribute('data-tooltip', t('aiChat.switchEditViewButton'));
				
				messageContent.removeClass('editing-mode');
			}
		} else {
			// Switch from read to edit mode - use message.content directly (it's already markdown)
			this.renderMessageContentAsEditor(messageContent, message.content || '');
			
			// Update button icon to view icon
			editBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
			editBtn.setAttribute('data-tooltip', 'Switch to Read View');
			
			messageContent.addClass('editing-mode');
		}
	}

	/**
	 * Render message content from markdown (parse images and text)
	 */
	private async renderMessageContentFromMarkdown(container: HTMLElement, message: AIMessage): Promise<void> {
		container.empty();
		
		if (!message.content) return;
		
		// Parse markdown content to extract images and text
		const { textContent, imageReferences } = this.parseMarkdownContent(message.content);
		
		// Render images first
		if (imageReferences.length > 0) {
			if (imageReferences.length === 1) {
				// Single image
				const imageRef = imageReferences[0];
				await this.renderSingleImage(container, imageRef);
			} else {
				// Multiple images in a grid
				const imagesContainer = container.createEl('div', { cls: 'ai-chat-message-images-grid' });
				for (const imageRef of imageReferences) {
					const imageWrapper = imagesContainer.createEl('div', { cls: 'ai-chat-message-image-wrapper' });
					await this.renderSingleImage(imageWrapper, imageRef);
				}
			}
		}
		
		// Render text content if present
		if (textContent.trim()) {
			const textEl = container.createEl('div', { cls: 'ai-chat-message-text' });
			await this.renderMarkdown(textEl, textContent);
		}
	}

	/**
	 * Parse markdown content to separate images and text
	 */
	private parseMarkdownContent(markdown: string): { textContent: string; imageReferences: Array<{ alt: string; path: string; fileName: string }> } {
		const imageRegex = /!\[(.*?)\]\((.*?)\)/g;
		const imageReferences: Array<{ alt: string; path: string; fileName: string }> = [];
		let textContent = markdown;
		
		// Extract all image references
		let match;
		while ((match = imageRegex.exec(markdown)) !== null) {
			const alt = match[1] || 'Image';
			const path = match[2];
			const fileName = path.split('/').pop() || alt;
			
			imageReferences.push({
				alt: alt,
				path: path,
				fileName: fileName
			});
			
			// Remove the image markdown from text content
			textContent = textContent.replace(match[0], '').trim();
		}
		
		// Clean up extra whitespace
		textContent = textContent.replace(/\n\s*\n/g, '\n\n').trim();
		
		return { textContent, imageReferences };
	}

	/**
	 * Render a single image from path reference
	 */
	private async renderSingleImage(container: HTMLElement, imageRef: { alt: string; path: string; fileName: string }): Promise<void> {
		const { alt, path, fileName } = imageRef;
		
		// Try to get vault resource URL first, fallback to direct path
		let imageSrc = this.getVaultResourceUrl(path) || path;
		
		// If that fails, try to load as data URL
		if (!imageSrc.startsWith('app://') && !imageSrc.startsWith('data:')) {
			const dataUrl = await this.loadImageDataFromPath(path);
			if (dataUrl) {
				imageSrc = dataUrl;
			}
		}
		
		const imageEl = container.createEl('img', { 
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
		
		// Add filename label if in grid
		if (container.hasClass('ai-chat-message-image-wrapper')) {
			const fileNameEl = container.createEl('div', { 
				cls: 'ai-chat-message-image-filename',
				text: fileName
			});
		}
	}

	/**
	 * Render message content as editable textarea
	 */
	private renderMessageContentAsEditor(container: HTMLElement, content: string): void {
		container.empty();
		
		const textarea = container.createEl('textarea', {
			cls: 'message-edit-textarea',
			attr: { placeholder: 'Edit message content...' }
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
	 * Render message content as markdown (read mode)
	 */
	private async renderMessageContentAsMarkdown(container: HTMLElement, content: string): Promise<void> {
		container.empty();
		
		if (content) {
			const textEl = container.createEl('div', { cls: 'ai-chat-message-text' });
			await this.renderMarkdown(textEl, content);
		}
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
				
				// Update conversation title if this affects the title
				this.aiManager.updateConversationTitle(conversation.id);
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
				new Notice('请在markdown笔记中打开光标位置再使用此功能');
				return;
			}

			// Get the content to insert
			let contentToInsert = '';
			
			// Handle images first
			if (message.image) {
				const allImages = (message as any).images;
				if (allImages && allImages.length > 1) {
					// Multiple images
					allImages.forEach((imageData: any, index: number) => {
						const fileName = imageData.fileName || `image-${index + 1}`;
						let imagePath = imageData.dataUrl; // fallback
						if (imageData.localPath) {
							const formattedPath = this.formatImagePath(imageData.localPath);
							if (formattedPath) {
								imagePath = formattedPath;
							}
						}
						contentToInsert += `![${fileName}](${imagePath})\n\n`;
					});
				} else {
					// Single image
					const singleImageData = (message as any).imageData;
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
					else if (singleImageData && singleImageData.localPath) {
						const formattedPath = this.formatImagePath(singleImageData.localPath);
						if (formattedPath) {
							imagePath = formattedPath;
						}
					}
					
					contentToInsert += `![Screenshot](${imagePath})\n\n`;
				}
			}

			// Add text content
			if (message.content) {
				contentToInsert += message.content;
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

			new Notice('Content inserted at cursor');
			
		} catch (error) {
			console.error('Failed to insert content at cursor:', error);
			new Notice('Failed to insert content');
		}
	}

	/**
	 * Delete a message from the conversation
	 */
	private async deleteMessage(messageId: string): Promise<void> {
		try {
			const conversation = this.aiManager.getCurrentConversationData();
			if (!conversation) {
				new Notice('No active conversation');
				return;
			}

			// Find message index
			const messageIndex = conversation.messages.findIndex(m => m.id === messageId);
			if (messageIndex === -1) {
				new Notice('Message not found');
				return;
			}

			// Show custom confirmation modal
			const message = conversation.messages[messageIndex];
			const confirmed = await this.showDeleteConfirmation(message);
			
			if (confirmed) {
				// Remove message from conversation
				conversation.messages.splice(messageIndex, 1);
				conversation.lastUpdated = new Date();
				
				// Update conversation title after deletion
				this.aiManager.updateConversationTitle(conversation.id);
				
				// Refresh the view
				await this.updateContent();
				
				new Notice('Message deleted');
			}
			
		} catch (error) {
			console.error('Failed to delete message:', error);
			new Notice('Failed to delete message');
		}
	}

	/**
	 * Show custom delete confirmation modal
	 */
	private showDeleteConfirmation(message: AIMessage): Promise<boolean> {
		return new Promise((resolve) => {
			const modal = new Modal(this.app);
			
			// Set modal styles
			modal.contentEl.style.cssText = `
				width: 400px;
				padding: 20px;
				text-align: center;
			`;
			
			// Title
			const title = modal.contentEl.createEl('h3', { 
				text: 'Delete Message',
				cls: 'modal-title'
			});
			title.style.cssText = `
				margin: 0 0 16px 0;
				color: var(--text-normal);
				font-size: 18px;
				font-weight: 600;
			`;
			
			// Message preview
			const isUserMessage = message.type === 'user';
			const messagePreview = (message.content || 'Image message').substring(0, 100);
			const truncated = messagePreview.length < (message.content || '').length;
			
			const description = modal.contentEl.createEl('p', {
				text: `Are you sure you want to delete this ${isUserMessage ? 'user' : 'AI'} message?`
			});
			description.style.cssText = `
				margin: 0 0 12px 0;
				color: var(--text-normal);
				font-size: 14px;
				line-height: 1.4;
			`;
			
			const preview = modal.contentEl.createEl('div', {
				text: `"${messagePreview}${truncated ? '...' : ''}"`,
			});
			preview.style.cssText = `
				background: var(--background-secondary);
				border: 1px solid var(--background-modifier-border);
				border-radius: 4px;
				padding: 12px;
				margin: 0 0 20px 0;
				font-size: 13px;
				color: var(--text-muted);
				font-style: italic;
				max-height: 80px;
				overflow-y: auto;
				text-align: left;
			`;
			
			// Button container
			const buttonContainer = modal.contentEl.createEl('div');
			buttonContainer.style.cssText = `
				display: flex;
				justify-content: center;
				gap: 12px;
				margin-top: 20px;
			`;
			
			// Cancel button
			const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
			cancelBtn.style.cssText = `
				padding: 8px 16px;
				border: 1px solid var(--background-modifier-border);
				background: var(--background-primary);
				color: var(--text-normal);
				border-radius: 4px;
				cursor: pointer;
				font-size: 14px;
				transition: all 0.2s ease;
				min-width: 80px;
			`;
			
			// Delete button
			const deleteBtn = buttonContainer.createEl('button', { text: 'Delete' });
			deleteBtn.style.cssText = `
				padding: 8px 16px;
				border: 1px solid var(--color-red);
				background: var(--color-red);
				color: white;
				border-radius: 4px;
				cursor: pointer;
				font-size: 14px;
				transition: all 0.2s ease;
				min-width: 80px;
			`;
			
			// Hover effects
			cancelBtn.addEventListener('mouseenter', () => {
				cancelBtn.style.background = 'var(--background-modifier-hover)';
			});
			cancelBtn.addEventListener('mouseleave', () => {
				cancelBtn.style.background = 'var(--background-primary)';
			});
			
			deleteBtn.addEventListener('mouseenter', () => {
				deleteBtn.style.background = '#dc2626';
			});
			deleteBtn.addEventListener('mouseleave', () => {
				deleteBtn.style.background = 'var(--color-red)';
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
}