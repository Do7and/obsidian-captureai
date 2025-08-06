import { Modal, Notice, TFile } from 'obsidian';
import ImageCapturePlugin from '../main';
import { AIConversation } from '../ai/ai-manager';
import { t } from '../i18n';

interface ConversationHistoryItem {
	file: TFile;
	title: string;
	lastModified: Date;
	isAutoSaved: boolean;
	conversation?: AIConversation;
}

export class ChatHistoryModal extends Modal {
	private plugin: ImageCapturePlugin;
	private onSelect: (conversation: AIConversation) => void;

	constructor(plugin: ImageCapturePlugin, onSelect: (conversation: AIConversation) => void) {
		super(plugin.app);
		this.plugin = plugin;
		this.onSelect = onSelect;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('chat-history-modal');

		// Set modal size to be more responsive
		this.modalEl.style.cssText = `
			width: min(90vw, 1000px) !important;
			height: min(80vh, 700px) !important;
			max-width: 1000px !important;
			max-height: 700px !important;
		`;

		// Title
		const titleEl = contentEl.createEl('h2', { text: t('ui.chatHistory') });
		titleEl.style.cssText = 'margin-bottom: 20px; text-align: center;';

		// Main container
		const mainContainer = contentEl.createEl('div', { cls: 'chat-history-container' });
		mainContainer.style.cssText = `
			display: flex;
			flex-direction: column;
			height: 100%;
			width: 100%;
			gap: 16px;
			box-sizing: border-box;
		`;

		// Auto-saved conversations section
		const autoSavedSection = mainContainer.createEl('div', { cls: 'history-section' });
		autoSavedSection.style.cssText = `
			flex: 1;
			border: 1px solid var(--background-modifier-border);
			border-radius: 8px;
			padding: 12px;
			background: var(--background-secondary);
		`;

		const autoSavedTitle = autoSavedSection.createEl('h3', { text: t('ui.autoSavedConversations') });
		autoSavedTitle.style.cssText = 'margin: 0 0 12px 0; color: var(--text-normal);';

		const autoSavedList = autoSavedSection.createEl('div', { cls: 'conversation-list' });
		autoSavedList.style.cssText = `
			max-height: 300px;
			overflow-y: auto;
			overflow-x: hidden;
			display: flex;
			flex-direction: column;
			gap: 8px;
			padding-right: 8px;
			box-sizing: border-box;
		`;

		// Manually saved conversations section
		const manualSavedSection = mainContainer.createEl('div', { cls: 'history-section' });
		manualSavedSection.style.cssText = `
			flex: 1;
			border: 1px solid var(--background-modifier-border);
			border-radius: 8px;
			padding: 12px;
			background: var(--background-secondary);
		`;

		const manualSavedTitle = manualSavedSection.createEl('h3', { text: 'Manually Saved Conversations' });
		manualSavedTitle.style.cssText = 'margin: 0 0 12px 0; color: var(--text-normal);';

		const manualSavedList = manualSavedSection.createEl('div', { cls: 'conversation-list' });
		manualSavedList.style.cssText = `
			max-height: 300px;
			overflow-y: auto;
			overflow-x: hidden;
			display: flex;
			flex-direction: column;
			gap: 8px;
			padding-right: 8px;
			box-sizing: border-box;
		`;

		// Load and display conversations
		this.loadConversations(autoSavedList, manualSavedList);


		// Add custom styles
		this.addModalStyles();
	}

	private async loadConversations(autoSavedList: HTMLElement, manualSavedList: HTMLElement) {
		try {
			const vault = this.plugin.app.vault;
			const autoSaveLocation = this.plugin.settings.autoSavedConversationLocation || 'screenshots-capture/autosavedconversations';
			const manualSaveLocation = this.plugin.settings.conversationSaveLocation || 'screenshots-capture/conversations';

			// Get all markdown files
			const allFiles = vault.getMarkdownFiles();

			// Filter auto-saved conversations
			const autoSavedFiles = allFiles.filter(file => 
				file.path.startsWith(autoSaveLocation) && file.name.startsWith('auto-saved-')
			);

			// Filter manually saved conversations
			const manualSavedFiles = allFiles.filter(file => 
				file.path.startsWith(manualSaveLocation) && 
				(file.name.startsWith('ai-conversation-') || !file.name.startsWith('auto-saved-'))
			);

			// Sort by modification time (newest first)
			autoSavedFiles.sort((a, b) => b.stat.mtime - a.stat.mtime);
			manualSavedFiles.sort((a, b) => b.stat.mtime - a.stat.mtime);

			// Display auto-saved conversations
			if (autoSavedFiles.length === 0) {
				const emptyMsg = autoSavedList.createEl('div', { text: 'No auto-saved conversations found' });
				emptyMsg.style.cssText = 'color: var(--text-muted); font-style: italic; text-align: center; padding: 20px;';
			} else {
				for (const file of autoSavedFiles.slice(0, 20)) { // Limit to 20 most recent
					await this.createConversationItem(autoSavedList, file, true);
				}
			}

			// Display manually saved conversations
			if (manualSavedFiles.length === 0) {
				const emptyMsg = manualSavedList.createEl('div', { text: 'No manually saved conversations found' });
				emptyMsg.style.cssText = 'color: var(--text-muted); font-style: italic; text-align: center; padding: 20px;';
			} else {
				for (const file of manualSavedFiles.slice(0, 20)) { // Limit to 20 most recent
					await this.createConversationItem(manualSavedList, file, false);
				}
			}
		} catch (error: any) {
			console.error('Failed to load conversations:', error);
			const errorMsg = autoSavedList.createEl('div', { text: `Error loading conversations: ${error.message}` });
			errorMsg.style.cssText = 'color: var(--text-error); text-align: center; padding: 20px;';
		}
	}

	private async createConversationItem(container: HTMLElement, file: TFile, isAutoSaved: boolean) {
		try {
			// Read the file content to extract conversation info
			const content = await this.plugin.app.vault.read(file);
			
			// Extract title from content (look for # AI Conversation or first header)
			const titleMatch = content.match(/^# (.+)$/m);
			const title = titleMatch ? titleMatch[1] : file.basename;
			
			// Extract creation date from content if available
			const createdMatch = content.match(/\*\*Created:\*\* (.+)/);
			const lastModified = new Date(file.stat.mtime);
			
			// Create conversation item
			const item = container.createEl('div', { cls: 'conversation-item' });
			item.style.cssText = `
				padding: 12px;
				border: 1px solid var(--background-modifier-border);
				border-radius: 6px;
				cursor: pointer;
				transition: background-color 0.2s;
				background: var(--background-primary);
				word-wrap: break-word;
				overflow-wrap: break-word;
				max-width: 100%;
				box-sizing: border-box;
			`;

			// Title
			const titleEl = item.createEl('div', { text: title });
			titleEl.style.cssText = `
				font-weight: 600; 
				margin-bottom: 4px; 
				color: var(--text-normal);
				word-wrap: break-word;
				overflow-wrap: break-word;
				white-space: normal;
				line-height: 1.3;
			`;

			// Metadata
			const metaEl = item.createEl('div');
			metaEl.style.cssText = `
				font-size: 12px; 
				color: var(--text-muted); 
				display: flex; 
				justify-content: space-between;
				flex-wrap: wrap;
				gap: 8px;
			`;
			
			const dateEl = metaEl.createEl('span', { text: lastModified.toLocaleString() });
			const typeEl = metaEl.createEl('span', { text: isAutoSaved ? 'Auto-saved' : 'Manual' });
			
			if (isAutoSaved) {
				typeEl.style.cssText = 'color: var(--text-accent);';
			}

			// Extract first few lines of conversation content for preview
			const previewMatch = content.match(/## 👤 \*\*User\*\*[\s\S]*?\n\n(.*?)(\n|$)/);
			if (previewMatch && previewMatch[1]) {
				const previewEl = item.createEl('div', { text: previewMatch[1].substring(0, 100) + (previewMatch[1].length > 100 ? '...' : '') });
				previewEl.style.cssText = 'font-size: 11px; color: var(--text-muted); margin-top: 6px; line-height: 1.3;';
			}

			// Hover effect
			item.addEventListener('mouseenter', () => {
				item.style.background = 'var(--background-modifier-hover)';
			});
			item.addEventListener('mouseleave', () => {
				item.style.background = 'var(--background-primary)';
			});

			// Click handler to load conversation
			item.addEventListener('click', async () => {
				try {
					const conversation = await this.parseConversationFromMarkdown(content, file.basename);
					if (conversation) {
						this.onSelect(conversation);
						this.close();
						new Notice(`✅ Loaded conversation: ${title}`);
					} else {
						new Notice('❌ Failed to parse conversation');
					}
				} catch (error: any) {
					console.error('Failed to load conversation:', error);
					new Notice(`❌ Failed to load conversation: ${error.message}`);
				}
			});

		} catch (error: any) {
			console.error('Failed to create conversation item:', error);
		}
	}

	private async parseConversationFromMarkdown(content: string, filename: string): Promise<AIConversation | null> {
		try {
			// Create a new conversation object
			const conversation: AIConversation = {
				id: 'loaded_' + Date.now(),
				title: filename.replace(/\.(md|txt)$/, ''),
				messages: [],
				createdAt: new Date(),
				lastUpdated: new Date()
			};

			// Extract title from content
			const titleMatch = content.match(/\*\*Title:\*\* (.+)/);
			if (titleMatch) {
				conversation.title = titleMatch[1];
			}

			// Parse messages using regex to find message blocks
			const messageBlocks = content.split(/## (👤 \*\*User\*\*|🤖 \*\*AI Assistant\*\*)/);
			
			for (let i = 1; i < messageBlocks.length; i += 2) {
				const sender = messageBlocks[i];
				const messageContent = messageBlocks[i + 1];
				
				if (!messageContent) continue;

				const isUser = sender.includes('User');
				const messageId = 'loaded_' + Date.now() + '_' + i;

				// Extract timestamp
				const timeMatch = messageContent.match(/\((\d{1,2}:\d{2}:\d{2}[^)]*)\)/);
				const timestamp = timeMatch ? new Date() : new Date(); // Use current time as fallback

				// Extract content (remove timestamp line and separators)
				let textContent = messageContent
					.replace(/^\s*\([^)]+\)\s*\n\n/, '') // Remove timestamp line
					.replace(/\n---\s*\n*$/, '') // Remove separator at end
					.trim();

				// Extract images and try to load them
				let imageDataUrl: string | null = null;
				let imageData: any = null;
				let allImages: any[] = [];
				const imageMatches = textContent.match(/!\[([^\]]*)\]\(([^)]+)\)/g);
				
				if (imageMatches) {
					console.log('Found images in message:', imageMatches);
					
					// Process each image
					for (const match of imageMatches) {
						const imageMatch = match.match(/!\[([^\]]*)\]\(([^)]+)\)/);
						if (imageMatch) {
							const altText = imageMatch[1];
							const imagePath = imageMatch[2];
							
							// Try to load the image from vault if it's a local path
							if (!imagePath.startsWith('data:') && !imagePath.startsWith('http')) {
								try {
									const vault = this.plugin.app.vault;
									const file = vault.getAbstractFileByPath(imagePath);
									if (file) {
										// Store the local path and create image info
										const imageInfo = {
											localPath: imagePath,
											fileName: altText || file.name,
											dataUrl: null // Will be loaded later by AI chat view
										};
										allImages.push(imageInfo);
										
										// Set the first image as the main image
										if (!imageDataUrl) {
											imageDataUrl = imagePath; // Use path as placeholder
											imageData = imageInfo;
										}
									} else {
										console.warn('Image file not found in vault:', imagePath);
										// Still add the image info even if file not found, for fallback handling
										const imageInfo = {
											localPath: imagePath,
											fileName: altText || imagePath.split('/').pop() || 'image',
											dataUrl: null
										};
										allImages.push(imageInfo);
										
										if (!imageDataUrl) {
											imageDataUrl = imagePath;
											imageData = imageInfo;
										}
									}
								} catch (error) {
									console.warn('Could not load image from path:', imagePath, error);
									// Add image info for fallback handling
									const imageInfo = {
										localPath: imagePath,
										fileName: altText || imagePath.split('/').pop() || 'image',
										dataUrl: null
									};
									allImages.push(imageInfo);
									
									if (!imageDataUrl) {
										imageDataUrl = imagePath;
										imageData = imageInfo;
									}
								}
							} else {
								// Handle data URLs or external URLs
								const imageInfo = {
									localPath: null,
									fileName: altText,
									dataUrl: imagePath.startsWith('data:') ? imagePath : null
								};
								allImages.push(imageInfo);
								
								if (!imageDataUrl) {
									imageDataUrl = imagePath;
									imageData = imageInfo;
								}
							}
						}
					}
				}

				// Remove image markdown from text content for cleaner text
				textContent = textContent.replace(/!\[[^\]]*\]\([^)]+\)\s*/g, '').trim();
				
				// Remove image filename lines
				textContent = textContent.replace(/^\*[^*]+\*\s*$/gm, '').trim();

				// Skip empty messages
				if (!textContent && !imageDataUrl) continue;

				const message = {
					id: messageId,
					type: isUser ? 'user' as const : 'assistant' as const,
					content: textContent,
					timestamp: timestamp
				};

				if (imageDataUrl) {
					(message as any).image = imageDataUrl;
					
					// Store image data for proper restoration
					if (imageData) {
						(message as any).imageData = imageData;
					}
					
					// Store all images if multiple
					if (allImages.length > 0) {
						(message as any).images = allImages;
					}
				}

				conversation.messages.push(message);
			}

			return conversation.messages.length > 0 ? conversation : null;

		} catch (error: any) {
			console.error('Failed to parse conversation from markdown:', error);
			return null;
		}
	}

	private addModalStyles() {
		if (!document.getElementById('chat-history-modal-styles')) {
			const style = document.createElement('style');
			style.id = 'chat-history-modal-styles';
			style.textContent = `
				.chat-history-modal .modal-content {
					padding: 20px;
					max-width: 800px;
					max-height: 80vh;
				}
				
				.conversation-item:hover {
					background: var(--background-modifier-hover) !important;
				}
				
				.conversation-list::-webkit-scrollbar {
					width: 8px;
				}
				
				.conversation-list::-webkit-scrollbar-track {
					background: var(--background-secondary);
				}
				
				.conversation-list::-webkit-scrollbar-thumb {
					background: var(--background-modifier-border);
					border-radius: 4px;
				}
				
				.conversation-list::-webkit-scrollbar-thumb:hover {
					background: var(--background-modifier-border-hover);
				}
			`;
			document.head.appendChild(style);
		}
	}

	onClose() {
		// Reset modal styles to prevent affecting other modals
		this.modalEl.style.cssText = '';
		
		const { contentEl } = this;
		contentEl.empty();
		contentEl.removeClass('chat-history-modal');
	}
}