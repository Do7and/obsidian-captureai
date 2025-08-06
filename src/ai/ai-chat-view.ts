import { ItemView, WorkspaceLeaf, TFile, Notice } from 'obsidian';
import ImageCapturePlugin from '../main';
import { AIManager, AIMessage, AIConversation } from './ai-manager';
import { ChatHistoryModal } from '../ui/chat-history-modal';
import { t } from '../i18n';
import { getLogger } from '../utils/logger';

export const AI_CHAT_VIEW_TYPE = 'ai-chat';

export class AIChatView extends ItemView {
	private plugin: ImageCapturePlugin;
	private aiManager: AIManager;
	
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
		this.updateContent();
	}

	updateContent(): void {
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
			this.fullRender(container);
		} else {
			// Partial update - only update model selector and chat area
			this.partialUpdate(container);
		}
	}

	private fullRender(container: HTMLElement): void {
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
			this.renderConversation(chatArea, conversation);
			
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

	private partialUpdate(container: HTMLElement): void {
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
				this.renderConversation(chatArea, conversation);
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
		this.updateContent();
	}

	private async sendTextMessage(message: string): Promise<void> {
		try {
			// Create or get current conversation
			let conversation = this.aiManager.getCurrentConversationData();
			if (!conversation) {
				// Create a new text-only conversation
				conversation = this.aiManager.createNewConversation('Text Chat');
			}

			// Add user message
			const userMessage = {
				id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
				type: 'user' as const,
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
			this.updateContent();

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
				this.updateContent();
			}
		}
	}

	private async callAIForText(message: string, conversation: AIConversation): Promise<string> {
		// Use the new context-aware API for text-only conversations
		return await this.aiManager.callAIWithContext(conversation, message);
	}

	private renderConversation(container: HTMLElement, conversation: AIConversation): void {
		const messagesContainer = container.createEl('div', { cls: 'ai-chat-messages' });

		conversation.messages.forEach(message => {
			this.renderMessage(messagesContainer, message);
		});

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

	private renderMessage(container: HTMLElement, message: AIMessage): void {
		const messageEl = container.createEl('div', { 
			cls: `ai-chat-message ai-chat-message-${message.type}` 
		});

		// Message header with timestamp and copy button
		const messageHeader = messageEl.createEl('div', { cls: 'ai-chat-message-header' });
		messageHeader.createEl('span', { 
			text: message.type === 'user' ? 'You' : 'AI Assistant',
			cls: 'ai-chat-message-sender'
		});
		
		const headerRight = messageHeader.createEl('div', { cls: 'ai-chat-message-header-right' });
		headerRight.createEl('span', { 
			text: this.formatTime(message.timestamp),
			cls: 'ai-chat-message-time'
		});

		// Message content with text selection support
		const messageContent = messageEl.createEl('div', { 
			cls: 'ai-chat-message-content',
			attr: { 'data-message-id': message.id }
		});

		// Enable text selection for the entire message area
		messageEl.addEventListener('keydown', (e) => {
			if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
				this.handleKeyboardCopy(e, message);
			}
		});
		messageEl.setAttribute('tabindex', '0'); // Make it focusable for keyboard events

		// Show image if present
		if (message.image) {
			// Check if there are multiple images
			const allImages = (message as any).images;
			if (allImages && allImages.length > 1) {
				// Display all images in a grid
				const imagesContainer = messageContent.createEl('div', { cls: 'ai-chat-message-images-grid' });
				
				allImages.forEach((imageData: any, index: number) => {
					const imageWrapper = imagesContainer.createEl('div', { cls: 'ai-chat-message-image-wrapper' });
					
					// Use dataUrl for display in chat, as local paths need special handling in Obsidian
					let imageSrc = imageData.dataUrl;
					if (!imageSrc && imageData.localPath) {
						// If no dataUrl available, try to get vault resource URL
						imageSrc = this.getVaultResourceUrl(imageData.localPath) || imageData.localPath;
					}
					
					const imageEl = imageWrapper.createEl('img', { 
						cls: 'ai-chat-message-image',
						attr: { src: imageSrc, alt: imageData.fileName || 'Image' }
					});
					
					// Make the image draggable and set drag data for proper Obsidian integration
					imageEl.draggable = true;
					imageEl.addEventListener('dragstart', (e) => {
						if (imageData.localPath) {
							// Use the local path for dragging so it gets properly inserted as markdown
							e.dataTransfer?.setData('text/plain', imageData.localPath);
							// Also set the image path for Obsidian's internal drag handling
							e.dataTransfer?.setData('application/x-obsidian-drag', JSON.stringify({
								type: 'file',
								file: imageData.localPath
							}));
						} else {
							// Fallback to data URL if no local path
							e.dataTransfer?.setData('text/plain', imageData.dataUrl || imageSrc);
						}
					});
					
					// For modal display, prefer dataUrl, fallback to local path
					imageEl.addEventListener('click', () => {
						const modalSrc = imageData.dataUrl || imageSrc;
						this.showImageModal(modalSrc);
					});
					
					// Add filename label
					const fileNameEl = imageWrapper.createEl('div', { 
						cls: 'ai-chat-message-image-filename',
						text: imageData.fileName || `Image ${index + 1}`
					});
				});
			} else {
				// Single image - prioritize dataUrl for display
				const singleImageData = (message as any).imageData;
				let imageSrc = message.image;
				
				// Prefer dataUrl if available in imageData or images array
				if (singleImageData && singleImageData.dataUrl) {
					imageSrc = singleImageData.dataUrl;
				} else if ((message as any).images && (message as any).images[0] && (message as any).images[0].dataUrl) {
					imageSrc = (message as any).images[0].dataUrl;
				} else if (message.image && message.image.startsWith('data:')) {
					imageSrc = message.image;
				} else {
					// Try to get vault resource URL for local paths
					imageSrc = this.getVaultResourceUrl(message.image) || message.image;
				}
					
				const imageEl = messageContent.createEl('img', { 
					cls: 'ai-chat-message-image',
					attr: { src: imageSrc, alt: 'Screenshot' }
				});
				
				// Make the image draggable and set drag data for proper Obsidian integration
				imageEl.draggable = true;
				imageEl.addEventListener('dragstart', (e) => {
					const imageData = singleImageData || ((message as any).images && (message as any).images[0]);
					if (imageData && imageData.localPath) {
						// Use the local path for dragging so it gets properly inserted as markdown
						e.dataTransfer?.setData('text/plain', imageData.localPath);
						// Also set the image path for Obsidian's internal drag handling
						e.dataTransfer?.setData('application/x-obsidian-drag', JSON.stringify({
							type: 'file',
							file: imageData.localPath
						}));
					} else {
						// Fallback to data URL if no local path
						e.dataTransfer?.setData('text/plain', imageSrc);
					}
				});
				
				imageEl.addEventListener('click', () => {
					// For modal, prefer dataUrl if available, otherwise use current src
					const modalSrc = singleImageData?.dataUrl || 
									((message as any).images && (message as any).images[0]?.dataUrl) || 
									imageSrc;
					this.showImageModal(modalSrc!);
				});
			}
		}

		// Show text content or typing indicator
		if ((message as any).isTyping) {
			const typingEl = messageContent.createEl('div', { cls: 'ai-chat-typing-indicator' });
			typingEl.innerHTML = `
				<span class="typing-dot"></span>
				<span class="typing-dot"></span>
				<span class="typing-dot"></span>
			`;
		} else if (message.content) {
			const textEl = messageContent.createEl('div', { cls: 'ai-chat-message-text' });
			// Support basic markdown rendering
			this.renderMarkdown(textEl, message.content);
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
					await this.plugin.sendImagesToAI(imageDataList.map((img: any) => ({
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
				if (imageData.localPath) {
					// Use the local path for dragging so it gets properly inserted as markdown
					e.dataTransfer?.setData('text/plain', imageData.localPath);
					// Also set the image path for Obsidian's internal drag handling
					e.dataTransfer?.setData('application/x-obsidian-drag', JSON.stringify({
						type: 'file',
						file: imageData.localPath
					}));
				} else {
					// Fallback to data URL if no local path
					e.dataTransfer?.setData('text/plain', imageData.dataUrl);
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
					// Check if it's a vault file reference
					const vaultFile = await this.handleVaultFileDrop(dragData);
					if (vaultFile && vaultFile.type.startsWith('image/')) {
						getLogger().log('Successfully processed vault file:', vaultFile.name);
						const dataUrl = await this.fileToDataUrl(vaultFile);
						// Extract the file path from the vault file processing
						const filePath = this.extractFilePathFromDragData(dragData);
						this.showImagePreview(dataUrl, vaultFile.name, filePath);
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
			
			// Ensure save directory exists
			if (!await adapter.exists(saveLocation)) {
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
		// Remove any other URL encoding or special formatting
		else if (filePath.startsWith('file://')) {
			filePath = decodeURIComponent(filePath.replace('file://', ''));
		}
		
		// Remove any markdown link formatting like [[filename]] or ![[filename]]
		filePath = filePath.replace(/^!?\[\[/, '').replace(/\]\]$/, '');
		
		// Clean up the path
		filePath = filePath.trim();
		
		// Try to find the file in the vault to get the correct path
		const vault = this.plugin.app.vault;
		const abstractFile = vault.getAbstractFileByPath(filePath);
		
		if (abstractFile) {
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
		
		return foundFile ? foundFile.path : filePath;
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
		return await this.aiManager.callAIWithContext(conversation, message, [imageDataUrl]);
	}

	private renderMarkdown(container: HTMLElement, content: string): void {
		// First, extract and render thinking blocks
		const processedContent = this.extractAndRenderThinkingBlocks(container, content);
		
		// Then render the rest as normal markdown
		const lines = processedContent.split('\n');
		
		for (const line of lines) {
			if (line.startsWith('# ')) {
				container.createEl('h1', { text: line.substring(2) });
			} else if (line.startsWith('## ')) {
				container.createEl('h2', { text: line.substring(3) });
			} else if (line.startsWith('### ')) {
				container.createEl('h3', { text: line.substring(4) });
			} else if (line.startsWith('- ') || line.startsWith('* ')) {
				const ul = container.querySelector('ul:last-child') as HTMLElement || container.createEl('ul');
				ul.createEl('li', { text: line.substring(2) });
			} else if (line.match(/^\d+\. /)) {
				const ol = container.querySelector('ol:last-child') as HTMLElement || container.createEl('ol');
				ol.createEl('li', { text: line.replace(/^\d+\. /, '') });
			} else if (line.trim() === '') {
				container.createEl('br');
			} else {
				const p = container.createEl('p');
				// Handle bold and italic
				let text = line;
				text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
				text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
				text = text.replace(/`(.*?)`/g, '<code>$1</code>');
				p.innerHTML = text;
			}
		}
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
							toggleIcon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-9.29 2.5 2.5 0 0 1 4.44-.01Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-9.29 2.5 2.5 0 0 0-4.44-.01Z"/></svg>`;
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
		return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
					overflow-y: auto;
					padding: 16px 0;
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
					display: flex;
					flex-direction: column;
					gap: 16px;
					padding: 0 16px;
					max-height: 100%;
					overflow-y: auto;
				}

				.ai-chat-message {
					display: flex;
					flex-direction: column;
					gap: 8px;
				}

				.ai-chat-message-user {
					align-items: flex-end;
				}

				.ai-chat-message-assistant {
					align-items: flex-start;
				}

				.ai-chat-message-header {
					display: flex;
					justify-content: space-between;
					align-items: center;
					font-size: 12px;
					color: var(--text-muted);
					margin-bottom: 8px;
					padding-bottom: 4px;
					border-bottom: 1px solid var(--background-modifier-border);
					gap: 16px; /* Add consistent gap between sender and time */
				}

				.ai-chat-message-header-right {
					display: flex;
					align-items: center;
					gap: 12px; /* Increase gap between elements in header right */
				}

				.ai-chat-message-sender {
					font-weight: 600;
					flex-shrink: 0; /* Prevent shrinking */
				}

				.ai-chat-message-time {
					flex-shrink: 0; /* Prevent shrinking */
					opacity: 0.8;
				}

				.ai-chat-message-content {
					background: var(--background-primary);
					border: 1px solid var(--background-modifier-border);
					border-radius: 8px;
					padding: 12px;
					max-width: 80%;
				}

				.ai-chat-message-user .ai-chat-message-content {
					background: var(--interactive-accent);
					color: var(--text-on-accent);
					align-self: flex-end;
				}

				.ai-chat-message-assistant .ai-chat-message-content {
					align-self: flex-start;
				}

				.ai-chat-message-image {
					max-width: 200px;
					max-height: 200px;
					border-radius: 4px;
					cursor: pointer;
					margin-bottom: 8px;
					object-fit: contain;
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
					line-height: 1.4;
				}

				.ai-chat-message-text p {
					margin: 0 0 8px 0;
				}

				.ai-chat-message-text p:last-child {
					margin-bottom: 0;
				}

				.ai-chat-message-text h1,
				.ai-chat-message-text h2,
				.ai-chat-message-text h3 {
					margin: 8px 0 4px 0;
				}

				.ai-chat-message-text ul,
				.ai-chat-message-text ol {
					margin: 8px 0;
					padding-left: 20px;
				}

				.ai-chat-message-text code {
					background: var(--background-secondary);
					padding: 2px 4px;
					border-radius: 3px;
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
					bottom: 100%;
					left: 50%;
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
					margin-bottom: 8px;
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

				/* Send button - completely borderless */
				.ai-chat-send-button-embedded {
					position: absolute;
					right: 8px;
					bottom: 8px;
					background: transparent !important;
					border: none !important;
					outline: none !important;
					box-shadow: none !important;
					color: #D1D5DB; /* Lighter gray default */
					font-size: 16px;
					padding: 6px;
					border-radius: 0;
					cursor: pointer;
					transition: color 0.2s ease;
					display: flex;
					align-items: center;
					justify-content: center;
					width: 32px;
					height: 32px;
				}

				.ai-chat-send-button-embedded:hover:not(:disabled) {
					color: #1F2937 !important; /* Darker black on hover */
					background: transparent !important;
					border: none !important;
					outline: none !important;
					box-shadow: none !important;
				}

				.ai-chat-send-button-embedded:focus {
					outline: none !important;
					border: none !important;
					box-shadow: none !important;
				}

				.theme-dark .ai-chat-send-button-embedded {
					color: #6B7280; /* Lighter gray for dark theme */
				}

				.theme-dark .ai-chat-send-button-embedded:hover:not(:disabled) {
					color: #F9FAFB; /* Light color on hover in dark theme */
				}

				.ai-chat-send-button-embedded:disabled {
					color: #9CA3AF; /* Slightly darker when disabled */
					cursor: not-allowed;
				}

				/* Send button tooltip - remove content to allow dynamic tooltips */
				.ai-chat-send-button-embedded .send-tooltip {
					position: absolute;
					bottom: 100%;
					right: 0;
					background: #374151;
					color: white;
					padding: 6px 8px;
					border-radius: 4px;
					font-size: 12px;
					white-space: nowrap;
					opacity: 0;
					pointer-events: none;
					transition: opacity 0.2s ease;
					margin-bottom: 8px;
					z-index: 1000;
				}

				.ai-chat-send-button-embedded:hover .send-tooltip {
					opacity: 1;
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

				.ai-thinking-text code {
					background: var(--background-primary);
					padding: 2px 4px;
					border-radius: 3px;
					font-family: var(--font-monospace);
					font-size: 0.9em;
					color: var(--text-normal);
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

			// Generate filename with timestamp
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
			const fileName = `ai-conversation-${timestamp}.md`;

			// Generate markdown content
			const markdownContent = this.generateConversationMarkdown(conversation);

			// Get save location from settings
			const saveLocation = this.plugin.settings.conversationSaveLocation || 'screenshots-capture/conversations';

			// Ensure the directory exists
			const vault = this.plugin.app.vault;
			const adapter = vault.adapter;

			if (saveLocation && !await adapter.exists(saveLocation)) {
				await vault.createFolder(saveLocation);
			}

			// Construct full path
			const fullPath = saveLocation ? `${saveLocation}/${fileName}` : fileName;

			// Save the file
			await vault.create(fullPath, markdownContent);

			new Notice(`✅ Conversation saved as ${fileName}`);
			getLogger().log('Conversation saved to:', fullPath);

		} catch (error: any) {
			console.error('Failed to save conversation:', error);
			new Notice(`❌ Failed to save conversation: ${error.message}`);
		}
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

	private generateConversationMarkdown(conversation: AIConversation): string {
		// Use conversation creation time instead of current time for consistent content
		const firstMessage = conversation.messages[0];
		const creationTime = firstMessage ? firstMessage.timestamp : new Date();
		const timestamp = creationTime.toLocaleString();
		
		let markdown = `# AI Conversation\n\n`;
		markdown += `**Created:** ${timestamp}\n`;
		markdown += `**Title:** ${conversation.title}\n\n`;
		markdown += `---\n\n`;

		conversation.messages.forEach((message, index) => {
			const sender = message.type === 'user' ? '👤 **User**' : '🤖 **AI Assistant**';
			const messageTime = message.timestamp.toLocaleTimeString();
			
			markdown += `## ${sender} (${messageTime})\n\n`;

			// Add image if present
			if (message.image) {
				const allImages = (message as any).images;
				if (allImages && allImages.length > 1) {
					// Multiple images - display all of them
					markdown += `*[Sent ${allImages.length} images]*\n\n`;
					allImages.forEach((imageData: any, index: number) => {
						// Prioritize local path over dataUrl
						let imagePath = imageData.dataUrl; // fallback
						if (imageData.localPath) {
							const formattedPath = this.formatImagePath(imageData.localPath);
							if (formattedPath) {
								imagePath = formattedPath;
							}
						}
						
						const fileName = imageData.fileName || `image-${index + 1}`;
						markdown += `![${fileName}](${imagePath})\n`;
						if (imageData.fileName) {
							markdown += `*${imageData.fileName}*\n\n`;
						}
					});
				} else {
					// Single image - check for local path in multiple places
					const singleImageData = (message as any).imageData;
					const firstImageFromArray = allImages && allImages.length > 0 ? allImages[0] : null;
					
					let imagePath = message.image; // fallback to base64
					let hasLocalPath = false;
					
					// Priority 1: Check images array first
					if (firstImageFromArray && firstImageFromArray.localPath) {
						const formattedPath = this.formatImagePath(firstImageFromArray.localPath);
						if (formattedPath) {
							imagePath = formattedPath;
							hasLocalPath = true;
						}
					}
					// Priority 2: Check imageData property
					else if (singleImageData && singleImageData.localPath) {
						const formattedPath = this.formatImagePath(singleImageData.localPath);
						if (formattedPath) {
							imagePath = formattedPath;
							hasLocalPath = true;
						}
					}
					// Priority 3: Check if the message itself has localPath metadata
					else if ((message as any).localPath) {
						const formattedPath = this.formatImagePath((message as any).localPath);
						if (formattedPath) {
							imagePath = formattedPath;
							hasLocalPath = true;
						}
					}
					
					if (!hasLocalPath && imagePath.startsWith('data:')) {
						console.warn('⚠️ Still using base64 for image, local path not found. Message data:', {
							hasImages: !!allImages,
							hasImageData: !!singleImageData,
							hasDirectLocalPath: !!(message as any).localPath,
							messageKeys: Object.keys(message)
						});
					}
					
					markdown += `![Screenshot](${imagePath})\n\n`;
				}
			}

			// Add text content
			if (message.content) {
				markdown += `${message.content}\n\n`;
			}

			markdown += `---\n\n`;
		});

		markdown += `\n*Generated by Obsidian Screenshot Capture Plugin*\n`;
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
			
			// Copy all messages from the loaded conversation and restore image data
			for (const message of conversation.messages) {
				const newMessage: AIMessage = {
					id: 'loaded_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
					type: message.type,
					content: message.content,
					timestamp: new Date(), // Use current time for loaded messages
					...(message.image && { image: message.image })
				};
				
				// Preserve any additional image data if present
				if ((message as any).images) {
					(newMessage as any).images = (message as any).images;
				}
				if ((message as any).imageData) {
					(newMessage as any).imageData = (message as any).imageData;
				}
				// Also preserve any other image-related metadata
				if ((message as any).localPath) {
					(newMessage as any).localPath = (message as any).localPath;
				}
				
				// Restore image dataUrl from local paths
				await this.restoreImageDataForMessage(newMessage);
				
				newConversation.messages.push(newMessage);
			}

			// Update the chat view to show the loaded conversation
			this.updateContent();
			
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
}