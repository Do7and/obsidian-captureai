import { ItemView, WorkspaceLeaf, TFile, Notice } from 'obsidian';
import ImageCapturePlugin from '../main';
import { AIManager, AIMessage, AIConversation } from './ai-manager';

export const AI_CHAT_VIEW_TYPE = 'ai-chat';

export class AIChatView extends ItemView {
	private plugin: ImageCapturePlugin;
	private aiManager: AIManager;

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
		this.updateContent();
	}

	updateContent(): void {
		const container = this.containerEl.children[1] as HTMLElement;
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
		} else {
			// Show conversation
			this.renderConversation(chatArea, conversation);
		}

		// Always add input area for text-only conversations
		this.createInputArea(container, conversation);
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

	private startNewConversation(): void {
		// Clear current conversation and start fresh
		this.aiManager.cleanup();
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
			const imageEl = messageContent.createEl('img', { 
				cls: 'ai-chat-message-image',
				attr: { src: message.image, alt: 'Screenshot' }
			});
			imageEl.addEventListener('click', () => {
				this.showImageModal(message.image!);
			});
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
					// Convert image to markdown
					const src = element.getAttribute('src');
					const alt = element.getAttribute('alt') || 'image';
					if (src) {
						// For data URLs, include them directly
						if (src.startsWith('data:')) {
							markdown += `![${alt}](${src})`;
						} else {
							markdown += `![${alt}](${src})`;
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
			if (selectedText) {
				markdown = `![Screenshot](${message.image})\n\n${markdown}`;
			} else {
				markdown = `![Screenshot](${message.image})`;
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

		// Image preview area (initially hidden)
		const imagePreviewArea = inputArea.createEl('div', { cls: 'ai-chat-image-preview-area' });
		imagePreviewArea.style.display = 'none';

		// Drag and drop zone (like original design)
		const dropZone = inputArea.createEl('div', { cls: 'ai-chat-drop-zone' });
		const dropZoneContent = dropZone.createEl('div', { cls: 'ai-chat-drop-zone-content' });
		
		const dropIcon = dropZoneContent.createEl('span', { cls: 'ai-chat-drop-zone-icon' });
		dropIcon.innerHTML = '🖼️';
		
		const dropText = dropZoneContent.createEl('span');
		dropText.innerHTML = 'Drag images here or <span class="file-picker-link">browse files</span>';
		
		// Click to browse files
		dropZone.addEventListener('click', () => {
			this.showFilePicker();
		});

		// Main input container with embedded send button (like your reference image)
		const inputContainer = inputArea.createEl('div', { cls: 'ai-chat-input-container' });
		
		// Text input 
		const textInput = inputContainer.createEl('textarea', { 
			cls: 'ai-chat-input',
			attr: { 
				placeholder: 'What do you want to know, or with pic?.',
				rows: '1'
			}
		});

		// Send button embedded in input
		const sendButton = inputContainer.createEl('button', { 
			cls: 'ai-chat-send-button-embedded',
			attr: { title: 'Send message' }
		});
		sendButton.innerHTML = '↗';

		// Bottom row with model selector
		const bottomRow = inputArea.createEl('div', { cls: 'ai-chat-bottom-row' });
		
		// Model selector with upward popup
		const modelSelectorContainer = bottomRow.createEl('div', { cls: 'model-selector-container' });
		this.createModelSelector(modelSelectorContainer);
		
		// Right side actions
		const rightActions = bottomRow.createEl('div', { cls: 'ai-chat-right-actions' });
		const chatButton = rightActions.createEl('button', { 
			text: 'chat',
			cls: 'ai-chat-action-secondary',
			attr: { title: 'Start new chat' }
		});

		// Handle chat button click
		chatButton.addEventListener('click', () => {
			this.startNewConversation();
		});

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
					// Send images with optional text - for now, send first image (can be enhanced for multi-image)
					const firstImage = imageDataList[0];
					await this.plugin.sendImageToAI(firstImage.dataUrl, message || 'Please analyze this image', firstImage.fileName);
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
					this.showImagePreview(dataUrl, file.name);
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
		
		const clearAllBtn = headerEl.createEl('button', { text: 'Clear All', cls: 'clear-all-btn' });
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
			
			const removeBtn = infoOverlay.createEl('button', { text: '×', cls: 'remove-single-image-btn' });
			removeBtn.title = 'Remove this image';
			removeBtn.addEventListener('click', (e) => {
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

	private showImagePreview(dataUrl: string, fileName: string): void {
		const inputArea = this.containerEl.querySelector('.ai-chat-input-area') as HTMLElement;
		if (!inputArea) return;

		const imagePreviewArea = (inputArea as any)._imagePreviewArea as HTMLElement;
		const imageDataList = (inputArea as any)._currentImageDataList || [];
		
		// Add new image to the list
		const newImageData = { dataUrl, fileName, id: Date.now().toString() };
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

			const files = e.dataTransfer.files;
			if (!files || files.length === 0) return;

			// Filter for image files only
			const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
			
			if (imageFiles.length === 0) {
				new Notice('Please drop image files only');
				return;
			}

			try {
				// Process all image files
				for (const file of imageFiles) {
					const dataUrl = await this.fileToDataUrl(file);
					this.showImagePreview(dataUrl, file.name);
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

	private async handleVaultFileDrop(data: string): Promise<File | null> {
		try {
			console.log('Attempting to resolve vault file from data:', data);
			
			// Try different ways to parse the file path
			let filePath = data;
			
			// Remove any URL encoding or special formatting
			if (filePath.startsWith('file://')) {
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
					padding: 16px;
				}

				/* Drag and drop zone (restored original design) */
				.ai-chat-drop-zone {
					border: 2px dashed var(--background-modifier-border);
					border-radius: 8px;
					padding: 16px;
					margin-bottom: 12px;
					text-align: center;
					transition: all 0.2s ease;
					cursor: pointer;
				}

				.ai-chat-drop-zone:hover {
					border-color: var(--interactive-accent);
					background: var(--background-modifier-hover);
				}

				.ai-chat-drop-zone-active {
					border-color: var(--interactive-accent) !important;
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

				/* Input container with embedded send button */
				.ai-chat-input-container {
					position: relative;
					display: flex;
					align-items: flex-end;
					background: var(--background-primary);
					border: 1px solid var(--background-modifier-border);
					border-radius: 8px;
					padding: 12px;
					margin-bottom: 12px;
				}

				.ai-chat-input-container:focus-within {
					border-color: var(--interactive-accent);
					box-shadow: 0 0 0 1px var(--interactive-accent);
				}

				.ai-chat-input {
					flex: 1;
					border: none;
					outline: none;
					background: transparent;
					color: var(--text-normal);
					font-family: inherit;
					font-size: 14px;
					line-height: 1.4;
					resize: none;
					min-height: 20px;
					max-height: 120px;
					overflow-y: auto;
					padding-right: 40px; /* Space for send button */
				}

				.ai-chat-input::placeholder {
					color: var(--text-muted);
				}

				/* Embedded send button */
				.ai-chat-send-button-embedded {
					position: absolute;
					right: 8px;
					bottom: 8px;
					background: var(--interactive-accent);
					border: none;
					color: var(--text-on-accent);
					font-size: 16px;
					padding: 6px;
					border-radius: 4px;
					cursor: pointer;
					transition: all 0.2s ease;
					display: flex;
					align-items: center;
					justify-content: center;
					width: 32px;
					height: 32px;
				}

				.ai-chat-send-button-embedded:hover:not(:disabled) {
					background: var(--interactive-accent-hover);
				}

				.ai-chat-send-button-embedded:disabled {
					background: var(--text-muted);
					cursor: not-allowed;
				}

				/* Bottom row */
				.ai-chat-bottom-row {
					display: flex;
					justify-content: space-between;
					align-items: center;
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
					gap: 6px;
					padding: 6px 12px;
					background: var(--background-secondary);
					border: 1px solid var(--background-modifier-border);
					border-radius: 4px;
					color: var(--text-muted);
					cursor: pointer;
					font-size: 13px;
					transition: all 0.2s ease;
				}

				.model-selector-button:hover {
					background: var(--background-modifier-hover);
					border-color: var(--background-modifier-border-hover);
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
					background: var(--background-secondary);
					border-radius: 4px;
				}

				.ai-chat-input-drag-active .ai-chat-drop-zone {
					border-color: var(--interactive-accent) !important;
					background: var(--background-modifier-border) !important;
					transform: scale(1.02);
				}

				.ai-chat-image-preview-area {
					margin-bottom: 12px;
					padding: 12px;
					background: var(--background-secondary);
					border-radius: 6px;
					border: 1px solid var(--background-modifier-border);
				}

				.images-preview-container {
					display: flex;
					flex-direction: column;
					gap: 12px;
				}

				.preview-header {
					display: flex;
					justify-content: space-between;
					align-items: center;
					padding-bottom: 8px;
					border-bottom: 1px solid var(--background-modifier-border);
				}

				.preview-count {
					font-size: 12px;
					color: var(--text-normal);
					font-weight: 500;
				}

				.clear-all-btn {
					padding: 4px 8px;
					border: 1px solid var(--interactive-critical);
					border-radius: 3px;
					background: var(--background-primary);
					color: var(--interactive-critical);
					font-size: 11px;
					cursor: pointer;
				}

				.clear-all-btn:hover {
					background: var(--interactive-critical);
					color: white;
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
					width: 18px;
					height: 18px;
					border-radius: 9px; /* Fixed radius instead of 50% to maintain perfect circle */
					border: none;
					background: var(--interactive-critical);
					color: white;
					cursor: pointer;
					font-size: 12px;
					display: flex;
					align-items: center;
					justify-content: center;
					line-height: 1;
					margin-left: 4px;
					flex-shrink: 0;
					position: absolute;
					top: 2px;
					right: 2px;
				}

				.remove-single-image-btn:hover {
					background: var(--interactive-critical-hover);
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
		// Cleanup drag and drop listeners
		const dropZone = this.containerEl.querySelector('.ai-chat-drop-zone') as HTMLElement;
		if (dropZone && (dropZone as any)._dragCleanup) {
			(dropZone as any)._dragCleanup();
		}
	}
}