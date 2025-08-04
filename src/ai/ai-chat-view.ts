import { ItemView, WorkspaceLeaf, TFile, Notice } from 'obsidian';
import ImageCapturePlugin from '../main';
import { AIManager, AIMessage, AIConversation } from './ai-manager';
import { ChatHistoryModal } from '../ui/chat-history-modal';

export const AI_CHAT_VIEW_TYPE = 'ai-chat';

export class AIChatView extends ItemView {
	private plugin: ImageCapturePlugin;
	private aiManager: AIManager;
	
	// Auto-save management
	private autoSaveTimer: NodeJS.Timeout | null = null;
	// 使用设置中的间隔时间，默认30秒
	private autoSaveInterval = 30000; // 将在onOpen中更新
	private lastAutoSaveContent: string | null = null;
	private lastAutoSaveTime = 0;
	private currentConversationId: string | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: ImageCapturePlugin) {
		super(leaf);
		this.plugin = plugin;
		this.aiManager = plugin.aiManager;
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
		// 使用设置中的自动保存间隔，如果未设置则默认为30秒
		this.autoSaveInterval = (this.plugin.settings.autoSaveInterval || 30) * 1000;
		this.updateContent();
	}

	updateContent(): void {
		const container = this.containerEl.children[1] as HTMLElement;
		
		// Save current image queue before clearing container
		let savedImageQueue: any[] = [];
		const oldInputArea = container.querySelector('.ai-chat-input-area') as HTMLElement;
		if (oldInputArea && (oldInputArea as any)._currentImageDataList) {
			savedImageQueue = [...(oldInputArea as any)._currentImageDataList];
			console.log('Saved image queue:', savedImageQueue.length, 'images');
		}
		
		container.empty();
		container.addClass('ai-chat-container');

		// Add CSS styles
		this.addStyles();

		// Header with title (remove model selector from header)
		const header = container.createEl('div', { cls: 'ai-chat-header' });
		header.createEl('h3', { text: 'AI Chat - from ScreenshotCapture', cls: 'ai-chat-title' });

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
					console.log('Restored image queue:', savedImageQueue.length, 'images');
				}
			}
		}
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
		const titleSection = emptyState.createEl('div', { cls: 'ai-chat-title-section' });
		titleSection.createEl('h2', { text: 'AI Assistant', cls: 'ai-chat-main-title' });
		
		// Instructions section
		const instructionsSection = emptyState.createEl('div', { cls: 'ai-chat-instructions-section' });
		instructionsSection.createEl('h3', { text: 'How to Use', cls: 'ai-chat-section-title' });
		
		const instructionsList = instructionsSection.createEl('div', { cls: 'ai-chat-instructions-list' });
		const instructions = [
			{ icon: '📷', text: 'Take a screenshot and it will be automatically analyzed' },
			{ icon: '🖼️', text: 'Drag and drop images into the chat area' },
			{ icon: '💬', text: 'Type your questions and press Enter to send' },
			{ icon: '⚙️', text: 'Configure API keys in Settings if needed' }
		];

		instructions.forEach(instruction => {
			const instructionEl = instructionsList.createEl('div', { cls: 'ai-chat-instruction-item' });
			instructionEl.createEl('span', { text: instruction.icon, cls: 'ai-chat-instruction-icon' });
			instructionEl.createEl('span', { text: instruction.text, cls: 'ai-chat-instruction-text' });
		});

		// Model status
		const visionModels = this.plugin.settings.modelConfigs.filter(mc => mc.isVisionCapable);
		const statusEl = emptyState.createEl('div', { cls: 'ai-status' });
		
		if (visionModels.length === 0) {
			statusEl.innerHTML = `
				<div class="ai-status-warning">
					⚠️ No AI models configured
				</div>
				<div class="ai-status-desc">
					Go to Settings → Set Keys to configure AI providers
				</div>
			`;
			statusEl.addEventListener('click', () => {
				// Open settings
				(this.plugin.app as any).setting.open();
				(this.plugin.app as any).setting.openTabById(this.plugin.manifest.id);
			});
		} else {
			const defaultModel = visionModels.find(mc => mc.id === this.plugin.settings.defaultModelConfigId) || visionModels[0];
			statusEl.innerHTML = `
				<div class="ai-status-ready">
					✅ Ready with ${defaultModel.name}
				</div>
				<div class="ai-status-desc">
					${visionModels.length} vision model${visionModels.length > 1 ? 's' : ''} configured
				</div>
			`;
		}
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

			// Call AI API for text-only response
			const response = await this.callAIForText(message);

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

	private async callAIForText(message: string): Promise<string> {
		// Call AI API for text-only conversation using the AI manager
		return await this.aiManager.callAIForTextOnly(message);
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
				new Notice('Text copied to clipboard');
			}
		} catch (error) {
			console.error('Failed to copy message:', error);
			new Notice('Failed to copy message');
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
			new Notice('Image copied to clipboard');
		} catch (error) {
			console.error('Failed to copy image:', error);
			new Notice('Failed to copy image');
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
			new Notice('Selection copied as Markdown');
		} catch (error) {
			console.error('Failed to copy selection:', error);
			new Notice('Failed to copy selection');
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

	private createInputArea(container: HTMLElement, conversation: AIConversation | null): void {
		const inputArea = container.createEl('div', { cls: 'ai-chat-input-area' });

		// Top action bar (above drag zone) with reduced spacing
		const topActionBar = inputArea.createEl('div', { cls: 'ai-chat-top-action-bar' });
		
		// Only right side action buttons (all three buttons right-aligned)
		const rightActions = topActionBar.createEl('div', { cls: 'ai-chat-right-actions-top' });
		
		// Save button with Lucide save icon
		const saveBtn = rightActions.createEl('button', { 
			cls: 'ai-chat-action-btn',
			attr: { 
				title: 'Save',
				'data-tooltip': 'Save'
			}
		});
		saveBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17,21 17,13 7,13 7,21"/><polyline points="7,3 7,8 15,8"/></svg>`;
		
		// Chat History button with Lucide history icon
		const historyBtn = rightActions.createEl('button', { 
			cls: 'ai-chat-action-btn',
			attr: { 
				title: 'Chat History',
				'data-tooltip': 'Chat History'
			}
		});
		historyBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>`;
		
		// New chat button with Lucide plus icon
		const newChatBtn = rightActions.createEl('button', { 
			cls: 'ai-chat-action-btn',
			attr: { 
				title: 'New Chat',
				'data-tooltip': 'New Chat'
			}
		});
		newChatBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
		
		// Menu button with Lucide more-vertical icon
		const menuBtn = rightActions.createEl('button', { 
			cls: 'ai-chat-action-btn',
			attr: { 
				title: 'Menu',
				'data-tooltip': 'Menu'
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
		dropText.innerHTML = 'Drag images here or ';
		
		// Create clickable "browse files" link
		const browseLink = dropZoneContent.createEl('span', { 
			cls: 'file-picker-link',
			text: 'browse files'
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
				placeholder: 'What do you want to know, or with pic?.',
				rows: '1'
			}
		});

		// Bottom row with model selector and send button
		const bottomRow = inputArea.createEl('div', { cls: 'ai-chat-bottom-row' });
		
		// Model selector with upward popup
		const modelSelectorContainer = bottomRow.createEl('div', { cls: 'model-selector-container' });
		this.createModelSelector(modelSelectorContainer);

		// Send button (moved to bottom row, no tooltip)
		const sendButton = bottomRow.createEl('button', { 
			cls: 'ai-chat-send-button-bottom'
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
		const sendMessage = async () => {
			const message = textInput.value.trim();
			const imageDataList = (inputArea as any)._currentImageDataList || [];
			
			if (!message && imageDataList.length === 0) return;

			textInput.value = '';
			this.clearImagePreview(inputArea);
			sendButton.disabled = true;
			sendButton.innerHTML = '⏳';

			try {
				if (imageDataList.length > 0) {
					// Send all images with optional text, preserving local paths
					await this.plugin.sendImagesToAI(imageDataList.map((img: any) => ({
						dataUrl: img.dataUrl,
						fileName: img.fileName,
						localPath: img.localPath
					})), message || 'Please analyze these images');
				} else if (conversation && conversation.messages.length > 0) {
					// Follow-up text message in existing conversation
					await this.sendFollowUpMessage(conversation, message);
				} else {
					// New text-only conversation
					await this.sendTextMessage(message);
				}
			} catch (error) {
				console.error('Failed to send message:', error);
			} finally {
				sendButton.disabled = false;
				sendButton.innerHTML = '↗';
			}
		};

		sendButton.addEventListener('click', sendMessage);

		// Send on Enter (not Shift+Enter)
		textInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				sendMessage();
			}
		});

		// Auto-resize textarea
		textInput.addEventListener('input', () => {
			textInput.style.height = 'auto';
			textInput.style.height = Math.min(textInput.scrollHeight, 120) + 'px';
		});
	}

	private createModelSelector(container: HTMLElement): void {
		const visionModels = this.plugin.settings.modelConfigs.filter(mc => mc.isVisionCapable);
		
		if (visionModels.length === 0) {
			const noModelsEl = container.createEl('div', { 
				text: 'No models configured',
				cls: 'no-models-indicator'
			});
			return;
		}

		// Create custom dropdown that opens upward
		const selectorWrapper = container.createEl('div', { cls: 'model-selector-wrapper' });
		
		// Current model display button
		const currentModel = visionModels.find(mc => mc.id === this.plugin.settings.defaultModelConfigId) || visionModels[0];
		const selectorButton = selectorWrapper.createEl('button', { 
			cls: 'model-selector-button',
			text: currentModel.name
		});
		
		// Dropdown arrow
		const dropdownIcon = selectorButton.createEl('span', { cls: 'model-dropdown-arrow' });
		dropdownIcon.innerHTML = '▲';
		
		// Dropdown menu (initially hidden)
		const dropdown = selectorWrapper.createEl('div', { cls: 'model-dropdown-menu' });
		dropdown.style.display = 'none';
		
		// Add model options
		visionModels.forEach(modelConfig => {
			const option = dropdown.createEl('div', { 
				cls: 'model-dropdown-option',
				text: modelConfig.name,
				attr: { 'data-model-id': modelConfig.id }
			});
			
			if (modelConfig.id === this.plugin.settings.defaultModelConfigId) {
				option.addClass('selected');
			}
			
			// Handle option click
			option.addEventListener('click', async () => {
				// Update selection
				dropdown.querySelectorAll('.model-dropdown-option').forEach(opt => opt.removeClass('selected'));
				option.addClass('selected');
				
				// Update button text
				selectorButton.firstChild!.textContent = modelConfig.name;
				
				// Save settings
				this.plugin.settings.defaultModelConfigId = modelConfig.id;
				await this.plugin.saveSettings();
				
				// Update last used timestamp
				modelConfig.lastUsed = new Date();
				await this.plugin.saveSettings();
				
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
		
		// Close dropdown when clicking outside
		document.addEventListener('click', (e) => {
			if (!selectorWrapper.contains(e.target as Node)) {
				dropdown.style.display = 'none';
				dropdownIcon.innerHTML = '▲';
			}
		});
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

	private renderImagePreviews(container: HTMLElement, imageDataList: any[], inputArea: HTMLElement): void {
		container.innerHTML = '';
		
		if (imageDataList.length === 0) {
			container.style.display = 'none';
			return;
		}
		
		const previewContainer = container.createEl('div', { cls: 'images-preview-container' });
		
		// Header with count
		const headerEl = previewContainer.createEl('div', { cls: 'preview-header' });
		headerEl.createEl('span', { text: `${imageDataList.length} image${imageDataList.length > 1 ? 's' : ''} ready to send`, cls: 'preview-count' });
		
		const clearAllBtn = headerEl.createEl('button', { 
			cls: 'ai-chat-action-btn',
			attr: { 
				title: 'Clear All',
				'data-tooltip': 'Clear All'
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
			
			// Add click handler for image preview
			img.addEventListener('click', () => {
				this.showImageModal(imageData.dataUrl);
			});
			
			const infoOverlay = imageItem.createEl('div', { cls: 'image-info-overlay' });
			infoOverlay.createEl('span', { text: imageData.fileName, cls: 'image-filename-overlay' });
			
			// Create remove button directly on imageItem, not in infoOverlay
			const removeBtn = imageItem.createEl('button', { cls: 'remove-single-image-btn' });
			removeBtn.innerHTML = '✕'; // Use heavy multiplication X (更粗的斜十字)
			removeBtn.title = 'Remove this image';
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
				console.log('Drag data received:', dragData);
				
				if (dragData) {
					// Check if it's a vault file reference
					const vaultFile = await this.handleVaultFileDrop(dragData);
					if (vaultFile && vaultFile.type.startsWith('image/')) {
						console.log('Successfully processed vault file:', vaultFile.name);
						const dataUrl = await this.fileToDataUrl(vaultFile);
						// Extract the file path from the vault file processing
						const filePath = this.extractFilePathFromDragData(dragData);
						this.showImagePreview(dataUrl, vaultFile.name, filePath);
						return; // Successfully handled as vault file, exit early
					}
				}
			} catch (error) {
				console.log('Vault file processing failed, trying external files:', error);
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
			
			console.log('External image saved to vault:', savePath);
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
				console.log('Extracted file path from obsidian URL:', filePath);
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
			console.log('Attempting to resolve vault file from data:', data);
			
			// Try different ways to parse the file path
			let filePath = data;
			
			// Handle obsidian:// protocol URLs
			if (filePath.startsWith('obsidian://open?')) {
				const url = new URL(filePath);
				const fileParam = url.searchParams.get('file');
				if (fileParam) {
					filePath = decodeURIComponent(fileParam);
					console.log('Extracted file path from obsidian URL:', filePath);
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
			
			console.log('Cleaned file path:', filePath);
			
			// Try to get the file from the vault
			const vault = this.plugin.app.vault;
			const abstractFile = vault.getAbstractFileByPath(filePath);
			
			if (!abstractFile || !(abstractFile instanceof TFile)) {
				console.log('File not found directly, trying alternative methods...');
				
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
					console.log('Could not find file in vault:', filePath);
					return null;
				}
				
				console.log('Found file by name:', foundFile.path);
				const buffer = await vault.readBinary(foundFile);
				const blob = new Blob([buffer], { type: this.getMimeType(foundFile.extension) });
				return new File([blob], foundFile.name, { type: this.getMimeType(foundFile.extension) });
			}
			
			// Read the file as binary
			const file = abstractFile as TFile;
			console.log('Reading vault file:', file.path);
			
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
		// Call the AI manager's public method for follow-up questions
		return await this.aiManager.callAIForFollowUp(message, imageDataUrl);
	}

	private renderMarkdown(container: HTMLElement, content: string): void {
		// Basic markdown rendering - in a real implementation you might use a proper markdown parser
		const lines = content.split('\n');
		
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
					padding: 32px 16px;
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
					margin-top: 20px;
					padding: 12px;
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
					justify-content: flex-end;
					align-items: center;
					margin-bottom: 2px;
					padding: 0;
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

				/* Send button tooltip */
				.ai-chat-send-button-embedded::after {
					content: "Send message (Enter)";
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

				.ai-chat-send-button-embedded:hover::after {
					opacity: 1;
				}

				/* Bottom row - revised layout */
				.ai-chat-bottom-row {
					display: flex;
					align-items: center;
					justify-content: space-between;
					padding: 0 1px;
					margin-top: 1px;
				}

				.model-selector-container {
					flex: 1;
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
				}

				.model-selector-button {
					display: flex;
					align-items: center;
					gap: 4px;
					padding: 4px 8px;
					background: transparent !important;
					border: none !important;
					border-radius: 4px;
					color: #9CA3AF !important; /* Gray default with !important */
					cursor: pointer;
					font-size: 11px;
					transition: color 0.2s ease;
					outline: none !important;
					box-shadow: none !important;
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
					right: 0;
					background: var(--background-primary);
					border: 1px solid var(--background-modifier-border);
					border-radius: 6px;
					box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.15);
					z-index: 1000;
					margin-bottom: 4px;
					max-height: 200px;
					overflow-y: auto;
				}

				.model-dropdown-option {
					padding: 8px 12px;
					cursor: pointer;
					font-size: 13px;
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

				.model-dropdown-option:first-child {
					border-radius: 6px 6px 0 0;
				}

				.model-dropdown-option:last-child {
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
		
		// Cleanup drag and drop listeners
		const dropZone = this.containerEl.querySelector('.ai-chat-drop-zone') as HTMLElement;
		if (dropZone && (dropZone as any)._dragCleanup) {
			(dropZone as any)._dragCleanup();
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
		
		// Set up periodic auto-save using the configured interval
		this.autoSaveTimer = setInterval(() => {
			this.performPeriodicAutoSave();
		}, this.autoSaveInterval);
		
		console.log('Auto-save timer started for conversation:', conversation.id, 'with interval:', this.autoSaveInterval);
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
			console.log('Final auto-save completed for conversation:', conversation.id);
			
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
				return;
			}

			// Use conversation ID for consistent filename - this will overwrite the same file
			const conversationIdShort = conversation.id.slice(-8); // Last 8 chars of conversation ID
			const fileName = `auto-saved-${conversationIdShort}.md`;

			// Generate markdown content first to check for changes
			const markdownContent = this.generateConversationMarkdown(conversation);
			
			// Check if content has changed since last save
			if (this.lastAutoSaveContent && this.lastAutoSaveContent === markdownContent) {
				console.log('Auto-save skipped: No content changes detected');
				return;
			}

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

			// Only clean up old auto-saved conversations periodically (every 10th save)
			// to avoid excessive file system operations
			if (Math.random() < 0.1) { // 10% chance
				await this.cleanupOldAutoSavedConversations();
			}

			console.log('Auto-saved conversation to:', fullPath);

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
			console.log('Conversation saved to:', fullPath);

		} catch (error: any) {
			console.error('Failed to save conversation:', error);
			new Notice(`❌ Failed to save conversation: ${error.message}`);
		}
	}

	private async cleanupOldAutoSavedConversations(): Promise<void> {
		try {
			const vault = this.plugin.app.vault;
			const autoSaveLocation = this.plugin.settings.autoSavedConversationLocation || 'screenshots-capture/autosavedconversations';
			const maxConversations = this.plugin.settings.maxAutoSavedConversations || 10;

			// Get all auto-saved conversation files
			const autoSaveFolder = vault.getAbstractFileByPath(autoSaveLocation);
			if (!autoSaveFolder) return;

			const files = vault.getMarkdownFiles().filter(file => 
				file.path.startsWith(autoSaveLocation) && 
				file.name.startsWith('auto-saved-')
			);

			// Sort by creation time (newest first)
			files.sort((a, b) => b.stat.ctime - a.stat.ctime);

			// Delete excess files
			if (files.length > maxConversations) {
				const filesToDelete = files.slice(maxConversations);
				for (const file of filesToDelete) {
					await vault.delete(file);
					console.log('Deleted old auto-saved conversation:', file.path);
				}
			}
		} catch (error: any) {
			console.error('Failed to cleanup old auto-saved conversations:', error);
		}
	}

	private generateConversationMarkdown(conversation: AIConversation): string {
		const timestamp = new Date().toLocaleString();
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
								console.log(`Using local path for image ${index + 1}:`, formattedPath);
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
							console.log('✅ Using local path from images array:', formattedPath);
						}
					}
					// Priority 2: Check imageData property
					else if (singleImageData && singleImageData.localPath) {
						const formattedPath = this.formatImagePath(singleImageData.localPath);
						if (formattedPath) {
							imagePath = formattedPath;
							hasLocalPath = true;
							console.log('✅ Using local path from imageData:', formattedPath);
						}
					}
					// Priority 3: Check if the message itself has localPath metadata
					else if ((message as any).localPath) {
						const formattedPath = this.formatImagePath((message as any).localPath);
						if (formattedPath) {
							imagePath = formattedPath;
							hasLocalPath = true;
							console.log('✅ Using local path from message:', formattedPath);
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
			const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
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
						console.log(`✅ Restored dataUrl for image: ${imageData.localPath}`);
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
				console.log(`✅ Restored dataUrl for single image: ${message.imageData.localPath}`);
			} else {
				console.warn(`⚠️ Could not restore dataUrl for single image: ${message.imageData.localPath}`);
			}
		}
		
		// If message.image is a local path, try to restore it
		if (message.image && !message.image.startsWith('data:') && !message.image.startsWith('http')) {
			const dataUrl = await this.loadImageDataFromPath(message.image);
			if (dataUrl) {
				// Keep the original path info and add the dataUrl
				if (!message.images) {
					message.images = [{
						localPath: message.image,
						dataUrl: dataUrl,
						fileName: message.image.split('/').pop() || 'image'
					}];
				}
				// Also update the main image field for compatibility
				message.image = dataUrl;
				console.log(`✅ Restored dataUrl for message image: ${message.image}`);
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
}