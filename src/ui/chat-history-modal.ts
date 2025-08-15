import { Modal, Notice, TFile } from 'obsidian';
import ImageCapturePlugin from '../main';
import { AIConversation } from '../ai/ai-manager';
import { t } from '../i18n';
import { getLogger } from '../utils/logger';

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
		this.modalEl.addClass('chat-history-modal-responsive');

		// Create fixed header modal structure
		contentEl.addClass('modal-with-fixed-header');
		
		// Create fixed header
		const headerEl = contentEl.createEl('div', { cls: 'modal-fixed-header' });
		
		// Title in header
		const titleEl = headerEl.createEl('h2', { text: t('ui.chatHistory'), cls: 'chat-history-title' });

		// Create scrollable content area
		const scrollableContent = contentEl.createEl('div', { cls: 'modal-scrollable-content' });
		
		// Main container (now in scrollable area)
		const mainContainer = scrollableContent.createEl('div', { cls: 'chat-history-container' });

		// Auto-saved conversations section
		const autoSavedSection = mainContainer.createEl('div', { cls: 'chat-history-section' });

		const autoSavedTitle = autoSavedSection.createEl('h3', { text: t('ui.autoSavedConversations'), cls: 'chat-history-section-title' });

		const autoSavedList = autoSavedSection.createEl('div', { cls: 'chat-history-list' });

		// Manually saved conversations section
		const manualSavedSection = mainContainer.createEl('div', { cls: 'chat-history-section' });

		const manualSavedTitle = manualSavedSection.createEl('h3', { text: 'Manually Saved Conversations', cls: 'chat-history-section-title' });

		const manualSavedList = manualSavedSection.createEl('div', { cls: 'chat-history-list' });

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

			// Filter auto-saved conversations (support both old and new timestamp formats)
			const autoSavedFiles = allFiles.filter(file => 
				file.path.startsWith(autoSaveLocation) && 
				(file.name.startsWith('auto-saved-') || file.name.includes('_auto-saved-'))
			);

			// Filter manually saved conversations
			const manualSavedFiles = allFiles.filter(file => 
				file.path.startsWith(manualSaveLocation) && 
				(file.name.startsWith('ai-conversation-') || (!file.name.startsWith('auto-saved-') && !file.name.includes('_auto-saved-')))
			);

			// Sort auto-saved files by filename (which includes timestamp) in descending order (newest first)
			autoSavedFiles.sort((a, b) => b.name.localeCompare(a.name));
			// Sort manually saved files by modification time (newest first)
			manualSavedFiles.sort((a, b) => b.stat.mtime - a.stat.mtime);

			// Display auto-saved conversations
			if (autoSavedFiles.length === 0) {
				const emptyMsg = autoSavedList.createEl('div', { text: 'No auto-saved conversations found', cls: 'chat-history-empty' });
			} else {
				for (const file of autoSavedFiles.slice(0, 20)) { // Limit to 20 most recent
					await this.createConversationItem(autoSavedList, file, true);
				}
			}

			// Display manually saved conversations
			if (manualSavedFiles.length === 0) {
				const emptyMsg = manualSavedList.createEl('div', { text: 'No manually saved conversations found', cls: 'chat-history-empty' });
			} else {
				for (const file of manualSavedFiles.slice(0, 20)) { // Limit to 20 most recent
					await this.createConversationItem(manualSavedList, file, false);
				}
			}
		} catch (error: any) {
			getLogger().error('Failed to load conversations:', error);
			const errorMsg = autoSavedList.createEl('div', { text: `Error loading conversations: ${error.message}`, cls: 'chat-history-error' });
		}
	}

	/**
	 * Extract timestamp from filename and format it for display
	 * Format: YYYY-MM-DD_HH-mm-ss_auto-saved-{shortId}.md
	 */
	private formatAutoSavedFileName(fileName: string): string {
		// Check if it's a timestamped filename
		const timestampMatch = fileName.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})_auto-saved-(.+)\.md$/);
		if (timestampMatch) {
			const [, year, month, day, hours, minutes, seconds, shortId] = timestampMatch;
			return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} (${shortId})`;
		}
		
		// Fallback to original filename if not timestamped
		return fileName.replace(/^auto-saved-/, '').replace(/\.md$/, '');
	}

	private async createConversationItem(container: HTMLElement, file: TFile, isAutoSaved: boolean) {
		try {
			// Read the file content to extract conversation info
			const content = await this.plugin.app.vault.read(file);
			
			// Extract title from content (look for # AI Conversation or first header)
			const titleMatch = content.match(/^# (.+)$/m);
			let title = titleMatch ? titleMatch[1] : file.basename;
			
			// For auto-saved files, enhance the title with timestamp information
			if (isAutoSaved) {
				const formattedName = this.formatAutoSavedFileName(file.name);
				title = `${title} - ${formattedName}`;
			}
			
			// Extract creation date from content if available
			const createdMatch = content.match(/\*\*Created:\*\* (.+)/);
			const lastModified = new Date(file.stat.mtime);
			
			// Create conversation item
			const item = container.createEl('div', { cls: 'chat-history-item' });

			// Title
			const titleEl = item.createEl('div', { text: title, cls: 'chat-history-item-title' });

			// Metadata
			const metaEl = item.createEl('div', { cls: 'chat-history-item-meta' });
			
			const dateEl = metaEl.createEl('span', { text: lastModified.toLocaleString() });
			const typeEl = metaEl.createEl('span', { 
				text: isAutoSaved ? 'Auto-saved' : 'Manual',
				cls: isAutoSaved ? 'chat-history-item-type' : ''
			});

			// Extract first few lines of conversation content for preview
			const previewMatch = content.match(/## 👤 \*\*User\*\*[\s\S]*?\n\n(.*?)(\n|$)/);
			if (previewMatch && previewMatch[1]) {
				const previewEl = item.createEl('div', { 
					text: previewMatch[1].substring(0, 100) + (previewMatch[1].length > 100 ? '...' : ''),
					cls: 'chat-history-item-preview'
				});
			}


			// Click handler to load conversation
			item.addEventListener('click', async () => {
				try {
					const conversation = await this.parseConversationFromMarkdown(content, file.basename);
					if (conversation) {
						this.onSelect(conversation);
						this.close();
						new Notice(`✅ Loaded conversation: ${title}`);
					} else {
						new Notice(t('notice.failedToParseConversation'));
					}
				} catch (error: any) {
					getLogger().error('Failed to load conversation:', error);
					new Notice(`❌ Failed to load conversation: ${error.message}`);
				}
			});

		} catch (error: any) {
			getLogger().error('Failed to create conversation item:', error);
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

			// Extract conversationID, tempImages, and timestamps from YAML frontmatter
			let tempImagesMap: { [key: string]: string } = {};
			const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
			if (yamlMatch) {
				const yamlContent = yamlMatch[1];
				
				// Extract conversationID
				const conversationIdMatch = yamlContent.match(/conversationID:\s*(.+)/);
				if (conversationIdMatch) {
					conversation.id = conversationIdMatch[1].trim();
				}
				
				// Extract created timestamp
				const createdMatch = yamlContent.match(/created:\s*(.+)/);
				if (createdMatch) {
					try {
						conversation.createdAt = new Date(createdMatch[1].trim());
					} catch (error) {
						getLogger().warn('Failed to parse created timestamp:', createdMatch[1]);
					}
				}
				
				// Extract lastModified timestamp
				const lastModifiedMatch = yamlContent.match(/lastModified:\s*(.+)/);
				if (lastModifiedMatch) {
					try {
						conversation.lastUpdated = new Date(lastModifiedMatch[1].trim());
					} catch (error) {
						getLogger().warn('Failed to parse lastModified timestamp:', lastModifiedMatch[1]);
					}
				}
				
				// Parse tempImages from YAML
				const tempImagesMatch = yamlContent.match(/tempImages:\s*\n((?:\s+\w+:\s*"[^"]*"\s*\n?)*)/);
				if (tempImagesMatch) {
					const tempImagesSection = tempImagesMatch[1];
					const imageMatches = tempImagesSection.matchAll(/\s+(\w+):\s*"([^"]*)"/g);
					for (const match of imageMatches) {
						const [, tempId, dataUrl] = match;
						// Unescape quotes
						tempImagesMap[tempId] = dataUrl.replace(/\\"/g, '"');
					}
				}
			}

			// Extract title from the first line (BestNote style) or legacy format
			const titleMatch = content.match(/^#\s*(.+)$/m);
			if (titleMatch) {
				conversation.title = titleMatch[1].replace(/^AI Conversation - /, ''); // Clean up legacy prefix
			}

			// Check if this is the new BestNote format or old format
			const isBestNoteFormat = content.includes('user:') || content.includes('ai:');
			
			if (isBestNoteFormat) {
				// Parse BestNote format
				await this.parseBestNoteFormat(content, conversation, tempImagesMap);
			} else {
				// Parse old Message Block format for backward compatibility
				await this.parseLegacyFormat(content, conversation, tempImagesMap);
			}

			return conversation.messages.length > 0 ? conversation : null;

		} catch (error: any) {
			getLogger().error('Failed to parse conversation from markdown:', error);
			return null;
		}
	}

	/**
	 * Parse timestamp string as local time to avoid timezone issues
	 */
	private parseTimestampAsLocal(timestampStr: string): Date {
		// Try ISO format first (from comments)
		try {
			const isoDate = new Date(timestampStr);
			if (!isNaN(isoDate.getTime()) && timestampStr.includes('T')) {
				return isoDate;
			}
		} catch (e) {
			// Continue to local parsing
		}
		
		// Parse local timestamp format: "2025/08/07 01:27:20" or "2025-08-07 01:27:20"
		const normalizedStr = timestampStr.replace(/\//g, '-');
		const parts = normalizedStr.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
		if (parts) {
			const [, year, month, day, hour, minute, second] = parts;
			// Create date in local time (month is 0-indexed in Date constructor)
			return new Date(
				parseInt(year), 
				parseInt(month) - 1, 
				parseInt(day), 
				parseInt(hour), 
				parseInt(minute), 
				parseInt(second)
			);
		}
		
		// Fallback to default parsing
		return new Date(timestampStr);
	}

	private async parseBestNoteFormat(content: string, conversation: AIConversation, tempImagesMap: { [key: string]: string }): Promise<void> {
		// Split content by lines to parse line by line
		const lines = content.split('\n');
		let currentMessage: any = null;
		let currentContent: string[] = [];
		
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			
			// Check if this line starts a new message with timestamp in comment
			const messageWithTimestampMatch = line.match(/^(user|ai):\s*<!--\s*(.*?)\s*-->\s*(.*)?$/);
			if (messageWithTimestampMatch) {
				// Save previous message if exists
				if (currentMessage) {
					await this.finalizeBestNoteMessage(currentMessage, currentContent, conversation, tempImagesMap);
				}
				
				// Start new message with timestamp
				const messageType = messageWithTimestampMatch[1] === 'user' ? 'user' : 'assistant';
				const timestampStr = messageWithTimestampMatch[2];
				const initialContent = messageWithTimestampMatch[3] || '';
				
				let timestamp = new Date();
				try {
					timestamp = this.parseTimestampAsLocal(timestampStr);
				} catch (error) {
					getLogger().warn('Could not parse timestamp:', timestampStr);
				}
				
				currentMessage = {
					id: 'loaded_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
					type: messageType as 'user' | 'assistant',
					timestamp: timestamp
				};
				
				currentContent = initialContent ? [initialContent] : [];
				continue;
			}
			
			// Check if this line starts a new message without timestamp (fallback)
			const messageMatch = line.match(/^(user|ai):\s*(.*)?$/);
			if (messageMatch) {
				// Save previous message if exists
				if (currentMessage) {
					await this.finalizeBestNoteMessage(currentMessage, currentContent, conversation, tempImagesMap);
				}
				
				// Start new message
				const messageType = messageMatch[1] === 'user' ? 'user' : 'assistant';
				const initialContent = messageMatch[2] || '';
				
				currentMessage = {
					id: 'loaded_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
					type: messageType as 'user' | 'assistant',
					timestamp: new Date()
				};
				
				currentContent = initialContent ? [initialContent] : [];
				continue;
			}
			
			// Check for timestamp lines
			const timestampMatch = line.match(/^\[Timestamp:\s*(.+)\]$/);
			if (timestampMatch && currentMessage) {
				// Parse timestamp and finalize current message
				const timestampStr = timestampMatch[1];
				try {
					currentMessage.timestamp = this.parseTimestampAsLocal(timestampStr);
				} catch (e) {
					getLogger().warn('Could not parse timestamp:', timestampStr);
				}
				
				await this.finalizeBestNoteMessage(currentMessage, currentContent, conversation, tempImagesMap);
				currentMessage = null;
				currentContent = [];
				continue;
			}
			
			// Check for Properties section or other metadata - skip these
			if (line.startsWith('Properties') || line.match(/^[📅🤖🏷️]\s+\w+\s+/) || line.match(/^---\s*$/)) {
				continue;
			}
			
			// Accumulate content lines
			if (currentMessage && line.trim()) {
				currentContent.push(line);
			}
		}
		
		// Finalize the last message if exists
		if (currentMessage) {
			await this.finalizeBestNoteMessage(currentMessage, currentContent, conversation, tempImagesMap);
		}
	}

	private async finalizeBestNoteMessage(message: any, contentLines: string[], conversation: AIConversation, tempImagesMap: { [key: string]: string }): Promise<void> {
		const fullContent = contentLines.join('\n').trim();
		
		// Only add message if it has content
		if (fullContent) {
			// Extract temporary image references and add them to the message
			const tempImageRegex = /\[!TempPic\s+([^\]]+)\]/g;
			const tempImages: { [key: string]: string } = {};
			let match;
			
			while ((match = tempImageRegex.exec(fullContent)) !== null) {
				const tempId = match[1];
				if (tempImagesMap[tempId]) {
					tempImages[tempId] = tempImagesMap[tempId];
				}
			}
			
			// Keep the full content including temporary image placeholders
			message.content = fullContent;
			if (Object.keys(tempImages).length > 0) {
				message.tempImages = tempImages;
			}
			conversation.messages.push(message);
		}
	}

	private async parseLegacyFormat(content: string, conversation: AIConversation, tempImagesMap: { [key: string]: string }): Promise<void> {
		// Parse old Message Block format for backward compatibility
		const messageBlocks = content.split(/## Message Block \d+/);
		
		for (let i = 1; i < messageBlocks.length; i++) {
			const blockContent = messageBlocks[i];
			
			// Extract sender
			const senderMatch = blockContent.match(/\*\*Sender:\*\*\s*[🤖👤]\s*(User|AI Assistant)/);
			if (!senderMatch) continue;
			
			const isUser = senderMatch[1] === 'User';
			const messageId = 'loaded_' + Date.now() + '_' + i;
			
			// Extract timestamp
			const timeMatch = blockContent.match(/\*\*Time:\*\*\s*(.+)/);
			const timestamp = timeMatch ? new Date() : new Date(); // Use current time as fallback
			
			// Extract content - keep everything including images
			const contentMatch = blockContent.match(/\*\*Content:\*\*\s*\n\n([\s\S]*?)(?=\n\n---|\n---|\s*$)/);
			const fullContent = contentMatch ? contentMatch[1].trim() : '';
			
			// Skip empty messages
			if (!fullContent) continue;
			
			// Extract temporary image references and add them to the message
			const tempImageRegex = /\[!TempPic\s+([^\]]+)\]/g;
			const tempImages: { [key: string]: string } = {};
			let match;
			
			while ((match = tempImageRegex.exec(fullContent)) !== null) {
				const tempId = match[1];
				if (tempImagesMap[tempId]) {
					tempImages[tempId] = tempImagesMap[tempId];
				}
			}
			
			const message = {
				id: messageId,
				type: isUser ? 'user' as const : 'assistant' as const,
				content: fullContent, // Keep full content including temporary image placeholders
				timestamp: timestamp,
				...(Object.keys(tempImages).length > 0 ? { tempImages } : {})
			};
			
			conversation.messages.push(message);
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
		this.modalEl.removeClass('chat-history-modal-responsive');
		
		const { contentEl } = this;
		contentEl.empty();
		contentEl.removeClass('chat-history-modal');
	}
}