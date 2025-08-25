import { ItemView, WorkspaceLeaf, TFile, Notice, MarkdownRenderer, MarkdownView, Modal, Editor, setIcon, requestUrl, App, Vault } from 'obsidian';
import ImageCapturePlugin from '../main';
import { AIManager, AIMessage, AIConversation } from './ai-manager';
import { ChatHistoryModal } from '../ui/chat-history-modal';
import { MessageRenderManager } from '../managers/message-render-manager';
import { t } from '../i18n';
import { getLogger } from '../utils/logger';
import { formatLocalDateTime, formatTimestampForFilename, formatDisplayTime } from '../utils/time';

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
	private messageRenderer: MessageRenderManager;
	
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
		this.messageRenderer = new MessageRenderManager(this);
		
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

		// // Instructions section
		// const instructionsSection = emptyState.createEl('div', { cls: 'ai-chat-instructions-section' });
		// instructionsSection.createEl('h3', { text: t('aiChat.howToUseTitle'), cls: 'ai-chat-section-title' });
		
		// const instructionsList = instructionsSection.createEl('div', { cls: 'ai-chat-instructions-list' });
		// const instructions = [
		// 	{ icon: '⚙️', text: t('aiChat.instruction.configureKeys') },
		// 	{ icon: '📷', text: t('aiChat.instruction.screenshot') },
		// 	{ icon: '🖼️', text: t('aiChat.instruction.dragDrop') },
		// 	{ icon: '💬', text: t('aiChat.instruction.typeQuestions') }
		// ];

		// instructions.forEach(instruction => {
		// 	const instructionEl = instructionsList.createEl('div', { cls: 'ai-chat-instruction-item' });
		// 	instructionEl.createEl('span', { text: instruction.icon, cls: 'ai-chat-instruction-icon' });
		// 	instructionEl.createEl('span', { text: instruction.text, cls: 'ai-chat-instruction-text' });
		// });
	}

	private async startNewConversation(): Promise<void> {
		// Perform final auto-save before starting new conversation
		await this.performFinalAutoSave();
		
		// Reset last saved content for new conversation
		this.lastAutoSaveContent = null;
		
		// Clear current conversation data but preserve temporary images in preview
		this.aiManager.clearConversations();
		this.currentConversationId = null;
		
		// Reset MessageRenderManager for new conversation
		this.messageRenderer.resetForNewConversation();
		
		await this.updateContent();
	}

	private async renderConversation(container: HTMLElement, conversation: AIConversation): Promise<void> {
		await this.messageRenderer.renderMessages(container, conversation.messages);
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

	// renderMessage方法已移动到MessageRenderManager中

	private async copyMessage(message: AIMessage): Promise<void> {
		try {
			// Parse image references from message content using the new architecture
			const imageReferences = this.aiManager.parseImageReferences(message.content || '');
			
			if (imageReferences.length > 0 && message.content) {
				// Message contains both images and text - process temp: protocols
				const processedContent = this.messageRenderer.processContentTempProtocols(message.content);
				
				// If there's exactly one image, try to copy both image and text
				if (imageReferences.length === 1) {
					const imageRef = imageReferences[0];
					if (imageRef.path.startsWith('temp:')) {
						const tempId = imageRef.path.replace('temp:', '');
						const tempData = this.aiManager.getImageReferenceManager().getTempImageData(tempId);
						if (tempData?.dataUrl) {
							await this.copyImageAndText(tempData.dataUrl, processedContent);
							return;
						}
					}
				}
				
				// Fallback to copying processed text content
				await navigator.clipboard.writeText(processedContent);
				new Notice(t('aiChat.textCopied'));
			} else if (imageReferences.length > 0) {
				// Only images, no text - copy the first image
				const imageRef = imageReferences[0];
				if (imageRef.path.startsWith('temp:')) {
					const tempId = imageRef.path.replace('temp:', '');
					const tempData = this.aiManager.getImageReferenceManager().getTempImageData(tempId);
					if (tempData?.dataUrl) {
						await this.copyImage(tempData.dataUrl);
						return;
					}
				}
				new Notice('图片数据未找到');
			} else if (message.image && message.content) {
				// Legacy: Copy both image and text
				await this.copyImageAndText(message.image, message.content);
			} else if (message.image) {
				// Legacy: Copy only image
				await this.copyImage(message.image);
			} else if (message.content) {
				// Copy only text (process any temp: protocols)
				const processedContent = this.messageRenderer.processContentTempProtocols(message.content);
				await navigator.clipboard.writeText(processedContent);
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
			// Process temp: protocols in the selected content
			const processedContent = this.messageRenderer.processContentTempProtocols(selectedContent);
			await navigator.clipboard.writeText(processedContent);
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
					// Convert image to markdown - handle new temp: protocol architecture
					const src = element.getAttribute('src');
					const alt = element.getAttribute('alt') || 'image';
					if (src) {
						// Check if this is a temp image by finding it in the message content
						const imageReferences = this.aiManager.parseImageReferences(message.content || '');
						let foundTempRef = false;
						
						for (const imageRef of imageReferences) {
							if (imageRef.path.startsWith('temp:')) {
								const tempId = imageRef.path.replace('temp:', '');
								const tempData = this.aiManager.getImageReferenceManager().getTempImageData(tempId);
								if (tempData?.dataUrl === src) {
									// This is a temp: protocol image, include it as temp: for processing later
									markdown += `![${alt}](temp:${tempId})`;
									foundTempRef = true;
									break;
								}
							}
						}
						
						if (!foundTempRef) {
							// Legacy handling or non-temp images
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
				
				if (!sendOnly) {
					// Debug: Log the current model info
					getLogger().log(`🔧 Current model debug:`, {
						modelId: currentModel?.id,
						modelName: currentModel?.name,
						isVisionCapable,
						messageLength: message ? message.length : 0,
						hasMessage: !!message
					});
					
					// First, process directly uploaded images
					if (imageDataList.length > 0 && isVisionCapable) {
						currentImages = imageDataList.map((img: any) => img.dataUrl);
						getLogger().log(`📸 Processing ${imageDataList.length} directly uploaded images for AI:`, imageDataList.map(img => ({
							fileName: img.fileName,
							source: img.source,
							hasDataUrl: !!img.dataUrl,
							dataUrlPreview: img.dataUrl?.substring(0, 50) + '...'
						})));
					}
					
					// Second, check if the text message contains image references (like temp: protocol)
					// Prepare the message content for AI (separate text from images)
					let messageForAI = message; // This will be sent to AI (without image markdown)
					
					getLogger().log(`🔍 Checking for image references in message: "${message}"`);
					getLogger().log(`🔍 Conditions: message=${!!message}, isVisionCapable=${isVisionCapable}`);
					
					if (message && isVisionCapable) {
						const imageReferences = this.aiManager.parseImageReferences(message);
						getLogger().log(`🔍 parseImageReferences returned:`, imageReferences);
						
						if (imageReferences.length > 0) {
							getLogger().log(`📸 Found ${imageReferences.length} image references in text message`);
							
							// Extract images and convert to data URLs for AI
							for (const imgRef of imageReferences) {
								getLogger().log(`🔍 Processing image reference:`, imgRef);
								const imageDataUrl = await this.aiManager.resolveImageForAPI(imgRef.path);
								if (imageDataUrl) {
									currentImages.push(imageDataUrl);
									getLogger().log(`✅ Resolved image reference: ${imgRef.path}`);
								} else {
									getLogger().warn(`❌ Failed to resolve image reference: ${imgRef.path}`);
								}
							}
							
							// Remove image markdown from the text that will be sent to AI
							// (but keep original message intact for user display)
							messageForAI = message;
							imageReferences.forEach(imgRef => {
								const imgMarkdown = `![${imgRef.alt}](${imgRef.path})`;
								messageForAI = messageForAI.replace(imgMarkdown, '').trim();
							});
							// Clean up extra whitespace
							messageForAI = messageForAI.replace(/\n\s*\n/g, '\n\n').trim();
							
							getLogger().log(`🧹 Original message: "${message}"`);
							getLogger().log(`🧹 Message for AI: "${messageForAI}"`);
							getLogger().log(`📸 Total images for AI: ${currentImages.length}`);
						} else {
							getLogger().log(`ℹ️ No image references found in message`);
						}
					} else {
						getLogger().log(`⚠️ Skipping image reference check because message=${!!message}, isVisionCapable=${isVisionCapable}`);
					}
					
					// Build messages for AI using the cleaned message content
					messagesToSend = await this.aiManager.buildContextMessages(
						conversation, 
						messageForAI, // Use cleaned message for AI
						currentImages, 
						currentModel, 
						true
					);
					
					getLogger().log(`📋 Built ${messagesToSend.length} messages for AI, currentImages count: ${currentImages.length}`);
				}

				// Create and add user message to conversation (using ORIGINAL message with full content for display)
				const userMessage = await this.createUserMessage(message, imageDataList);
				conversation.messages.push(userMessage);
				
				// 使用MessageRenderManager增量添加用户消息
				await this.messageRenderer.appendMessage(userMessage);

				// Clear image preview after message is created (releases preview references)
				if (imageDataList.length > 0) {
					this.clearImagePreview(inputArea);
				}

				// If send-only, we're done
				if (sendOnly) {
					// Reset auto-save content tracking
					this.lastAutoSaveContent = null;
					// Restart auto-save timer for the conversation with new content
					this.startAutoSaveTimer();
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
				
				// 使用MessageRenderManager增量添加typing指示器
				await this.messageRenderer.appendMessage(typingMessage);

				// Send to AI and get response
				const response = await this.aiManager.sendPreBuiltMessagesToAI(messagesToSend, currentModel);

				// Remove typing indicator from conversation data
				const typingIndex = conversation.messages.findIndex(m => m.hasOwnProperty('isTyping'));
				if (typingIndex > -1) {
					conversation.messages.splice(typingIndex, 1);
				}

				// Add AI response
				const assistantMessage = this.createAssistantMessage(response);
				conversation.messages.push(assistantMessage);
				
				// 使用MessageRenderManager替换typing为实际回复
				await this.messageRenderer.replaceMessage(typingMessage.id, assistantMessage);

				// Reset auto-save content tracking since conversation content changed
				this.lastAutoSaveContent = null;
				
				// Restart auto-save timer for the conversation with new content
				this.startAutoSaveTimer();

			} catch (error) {
				getLogger().error('Failed to send message:', error);
				
				// Handle error by showing error message instead of removing everything
				const conversation = this.aiManager.getCurrentConversationData();
				if (conversation && !sendOnly) {
					// Find typing indicator and replace it with error message
					const typingIndex = conversation.messages.findIndex(m => m.hasOwnProperty('isTyping'));
					if (typingIndex > -1) {
						const typingMsg = conversation.messages[typingIndex];
						
						// Create error message to replace typing indicator
						const errorMessage = this.createAssistantMessage(`❌ Error: ${error.message}`);
						conversation.messages[typingIndex] = errorMessage; // Replace in conversation
						
						// Use MessageRenderManager to replace typing with error message
						await this.messageRenderer.replaceMessage(typingMsg.id, errorMessage);
					} else {
						// If no typing indicator found, add error message normally
						const errorMessage = this.createAssistantMessage(`❌ Error: ${error.message}`);
						conversation.messages.push(errorMessage);
						await this.messageRenderer.appendMessage(errorMessage);
					}
				}
				
				// Don't restore text input on error - let user see what they sent
				// textInput.value = message; // Removed this line
				
				// Error notice is now shown in the chat, so we can make this less intrusive
				new Notice(`Request failed: ${error.message}`);
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
					// 检查文件类型
					if (!this.isValidImageFile(file)) {
						new Notice(`不支持的文件类型: ${file.name}。只支持图片文件。`);
						return;
					}
					
					// 检查文件大小
					if (!this.isValidImageSize(file)) {
						new Notice(`文件过大: ${file.name} (${this.formatFileSize(file.size)})，最大支持 ${this.formatFileSize(AIChatView.MAX_IMAGE_SIZE)}`);
						return;
					}
					
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
			const imageItem = imagesGrid.createEl('div', { 
				cls: 'preview-image-item',
				attr: { 
					'data-image-id': imageData.id,  // 添加唯一标识
					'data-image-source': imageData.source || 'unknown'
				}
			});
			
			// 添加调试日志
			getLogger().log('🖼️ Rendering image preview:', {
				id: imageData.id,
				fileName: imageData.fileName,
				source: imageData.source,
				hasLocalPath: !!imageData.localPath,
				hasTempId: !!imageData.tempId,
				index: index
			});
			
			const img = imageItem.createEl('img', { 
				cls: 'preview-image-thumb',
				attr: { 
					src: imageData.dataUrl, 
					alt: imageData.fileName,
					'data-image-id': imageData.id  // 图片元素也添加ID
				}
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
		
		getLogger().log('📸 Adding image to preview:', { fileName, source, localPath, currentCount: imageDataList.length });
		
		// 生成随机唯一ID - 简单有效
		const uniqueId = `img_${Math.random().toString(36).substr(2, 12)}`;
		
		// 创建图片数据对象
		let newImageData;
		
		if (localPath) {
			// 有本地路径的图片 - 直接使用路径，不需要通过ImageReferenceManager
			newImageData = { 
				dataUrl, 
				fileName, 
				id: uniqueId,
				localPath: localPath,
				source: source,
				imageRef: localPath  // 保存的图片使用文件路径作为引用
			};
			getLogger().log('✅ Created saved image data:', { id: uniqueId, fileName, localPath });
		} else {
			// 临时图片 - 通过ImageReferenceManager管理
			const tempId = this.aiManager.getImageReferenceManager().addTempImage(dataUrl, source, fileName);
			newImageData = { 
				dataUrl, 
				fileName, 
				id: uniqueId,
				localPath: localPath || null,
				source: source,
				tempId: tempId,  // 存储临时图片ID
				imageRef: `temp:${tempId}`  // 临时图片使用temp:协议引用
			};
			getLogger().log('✅ Created temp image data:', { id: uniqueId, tempId, source, fileName });
		}
		
		imageDataList.push(newImageData);
		inputData.currentImageDataList = imageDataList;
		this.inputAreaElements.set(inputArea, inputData);
		
		getLogger().log('🔄 Updated image data list:', { 
			totalImages: imageDataList.length, 
			imageIds: imageDataList.map(img => ({ id: img.id, fileName: img.fileName, source: img.source }))
		});
		
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
				if (img.localPath && img.localPath.trim()) {
					// 保存的图片 - 使用文件路径，alt显示来源类型
					imageReferences.push(`![${img.source}](${img.localPath})`);
					getLogger().log(`📝 Added saved image reference: ![${img.source}](${img.localPath})`);
				} else if (img.tempId) {
					// 临时图片 - 使用source作为alt文本
					imageReferences.push(`![${img.source}](temp:${img.tempId})`);
					getLogger().log(`📝 Added temp image reference: ![${img.source}](temp:${img.tempId})`);
				} else {
					getLogger().warn(`⚠️ Image ignored - no localPath or tempId:`, {
						fileName: img.fileName,
						source: img.source,
						hasLocalPath: !!img.localPath,
						hasTempId: !!img.tempId
					});
				}
			}
			
			// Combine text and image references
			finalContent = imageReferences.join('\n') + (textContent ? '\n\n' + textContent : '');
			getLogger().log(`📝 Final message content: ${finalContent}`);
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
			timestamp: new Date(),
			includeInContext: true // 默认参与上下文构建
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
			timestamp: new Date(),
			includeInContext: true // 默认参与上下文构建
		};

		return message;
	}

	private clearImagePreview(inputArea: HTMLElement): void {
		const inputData = this.inputAreaElements.get(inputArea);
		if (!inputData || !inputData.imagePreviewArea) return;
		
		// 减少预发送区所有临时图片的引用计数（预发送区释放引用）
		const imageDataList = inputData.currentImageDataList || [];
		
		getLogger().log('🧹 Clearing image preview:', {
			totalImages: imageDataList.length,
			images: imageDataList.map(img => ({
				id: img.id,
				fileName: img.fileName,
				hasTempId: !!img.tempId,
				hasLocalPath: !!img.localPath,
				source: img.source
			}))
		});
		
		imageDataList.forEach(imageData => {
			if (imageData.tempId) {
				getLogger().log(`🔄 Removing ref for temp image: ${imageData.tempId}`);
				this.aiManager.getImageReferenceManager().removeRef(imageData.tempId);
			} else {
				getLogger().log(`ℹ️ Skipping ref removal for non-temp image:`, {
					fileName: imageData.fileName,
					source: imageData.source,
					hasLocalPath: !!imageData.localPath
				});
			}
		});
		
		// 清理UI显示
		inputData.imagePreviewArea.style.display = 'none';
		inputData.imagePreviewArea.empty();
		inputData.currentImageDataList = [];
		this.inputAreaElements.set(inputArea, inputData);
		
		getLogger().log('✅ Image preview cleared');
	}

	// 拖拽限制常量
	private static readonly MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB
	private static readonly ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml'];
	private static readonly ALLOWED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];

	/**
	 * 检查文件是否为允许的图片类型
	 */
	private isValidImageFile(file: File): boolean {
		const hasValidType = AIChatView.ALLOWED_IMAGE_TYPES.includes(file.type.toLowerCase());
		const hasValidExtension = AIChatView.ALLOWED_IMAGE_EXTENSIONS.some(ext => 
			file.name.toLowerCase().endsWith(ext)
		);
		return hasValidType || hasValidExtension;
	}

	/**
	 * 检查文件大小是否合法
	 */
	private isValidImageSize(file: File): boolean {
		return file.size <= AIChatView.MAX_IMAGE_SIZE;
	}

	/**
	 * 格式化文件大小显示
	 */
	private formatFileSize(bytes: number): string {
		if (bytes === 0) return '0 Bytes';
		const k = 1024;
		const sizes = ['Bytes', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
	}

	/**
	 * 获取输入文本框元素
	 */
	private getTextInputElement(inputArea: HTMLElement): HTMLTextAreaElement | null {
		const inputData = this.inputAreaElements.get(inputArea);
		return inputData?.textInput || null;
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

			// 调试：打印数据类型（保留用于问题排查）
			getLogger().log('=== Drag Drop Debug Info ===');
			getLogger().log('Available types:', e.dataTransfer.types);
			getLogger().log('Files count:', e.dataTransfer.files.length);
			getLogger().log('=== End Debug Info ===');

			// 获取文本输入框
			const textInput = this.getTextInputElement(inputArea);
			
			let hasProcessedData = false;
			let processedImages = 0;
			let skippedFiles = 0;

			// 1. 优先处理文件拖拽（最可靠）
			const files = e.dataTransfer.files;
			if (files && files.length > 0) {
				getLogger().log('Processing file drops:', files.length, 'files');
				const validImages: File[] = [];
				const invalidFiles: {file: File, reason: string}[] = [];

				// 验证所有文件
				for (const file of Array.from(files)) {
					if (!this.isValidImageFile(file)) {
						invalidFiles.push({file, reason: '不支持的文件类型'});
						continue;
					}
					
					if (!this.isValidImageSize(file)) {
						invalidFiles.push({
							file, 
							reason: `文件过大 (${this.formatFileSize(file.size)})，最大支持 ${this.formatFileSize(AIChatView.MAX_IMAGE_SIZE)}`
						});
						continue;
					}
					
					validImages.push(file);
				}

				// 处理无效文件
				if (invalidFiles.length > 0) {
					const errorMsg = invalidFiles.map(({file, reason}) => 
						`${file.name}: ${reason}`
					).join('\n');
					new Notice(`以下文件无法处理:\n${errorMsg}`, 5000);
					skippedFiles = invalidFiles.length;
				}

				// 处理有效图片
				try {
					for (const file of validImages) {
						const dataUrl = await this.fileToDataUrl(file);
						this.showImagePreview(dataUrl, file.name, null, 'external');
						processedImages++;
						hasProcessedData = true;
					}
				} catch (error) {
					getLogger().error('Failed to process dropped images:', error);
					new Notice(`处理图片失败: ${error.message}`);
				}
			}

			// 2. 如果没有文件，处理文本数据
			if (!hasProcessedData) {
				const draggedText = e.dataTransfer.getData('text/plain');
				if (draggedText && draggedText.trim()) {
					getLogger().log('Processing text data');
					
					// 检查是否为 Obsidian vault 文件引用
					if (draggedText.startsWith('[[') || draggedText.includes('obsidian://')) {
						const filePath = this.extractFilePathFromDragData(draggedText);
						if (filePath) {
							const vault = this.plugin.app.vault;
							const abstractFile = vault.getAbstractFileByPath(filePath);
							
							if (abstractFile && abstractFile instanceof TFile) {
								const isImageFile = AIChatView.ALLOWED_IMAGE_EXTENSIONS.some(ext => 
									abstractFile.extension.toLowerCase() === ext.substring(1)
								);
								
								if (isImageFile) {
									if (abstractFile.stat.size > AIChatView.MAX_IMAGE_SIZE) {
										new Notice(`文件过大: ${abstractFile.name} (${this.formatFileSize(abstractFile.stat.size)})，最大支持 ${this.formatFileSize(AIChatView.MAX_IMAGE_SIZE)}`);
										return;
									}
									
									const dataUrl = await this.fileToDataUrl(await this.getFileFromVault(abstractFile));
									this.showImagePreview(dataUrl, abstractFile.name, filePath, 'vault');
									processedImages++;
									hasProcessedData = true;
									getLogger().log('Processed vault image file:', filePath);
								} else {
									new Notice(`不支持的文件类型: ${abstractFile.extension}。只支持图片文件。`);
									return;
								}
							}
						}
					} 
					// 其他所有情况都作为纯文本处理
					else {
						if (textInput) {
							const currentValue = textInput.value;
							const newValue = currentValue ? `${currentValue}\n${draggedText.trim()}` : draggedText.trim();
							textInput.value = newValue;
							textInput.focus();
							textInput.setSelectionRange(newValue.length, newValue.length);
							hasProcessedData = true;
							getLogger().log('Processed as pure text:', draggedText.substring(0, 50) + '...');
						}
					}
				}
			}

			// 3. 显示处理结果
			if (hasProcessedData) {
				let message = '';
				if (processedImages > 0) {
					message = `已添加 ${processedImages} 张图片到待发送区`;
				} else {
					message = '已插入文本到输入框';
				}
				
				if (skippedFiles > 0) {
					message += ` (跳过 ${skippedFiles} 个文件)`;
				}
				
				if (message) {
					new Notice(message);
				}
			} else {
				new Notice('未找到可处理的内容。支持：图片文件拖拽、纯文本拖拽。');
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
			const saveLocation = this.plugin.settings.otherSourceImageLocation || 'captureai-folder/othersourceimage';
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
			const timestamp = formatTimestampForFilename();
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



	// renderMarkdown方法已移动到MessageRenderManager中


	private formatTime(date: Date): string {
		return formatDisplayTime(date);
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
		
		// Only start timer if auto-save is enabled
		if (!this.plugin.settings.autoSaveConversations) {
			return;
		}
		
		const conversation = this.aiManager.getCurrentConversationData();
		
		// Set up periodic auto-save - start timer even for empty conversations
		// The actual auto-save will check if there's content to save
		this.autoSaveTimer = setInterval(() => {
			this.performPeriodicAutoSave();
		}, this.autoSaveInterval);
		
		getLogger().log('Auto-save timer started for conversation:', conversation?.id || 'new conversation');
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
			const autoSaveLocation = this.plugin.settings.autoSavedConversationLocation || 'captureai-folder/autosavedconversations';

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
				conversation.id.replace('loaded_', '') : conversation.id;

			// Convert temp images to vault files and get processed conversation
			const processedConversation = await this.convertTempImagesToVaultFiles(conversation);
			
			// Generate markdown content for manual save
			const markdownContent = await this.generateConversationMarkdown(processedConversation, 'manual');

			// Get save location from settings
			const saveLocation = this.plugin.settings.conversationSaveLocation || 'captureai-folder/conversations';

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
			// 同时更新conversation ID（去掉loaded_前缀）
			processedConversation.id = conversationId;
			this.aiManager.updateConversationInMemory(conversationId, processedConversation);
			
			// 更新当前跟踪的conversation ID用于自动保存
			this.currentConversationId = conversationId;
			
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
			const autoSaveLocation = this.plugin.settings.autoSavedConversationLocation || 'captureai-folder/autosavedconversations';
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
			
			// Use MessageRenderManager to process temp: protocols
			if (message.content && message.content.includes('temp:')) {
				processedMessage.content = this.messageRenderer.processContentTempProtocolsWithReplacer(
					message.content,
					(tempData, alt, tempId) => {
						// Replace temp: reference with data URL, using real source for alt text
						return `![${tempData.source}](${tempData.dataUrl})`;
					}
				);
			}
			
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
		const conversationSaveLocation = this.plugin.settings.conversationSaveLocation || 'captureai-folder/conversations';
		const otherSourceLocation = this.plugin.settings.otherSourceImageLocation || 'captureai-folder/othersourceimage';
		const screenshotSaveLocation = this.plugin.settings.defaultSaveLocation || 'captureai-folder/savedscreenshots';
		
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
			
			// Process temp: references using MessageRenderManager
			if (message.content && message.content.includes('temp:')) {
				const tempReferences = this.messageRenderer.parseTempImageReferences(message.content);
				let updatedContent = message.content;
				
				for (const ref of tempReferences) {
					if (ref.tempData) {
						try {
							// Choose target folder based on source
							let targetFolder: string;
							if (ref.tempData.source === 'external') {
								targetFolder = otherSourceLocation;
							} else if (ref.tempData.source === 'screenshot') {
								targetFolder = screenshotSaveLocation;
							} else {
								// For other sources, use conversation images folder
								targetFolder = conversationImageFolder;
							}
							
							// Save image to vault
							const savedImagePath = await this.saveTempImageToVault(ref.tempId, ref.tempData.dataUrl, targetFolder);
							
							// Replace temp: reference with vault file path, using real source for alt text
							const markdownImage = `![${ref.tempData.source}](${savedImagePath})`;
							updatedContent = updatedContent.replace(ref.fullMatch, markdownImage);
						} catch (error) {
							getLogger().error(`Failed to save temporary image ${ref.tempId}:`, error);
							// Keep the original reference if saving fails
						}
					} else {
						getLogger().warn(`Temp image not found for ID: ${ref.tempId}`);
					}
				}
				
				processedMessage.content = updatedContent;
			}
			
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
		const timestamp = formatTimestampForFilename();
		
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
			conversation.id.replace('loaded_', '') : conversation.id;
		
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
		const currentTime = formatLocalDateTime(new Date());
		const createdTime = conversation.createdAt ? formatLocalDateTime(conversation.createdAt) : currentTime;
		
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
			
			// Message header with BestNote format including timestamp and includeInContext info
			const includeInContextInfo = message.includeInContext !== false ? 'true' : 'false';
			markdown += `${messageType}: <!-- ${formatLocalDateTime(message.timestamp)}|includeInContext:${includeInContextInfo} -->\n`;
			
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
			
			// Set the conversation ID to match the original loaded conversation
			// This ensures proper file saving and updating
			newConversation.id = conversation.id;
			
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
					timestamp: message.timestamp, // Preserve original timestamp
					includeInContext: message.includeInContext // Preserve includeInContext setting
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

			// Reset MessageRenderManager for loaded conversation
			this.messageRenderer.resetForNewConversation();

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
		const saveLocation = this.plugin.settings.conversationSaveLocation || 'captureai-folder/conversations';
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
				
				// Re-render the message content area directly using MessageRenderManager
				messageContent.empty();
				await this.messageRenderer.renderMessageContentFromMarkdown(messageContent, message);
				
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
	// renderMessageContentFromMarkdown方法已移动到MessageRenderManager中


	/**
	 * 渲染图片（统一处理）
	 */
	// renderImage方法已移动到MessageRenderManager中

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

		// Process temp: references using MessageRenderManager
		let updatedContent = content;
		if (content.includes('temp:')) {
			const tempReferences = this.messageRenderer.parseTempImageReferences(content);
			
			for (const ref of tempReferences) {
				if (ref.tempData) {
					try {
						// Save image to attachments folder
						const savedImagePath = await this.saveTempImageToAttachments(ref.tempId, ref.tempData.dataUrl, attachmentsFolder);
						
						// Replace temp: reference with local file path
						const markdownImage = `![${ref.tempData.source}](${savedImagePath})`;
						updatedContent = updatedContent.replace(ref.fullMatch, markdownImage);
					} catch (error) {
						getLogger().error(`Failed to save temporary image ${ref.tempId}:`, error);
						// Keep the original reference if saving fails
					}
				}
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
		const timestamp = formatTimestampForFilename();
		
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
				
				// 使用MessageRenderManager移除消息
				await this.messageRenderer.removeMessage(messageId);
				
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
			
			// Remove the default modal header by clearing it
			modal.titleEl.empty();
			modal.titleEl.style.display = 'none';
			
			modal.contentEl.className = 'ai-chat-modal-content';
			
			// Title
			const title = modal.contentEl.createEl('h3', { 
				text: t('aiChat.deleteMessageButton'),
				cls: 'ai-chat-modal-title'
			});
			
			// Message preview
			const isUserMessage = message.type === 'user';
			const messagePreview = (message.content || t('aiChat.imageMessage')).substring(0, 100);
			const truncated = messagePreview.length < (message.content || '').length;
			
			const description = modal.contentEl.createEl('p', {
				text: t('aiChat.confirmDeleteMessage', { 
					messageType: isUserMessage ? t('aiChat.user') : t('aiChat.ai') 
				}),
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
				text: t('ui.cancel'),
				cls: 'ai-chat-modal-button-cancel'
			});
			
			// Delete button
			const deleteBtn = buttonContainer.createEl('button', { 
				text: t('ui.delete'),
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