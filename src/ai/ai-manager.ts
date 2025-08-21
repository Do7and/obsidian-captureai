import { Notice, WorkspaceLeaf, TFile, requestUrl, RequestUrlResponsePromise, RequestUrlResponse } from 'obsidian';
import ImageCapturePlugin from '../main';
import { LLM_PROVIDERS, ModelConfig } from '../types';
import { AI_CHAT_VIEW_TYPE } from './ai-chat-view';
import { getLogger } from '../utils/logger';
import { t } from '../i18n';

// Interface for temporary image data
interface TempImageData {
	dataUrl: string;
	source: string;      // 'screenshot', 'external', 'clipboard', etc
	fileName: string;
	timestamp: number;
}

// Image Reference Manager for handling temporary images
class ImageReferenceManager {
	// 临时图片存储 (内存中，会话结束时清理)
	private tempImages: Map<string, TempImageData> = new Map();
	
	// 引用计数 (用于内存管理)
	private refCounts: Map<string, number> = new Map();
	
	private plugin: ImageCapturePlugin;
	
	constructor(plugin: ImageCapturePlugin) {
		this.plugin = plugin;
	}
	
	// 添加临时图片，返回标识符
	addTempImage(dataUrl: string, source: string, fileName: string): string {
		const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		
		this.tempImages.set(tempId, {
			dataUrl,
			source,
			fileName,
			timestamp: Date.now()
		});
		
		// 初始引用计数为1（预发送区或其他地方会立即持有引用）
		this.refCounts.set(tempId, 1);
		
		getLogger().log(`Added temp image: ${tempId}, source: ${source}, fileName: ${fileName}`);
		return tempId;
	}
	
	// 获取临时图片数据
	getTempImageData(tempId: string): TempImageData | null {
		return this.tempImages.get(tempId) || null;
	}
	
	// 增加引用计数
	addRef(tempId: string): void {
		const currentCount = this.refCounts.get(tempId) || 0;
		this.refCounts.set(tempId, currentCount + 1);
	}
	
	// 减少引用计数
	removeRef(tempId: string): void {
		const currentCount = this.refCounts.get(tempId) || 0;
		if (currentCount > 0) {
			this.refCounts.set(tempId, currentCount - 1);
		}
		
		// 如果引用计数为0，清理图片数据
		if (this.refCounts.get(tempId) === 0) {
			this.cleanupTempImage(tempId);
		}
	}
	
	// 清理无引用的临时图片
	private cleanupTempImage(tempId: string): void {
		this.tempImages.delete(tempId);
		this.refCounts.delete(tempId);
		getLogger().log(`Cleaned up temp image: ${tempId}`);
	}
	
	// 清理所有临时图片 (会话结束时调用)
	cleanup(): void {
		const count = this.tempImages.size;
		this.tempImages.clear();
		this.refCounts.clear();
		getLogger().log(`Cleaned up ${count} temporary images`);
	}
	
	// 获取所有临时图片的统计信息
	getStats(): { count: number; totalSize: number } {
		let totalSize = 0;
		for (const imageData of this.tempImages.values()) {
			// 估算base64数据大小 (字符数 * 0.75 约等于字节数)
			totalSize += imageData.dataUrl.length * 0.75;
		}
		
		return {
			count: this.tempImages.size,
			totalSize: Math.round(totalSize)
		};
	}
	
	// 解析消息内容中的图片引用并更新引用计数
	updateRefsFromContent(content: string, increment: boolean = true): void {
		const tempRefs = content.match(/temp:(\w+)/g) || [];
		tempRefs.forEach(ref => {
			const tempId = ref.replace('temp:', '');
			if (increment) {
				this.addRef(tempId);
			} else {
				this.removeRef(tempId);
			}
		});
	}
}

// Interface for message content array with image support
interface MessageContentItem {
	type: 'text' | 'image_url';
	text?: string;
	image_url?: {
		url: string;
	};
}

// Interface for AI Chat View methods
interface AIChatViewMethods {
	updateContent?(): void;
	getCurrentMode?(): string;
}

export interface AIMessage {
	id: string;
	type: 'user' | 'assistant';
	content: string;
	image?: string;
	timestamp: Date;
	isTyping?: boolean;
}

export interface AIConversation {
	id: string;
	title: string;
	messages: AIMessage[];
	createdAt: Date;
	lastUpdated: Date;
	// 添加对话状态追踪
	lastModeUsed?: string; // 记录最后使用的 mode
}

export class AIManager {
	private plugin: ImageCapturePlugin;
	private conversations: Map<string, AIConversation> = new Map();
	private currentConversationId: string | null = null;
	private imageRefManager: ImageReferenceManager;

	constructor(plugin: ImageCapturePlugin) {
		this.plugin = plugin;
		this.imageRefManager = new ImageReferenceManager(plugin);
	}

	// 获取图片引用管理器的公共访问方法
	getImageReferenceManager(): ImageReferenceManager {
		return this.imageRefManager;
	}

	// 删除消息时更新图片引用计数（只处理用户消息）
	private removeImageRefsFromMessage(message: AIMessage): void {
		if (message.content && message.type === 'user') {
			this.imageRefManager.updateRefsFromContent(message.content, false); // 减少引用
		}
	}

	// 添加消息时更新图片引用计数（只处理用户消息）
	private addImageRefsFromMessage(message: AIMessage): void {
		if (message.content && message.type === 'user') {
			this.imageRefManager.updateRefsFromContent(message.content, true); // 增加引用
		}
	}


	async sendImagesToAI(images: { dataUrl: string, fileName: string, localPath?: string | null }[], userMessage?: string): Promise<void> {
		if (!this.plugin.settings.enableAIAnalysis) {
			throw new Error('AI analysis is disabled');
		}

		// Get the default model config
		const defaultModelConfig = this.plugin.settings.modelConfigs.find(
			mc => mc.id === this.plugin.settings.defaultModelConfigId
		);
		
		if (!defaultModelConfig) {
			throw new Error('No default model configured. Please configure a model in Settings.');
		}

		if (!defaultModelConfig.isVisionCapable) {
			throw new Error('Default model does not support vision analysis');
		}

		// Get provider credentials
		const credentials = this.plugin.settings.providerCredentials[defaultModelConfig.providerId];
		if (!credentials || !credentials.verified || !credentials.apiKey.trim()) {
			throw new Error('Provider credentials not verified. Please verify API key in Settings.');
		}

		// Create or get current conversation
		let conversation = this.getCurrentConversation();
		if (!conversation) {
			// Create conversation with temporary title
			conversation = this.createNewConversation('新对话');
		}

		// Set default message based on number of images
		// const defaultMessage = images.length === 1 ? 
		// 	'Please analyze this image' : 
		// 	`Please analyze these ${images.length} images`;
		
		// Set default message to null
		const defaultMessage = ''

		// Create user message content with temporary images
		const tempImageData = this.createTempImagePlaceholders(images.map(img => img.dataUrl));
		const messageData = this.mergeTempImagesWithContent(userMessage || defaultMessage, tempImageData);
		
		// Add user message with markdown content and temporary images
		const userMsg: AIMessage = {
			id: this.generateMessageId(),
			type: 'user',
			content: messageData.content.trim(),
			timestamp: new Date()
		};
		conversation.messages.push(userMsg);

		// Check temporary image limit and notify user
		this.checkTempImageLimit(conversation);

		// Show the AI panel
		await this.showAIPanel();
		this.updateAIPanel();

		// Add typing indicator
		const typingMessage = {
			id: 'typing_' + Date.now(),
			type: 'assistant' as const,
			content: '',
			timestamp: new Date(),
			isTyping: true
		};
		conversation.messages.push(typingMessage);
		this.updateAIPanel();

		try {
			// Extract text content from user message (without images)
			const { textContent } = this.parseMarkdownContent(userMsg.content);
			
			// Call AI API with context support using images array
			// 智能判断逻辑会自动决定是否需要 mode prompt
			const response = await this.callAIWithContext(
				conversation, 
				textContent || '', // 删除默认的分析文本，使用空字符串
				images.map(img => img.dataUrl), 
				defaultModelConfig,
				true // 保持兼容性，实际逻辑在 buildContextMessages 中处理
			);

			// Remove typing indicator more reliably
			const typingIndex = conversation.messages.findIndex(m => m.id === typingMessage.id);
			if (typingIndex > -1) {
				conversation.messages.splice(typingIndex, 1);
			}
			
			// Also remove any other lingering typing indicators to prevent conflicts
			conversation.messages = conversation.messages.filter(m => !m.isTyping);

			// Add AI response
			const assistantMsg: AIMessage = {
				id: this.generateMessageId(),
				type: 'assistant',
				content: response,
				timestamp: new Date()
			};
			conversation.messages.push(assistantMsg);

			// Update last used timestamp
			defaultModelConfig.lastUsed = new Date();
			await this.plugin.saveSettings();

			// Update panel
			this.updateAIPanel();

		} catch (error) {
			getLogger().error('AI API call failed:', error);
			
			// Remove typing indicator more reliably
			const typingIndex = conversation.messages.findIndex(m => m.hasOwnProperty('isTyping'));
			if (typingIndex > -1) {
				conversation.messages.splice(typingIndex, 1);
			}
			
			// Also remove any other lingering typing indicators to prevent conflicts
			conversation.messages = conversation.messages.filter(m => !m.isTyping);

			// Add error message
			const errorMsg: AIMessage = {
				id: this.generateMessageId(),
				type: 'assistant',
				content: `Error: ${error.message}`,
				timestamp: new Date()
			};
			conversation.messages.push(errorMsg);
			this.updateAIPanel();
			
			throw error;
		}
	}

	// Convenience method for single image analysis
	// WARNING: This method should NOT be used for screenshot capture auto-send functionality!
	// Screenshots should be added to queue first, letting users decide when to send
	async sendSingleImageToAI(dataUrl: string, fileName: string, userMessage?: string, localPath?: string | null): Promise<void> {
		const imageArray = [{
			dataUrl: dataUrl,
			fileName: fileName,
			localPath: localPath || null
		}];
		
		return await this.sendImagesToAI(imageArray, userMessage);
	}

	async callAIForFollowUp(message: string, imageDataUrl: string): Promise<string> {
		// Convert single image to array format and delegate to sendImagesToAI
		const imageArray = [{
			dataUrl: imageDataUrl,
			fileName: 'follow-up-image.png',
			localPath: null
		}];
		
		await this.sendImagesToAI(imageArray, message);
		
		// Get the latest response from conversation
		const conversation = this.getCurrentConversation();
		if (conversation && conversation.messages.length > 0) {
			const lastMessage = conversation.messages[conversation.messages.length - 1];
			if (lastMessage.type === 'assistant') {
				return lastMessage.content;
			}
		}
		
		throw new Error('No response received from AI');
	}


	async callAIForTextOnly(message: string): Promise<string> {
		// Use the current default model for text-only conversation
		const defaultModelConfig = this.plugin.settings.modelConfigs.find(
			mc => mc.id === this.plugin.settings.defaultModelConfigId
		);
		
		if (!defaultModelConfig) {
			throw new Error('No default model configured');
		}
		
		return await this.callTextOnlyAPI(message, defaultModelConfig);
	}

	// Context building function for conversation history
	async buildContextMessages(conversation: AIConversation | null, currentMessage: string, currentImages?: string[], modelConfig?: ModelConfig, includeModeprompt?: boolean): Promise<any[]> {
		const messages: any[] = [];
		const contextSettings = this.plugin.settings.contextSettings || {
			maxContextMessages: 20,
			maxContextImages: 3,
			includeSystemPrompt: true,
			contextStrategy: 'recent'
		};

		// Determine target model config to check vision capability
		const targetModelConfig = modelConfig || this.plugin.settings.modelConfigs.find(
			mc => mc.id === this.plugin.settings.defaultModelConfigId
		);
		
		const isVisionCapable = targetModelConfig?.isVisionCapable || false;

		// 1. Add system prompt (global system prompt)
		if (contextSettings.includeSystemPrompt) {
			messages.push({
				role: 'system',
				content: this.getEffectiveSystemPrompt()
			});
		}

		// 2. Add historical context messages (不包含当前要发送的消息)
		if (conversation && conversation.messages.length > 0) {
			// Get all historical messages (不包含当前发送的消息)
			let historicalMessages = conversation.messages.slice();
			let imageCount = 0;

			// Filter out error messages to prevent context pollution
			historicalMessages = historicalMessages.filter(msg => {
				// Skip error messages that start with "Error:"
				if (msg.type === 'assistant' && msg.content.startsWith('Error:')) {
					return false;
				}
				// Skip typing indicators
				if (msg.isTyping) return false;
				return true;
			});

			// Apply context strategy
			if (contextSettings.contextStrategy === 'recent') {
				// Take the most recent messages up to the limit
				historicalMessages = historicalMessages.slice(-contextSettings.maxContextMessages);
			} else if (contextSettings.contextStrategy === 'smart') {
				// Smart selection: prioritize messages with images and recent messages
				const messagesWithImages = historicalMessages.filter(m => {
					const { imageReferences, tempImageRefs } = this.parseMarkdownContent(m.content || '');
					return imageReferences.length > 0 || tempImageRefs.length > 0;
				});
				const messagesWithoutImages = historicalMessages.filter(m => {
					const { imageReferences, tempImageRefs } = this.parseMarkdownContent(m.content || '');
					return imageReferences.length === 0 && tempImageRefs.length === 0;
				});
				
				// Take recent image messages first (up to maxContextImages)
				const recentImageMessages = messagesWithImages.slice(-contextSettings.maxContextImages);
				imageCount = recentImageMessages.length;
				
				// Fill remaining slots with recent text messages
				const remainingSlots = contextSettings.maxContextMessages - recentImageMessages.length;
				const recentTextMessages = messagesWithoutImages.slice(-remainingSlots);
				
				// Combine and sort by timestamp
				historicalMessages = [...recentImageMessages, ...recentTextMessages]
					.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
			}

			// Convert historical messages to API format
			for (const msg of historicalMessages) {
				const role = msg.type === 'user' ? 'user' : 'assistant';
				
				// Parse message content to extract image references
				const imageReferences = this.parseImageReferences(msg.content || '');
				
				// Remove image markdown from text content
				let textContent = msg.content || '';
				imageReferences.forEach(imgRef => {
					const imgMarkdown = `![${imgRef.alt}](${imgRef.path})`;
					textContent = textContent.replace(imgMarkdown, '').trim();
				});
				// Clean up extra whitespace
				textContent = textContent.replace(/\n\s*\n/g, '\n\n').trim();
				
				// Check if message has images and model supports vision
				const hasImages = imageReferences.length > 0 && isVisionCapable && imageCount < contextSettings.maxContextImages;
				
				if (hasImages) {
					// Message with images - only include if model supports vision
					const messageContent: MessageContentItem[] = [];
					
					// 只有当文本内容不为空时才添加文本部分
					if (textContent && textContent.trim()) {
						messageContent.push({ type: 'text', text: textContent });
					}
					
					// Add images using unified resolution method
					for (const imageRef of imageReferences) {
						if (imageCount >= contextSettings.maxContextImages) break;
						
						const imageDataUrl = await this.resolveImageForAPI(imageRef.path);
						
						if (imageDataUrl) {
							messageContent.push({
								type: 'image_url',
								image_url: { url: imageDataUrl }
							});
							imageCount++;
						}
					}
					
					messages.push({
						role: role,
						content: messageContent
					});
				} else {
					// Text-only message (either no images or model doesn't support vision)
					messages.push({
						role: role,
						content: textContent || msg.content || ''
					});
				}
			}
		}

		// 3. Handle mode prompt logic
		const currentMode = this.getCurrentMode();
		const hasImages: boolean = !!(currentImages && currentImages.length > 0);
		
		// 判断是否需要添加 mode prompt
		if (hasImages) {
			// 有图片时，判断是否需要添加 mode prompt
			const shouldApply = this.shouldApplyModePrompt(conversation, hasImages, currentMode);
			
			if (shouldApply) {
				const modePrompt = this.getModePrompt(currentMode);
				if (modePrompt && modePrompt.trim()) {
					// 添加独立的 mode prompt 消息块，使用 system role
					messages.push({
						role: 'system',
						content: modePrompt
					});
				}
				
				// 更新对话的 mode 状态
				if (conversation) {
					conversation.lastModeUsed = currentMode;
				}
			}
		} else {
			// 没有图片时，检查 mode 是否是图片相关
			const isImageRelatedMode = this.isImageRelatedMode(currentMode);
			if (!isImageRelatedMode) {
				// 非图片相关的 mode，可以添加 mode prompt
				const shouldApply = this.shouldApplyModePrompt(conversation, hasImages, currentMode);
				
				if (shouldApply) {
					const modePrompt = this.getModePrompt(currentMode);
					if (modePrompt && modePrompt.trim()) {
						messages.push({
							role: 'system',
							content: modePrompt
						});
					}
					
					// 更新对话的 mode 状态
					if (conversation) {
						conversation.lastModeUsed = currentMode;
					}
				}
			}
			// 如果是图片相关的 mode 但没有图片，则不添加 mode prompt（避免歧义）
		}

		// 4. Add current user message (纯净的用户消息，不包含 mode prompt)
		if (currentImages && currentImages.length > 0 && isVisionCapable) {
			// Current message with images - multimodal format
			const messageContent: MessageContentItem[] = [];
			
			// 只有当文本内容不为空时才添加文本部分
			if (currentMessage && currentMessage.trim()) {
				messageContent.push({ type: 'text', text: currentMessage });
			}
			
			// Add current images
			for (const imageDataUrl of currentImages) {
				messageContent.push({
					type: 'image_url',
					image_url: { url: imageDataUrl }
				});
			}
			
			messages.push({
				role: 'user',
				content: messageContent
			});
		} else {
			// Current text-only message
			messages.push({
				role: 'user',
				content: currentMessage
			});
		}

		return messages;
	}

	// New API call with context support
	async callAIWithContext(conversation: AIConversation | null, message: string, images?: string[], modelConfig?: ModelConfig, includeModeprompt?: boolean): Promise<string> {
		// Use provided model config or default
		const targetModelConfig = modelConfig || this.plugin.settings.modelConfigs.find(
			mc => mc.id === this.plugin.settings.defaultModelConfigId
		);
		
		if (!targetModelConfig) {
			throw new Error('No model configured');
		}

		// Build context messages
		const contextMessages = await this.buildContextMessages(conversation, message, images, targetModelConfig, includeModeprompt);
		
		// Call appropriate API with context
		return await this.callAPIWithContextMessages(contextMessages, targetModelConfig);
	}

	// New method: Send pre-built messages to AI (separated from message construction)
	async sendPreBuiltMessagesToAI(messages: any[], modelConfig?: ModelConfig): Promise<string> {
		// Use provided model config or default
		const targetModelConfig = modelConfig || this.plugin.settings.modelConfigs.find(
			mc => mc.id === this.plugin.settings.defaultModelConfigId
		);
		
		if (!targetModelConfig) {
			throw new Error('No model configured');
		}

		// Send the pre-built messages directly to API
		return await this.callAPIWithContextMessages(messages, targetModelConfig);
	}

	// New function to call API with pre-built context messages
	private async callAPIWithContextMessages(messages: any[], modelConfig: ModelConfig): Promise<string> {
		// Import logger
		const { getLogger } = require('../utils/logger');
		const logger = getLogger();

		// Get provider credentials
		const credentials = this.plugin.settings.providerCredentials[modelConfig.providerId];
		if (!credentials || !credentials.verified || !credentials.apiKey.trim()) {
			throw new Error('Provider credentials not verified');
		}

		logger.log(`🔄 Calling AI API with context - Provider: ${modelConfig.providerId}, Model: ${modelConfig.modelId}`);
		logger.log(`📊 Context messages count: ${messages.length}`);
		logger.log(`⚙️ Current model config - ID: ${modelConfig.id}, MaxTokens: ${modelConfig.settings.maxTokens}`);

		// Calculate safe maxTokens based on model's context window
		const safeMaxTokens = this.calculateSafeMaxTokens(messages, modelConfig);
		logger.log(`🔧 Adjusted maxTokens from ${modelConfig.settings.maxTokens} to ${safeMaxTokens}`);
		
		// Create a temporary model config with adjusted maxTokens
		const adjustedModelConfig = {
			...modelConfig,
			settings: {
				...modelConfig.settings,
				maxTokens: safeMaxTokens
			}
		};

		let response: RequestUrlResponse;

		if (modelConfig.providerId === 'openai') {
			response = await this.callOpenAIWithContext(messages, adjustedModelConfig, credentials);
		} else if (modelConfig.providerId === 'anthropic') {
			response = await this.callClaudeWithContext(messages, adjustedModelConfig, credentials);
		} else if (modelConfig.providerId === 'google') {
			response = await this.callGoogleWithContext(messages, adjustedModelConfig, credentials);
		} else if (modelConfig.providerId === 'cohere') {
			response = await this.callCohereWithContext(messages, adjustedModelConfig, credentials);
		} else if (modelConfig.providerId === 'openrouter') {
			response = await this.callOpenRouterWithContext(messages, adjustedModelConfig, credentials);
		} else if (modelConfig.providerId === 'custom' || modelConfig.providerId.startsWith('custom_')) {
			response = await this.callCustomAPIWithContext(messages, adjustedModelConfig, credentials);
		} else {
			throw new Error(`Unsupported provider: ${modelConfig.providerId}`);
		}

		getLogger().log(`API Response Status: ${response.status}`);

		if (response.status < 200 || response.status >= 300) {
			const errorText = response.text;
			getLogger().error(`API call failed. Status: ${response.status}, Response: ${errorText}`);
			throw new Error(`API call failed: ${response.status} ${errorText}`);
		}

		const responseText = response.text;
		getLogger().log('API Response Length:', responseText.length);
		getLogger().log('API Response Preview:', responseText.substring(0, 200) + '...');
		getLogger().log('API Response End:', responseText.substring(Math.max(0, responseText.length - 200)));
		
		// Check if response appears to be truncated (doesn't end properly)
		if (responseText.includes('<think>') && !responseText.includes('</think>')) {
			getLogger().warn('⚠️ Thinking response appears to be truncated - missing closing tag');
		}
		
		// Parse response based on provider
		if (modelConfig.providerId === 'openai' || modelConfig.providerId === 'openrouter' || modelConfig.providerId === 'custom' || modelConfig.providerId.startsWith('custom_')) {
			const data = JSON.parse(responseText);
			
			// For thinking models, check if there's additional content beyond message.content
			const choice = data.choices[0];
			let content = choice.message.content;
			
			// Handle thinking models that might have reasoning/thinking content
			if (choice.message.reasoning || choice.reasoning) {
				const thinking = choice.message.reasoning || choice.reasoning;
				content = `<think>\n${thinking}\n</think>\n\n${content}`;
			}
			
			// Some thinking models put the full response in different fields
			if (choice.message.thinking_content) {
				content = `<think>\n${choice.message.thinking_content}\n</think>\n\n${content}`;
			}
			
			return content;
		} else if (modelConfig.providerId === 'anthropic') {
			const data = JSON.parse(responseText);
			return data.content[0].text;
		} else if (modelConfig.providerId === 'google') {
			const data = JSON.parse(responseText);
			return data.candidates[0].content.parts[0].text;
		} else if (modelConfig.providerId === 'cohere') {
			const data = JSON.parse(responseText);
			return data.text;
		}
		
		throw new Error('Unknown provider response format');
	}


	private async callTextOnlyAPI(message: string, modelConfig: ModelConfig): Promise<string> {
		const provider = LLM_PROVIDERS.find(p => p.id === modelConfig.providerId);
		
		if (!provider) {
			throw new Error(`Unknown provider: ${modelConfig.providerId}`);
		}

		// Get provider credentials
		const credentials = this.plugin.settings.providerCredentials[modelConfig.providerId];
		if (!credentials || !credentials.verified || !credentials.apiKey.trim()) {
			throw new Error('Provider credentials not verified');
		}

		getLogger().log(`Calling text-only AI API - Provider: ${modelConfig.providerId}, Model: ${modelConfig.modelId}`);

		let response: RequestUrlResponse;

		if (modelConfig.providerId === 'openai') {
			response = await this.callOpenAITextOnly(message, modelConfig, credentials);
		} else if (modelConfig.providerId === 'anthropic') {
			response = await this.callClaudeTextOnly(message, modelConfig, credentials);
		} else if (modelConfig.providerId === 'google') {
			response = await this.callGoogleTextOnly(message, modelConfig, credentials);
		} else if (modelConfig.providerId === 'openrouter') {
			response = await this.callOpenRouterTextOnly(message, modelConfig, credentials);
		} else if (modelConfig.providerId === 'custom' || modelConfig.providerId.startsWith('custom_')) {
			response = await this.callCustomAPITextOnly(message, modelConfig, credentials);
		} else {
			throw new Error(`Unsupported provider for text chat: ${modelConfig.providerId}`);
		}

		getLogger().log(`Text API Response Status: ${response.status}`);

		if (response.status < 200 || response.status >= 300) {
			const errorText = response.text;
			getLogger().error(`Text API call failed. Status: ${response.status}, Response: ${errorText}`);
			throw new Error(`API call failed: ${response.status} ${errorText}`);
		}

		const responseText = response.text;
		getLogger().log('Text API Response:', responseText.substring(0, 200) + '...');
		
		let data;
		try {
			data = JSON.parse(responseText);
		} catch (parseError) {
			getLogger().error('Failed to parse JSON response:', parseError);
			throw new Error(`Invalid JSON response from API. Response starts with: ${responseText.substring(0, 100)}`);
		}
		return this.extractResponseContent(data, modelConfig.providerId);
	}


	private extractResponseContent(data: any, providerId: string): string {
		try {
			if (providerId === 'openai' || providerId === 'custom' || providerId.startsWith('custom_') || providerId === 'openrouter') {
				return data.choices?.[0]?.message?.content || 'No response received';
			} else if (providerId === 'anthropic') {
				return data.content?.[0]?.text || 'No response received';
			} else if (providerId === 'google') {
				return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response received';
			} else if (providerId === 'cohere') {
				return data.text || 'No response received';
			}
			return 'Unknown response format';
		} catch (error) {
			getLogger().error('Failed to extract response content:', error);
			return 'Failed to parse AI response';
		}
	}

	createNewConversation(title: string): AIConversation {
		const conversation: AIConversation = {
			id: this.generateConversationId(),
			title,
			messages: [],
			createdAt: new Date(),
			lastUpdated: new Date(),
			lastModeUsed: undefined // 初始状态没有使用过任何 mode
		};
		
		this.conversations.set(conversation.id, conversation);
		this.currentConversationId = conversation.id;
		return conversation;
	}

	/**
	 * 判断指定的mode是否与图片相关
	 * @param mode 要检查的mode
	 * @returns 是否是图片相关的mode
	 */
	isImageRelatedMode(mode: string): boolean {
		const imageRelatedModes = ['analyze', 'ocr'];
		return imageRelatedModes.includes(mode);
	}

	/**
	 * 智能判断是否需要应用 mode prompt
	 * @param conversation 当前对话
	 * @param hasImages 当前消息是否包含图片
	 * @param currentMode 当前 mode
	 * @returns 是否需要应用 mode prompt
	 */
	shouldApplyModePrompt(conversation: AIConversation | null, hasImages: boolean, currentMode: string): boolean {
		// 获取图片相关的 mode 列表
		const imageRelatedModes = ['analyze', 'ocr'];
		const isImageRelatedMode = imageRelatedModes.includes(currentMode);
		
		// 获取当前 mode 的 prompt 内容
		const currentModePrompt = this.getModePrompt(currentMode);
		const hasModePrompt = currentModePrompt && currentModePrompt.trim();
		
		// 如果当前 mode 没有设置 prompt，直接返回 false
		if (!hasModePrompt) {
			return false;
		}
		
		// 情况1：新对话
		if (!conversation || conversation.messages.length === 0) {
			// 新对话时，如果有 mode prompt 设置就应用
			return true;
		}
		
		// 情况2：mode 发生了变化
		if (conversation.lastModeUsed !== currentMode) {
			// Mode 切换了，需要应用新的 mode prompt
			return true;
		}
		
		// 情况3：图片相关 mode + 有图片
		if (isImageRelatedMode && hasImages) {
			// 每次发图片都需要相关的分析指令
			return true;
		}
		
		// 情况4：其他情况不应用
		return false;
	}

	/**
	 * Generate a meaningful conversation title based on message content
	 */
	generateSmartTitle(conversation: AIConversation): string {
		if (!conversation.messages || conversation.messages.length === 0) {
			return '新对话';
		}

		// Collect text content from the first few messages
		let titleText = '';
		let imageCount = 0;
		const maxLength = 50; // Maximum title length
		
		for (const message of conversation.messages.slice(0, 3)) {
			// Collect text content and parse for images
			if (message.content && message.content.trim()) {
				// Parse markdown content to separate images and text
				const { textContent, imageReferences, tempImageRefs } = this.parseMarkdownContent(message.content);
				
				// Count images from markdown content and temporary images
				imageCount += imageReferences.length + tempImageRefs.length;
				
				// Clean text content for title
				const cleanContent = textContent
					.replace(/[#*`_~\[\]]/g, '') // Remove markdown formatting
					.replace(/\n+/g, ' ') // Replace line breaks with spaces
					.replace(/\s+/g, ' ') // Replace multiple spaces with single space
					.trim();
				
				if (cleanContent) {
					if (titleText) titleText += ' ';
					titleText += cleanContent;
				}
			}
		}

		// If we have images, add image indicator
		let title = '';
		if (imageCount > 0) {
			title = `[图片]`;
		}

		// Add text content
		if (titleText) {
			if (title) title += ' ';
			// Truncate if too long
			if (titleText.length > maxLength) {
				title += titleText.substring(0, maxLength - 3) + '...';
			} else {
				title += titleText;
			}
		} else if (imageCount > 0) {
			// Only images, no text
			if (imageCount === 1) {
				title = '[图片]';
			} else {
				title = `[${imageCount}张图片]`;
			}
		} else {
			// Fallback
			title = '新对话';
		}

		return title;
	}

	/**
	 * Update conversation title based on its content
	 */
	updateConversationTitle(conversationId: string): void {
		const conversation = this.conversations.get(conversationId);
		if (conversation && conversation.messages.length > 0) {
			const newTitle = this.generateSmartTitle(conversation);
			conversation.title = newTitle;
			conversation.lastUpdated = new Date();
		}
	}

	/**
	 * Delete a conversation and clean up associated image references
	 */
	deleteConversation(conversationId: string): void {
		const conversation = this.conversations.get(conversationId);
		if (conversation) {
			// Clean up image references from all messages
			conversation.messages.forEach(message => {
				this.removeImageRefsFromMessage(message);
			});
			
			// Remove from conversations map
			this.conversations.delete(conversationId);
			
			// If this was the current conversation, clear the reference
			if (this.currentConversationId === conversationId) {
				this.currentConversationId = null;
			}
			
			getLogger().log(`Deleted conversation: ${conversationId}`);
		}
	}

	/**
	 * 更新内存中的对话数据（用于保存后同步临时图片到本地文件的引用更新）
	 */
	updateConversationInMemory(conversationId: string, updatedConversation: AIConversation): void {
		const existingConversation = this.conversations.get(conversationId);
		if (existingConversation) {
			// 先清理旧的图片引用计数
			existingConversation.messages.forEach(message => {
				this.removeImageRefsFromMessage(message);
			});
			
			// 更新对话数据
			this.conversations.set(conversationId, updatedConversation);
			
			// 为新的消息内容添加图片引用计数
			updatedConversation.messages.forEach(message => {
				this.addImageRefsFromMessage(message);
			});
			
			getLogger().log(`Updated conversation in memory: ${conversationId}`);
		}
	}

	/**
	 * Clean up all temporary images when plugin is disabled/unloaded
	 */
	cleanup(): void {
		this.imageRefManager.cleanup();
		this.conversations.clear();
		this.currentConversationId = null;
		getLogger().log('AIManager cleanup completed');
	}

	private getCurrentConversation(): AIConversation | null {
		if (!this.currentConversationId) return null;
		return this.conversations.get(this.currentConversationId) || null;
	}

	private async showAIPanel(): Promise<void> {
		try {
			// Try to find existing AI panel
			let aiLeaf = this.plugin.app.workspace.getLeavesOfType(AI_CHAT_VIEW_TYPE)[0];
			
			if (!aiLeaf) {
				// Use the simplest method - create a new leaf
				aiLeaf = this.plugin.app.workspace.getLeaf(true);
				await aiLeaf.setViewState({
					type: AI_CHAT_VIEW_TYPE,
					active: true
				});
			}

			// Reveal the AI panel
			if (aiLeaf) {
				this.plugin.app.workspace.revealLeaf(aiLeaf);
			}
		} catch (error) {
			getLogger().error('Failed to show AI panel:', error);
			throw new Error(`Failed to create AI panel: ${error.message}`);
		}
	}

	private updateAIPanel(): void {
		// Find AI panel and update it
		const aiLeaf = this.plugin.app.workspace.getLeavesOfType(AI_CHAT_VIEW_TYPE)[0];
		if (aiLeaf && (aiLeaf.view as AIChatViewMethods).updateContent) {
			(aiLeaf.view as AIChatViewMethods).updateContent!();
		}
	}

	getCurrentConversationData(): AIConversation | null {
		return this.getCurrentConversation();
	}

	/**
	 * 统一的图片解析函数 - 将图片引用转换为API可用的base64数据
	 */
	private async resolveImageForAPI(imageRef: string): Promise<string | null> {
		if (imageRef.startsWith('temp:')) {
			// 临时图片 - 从内存获取base64
			const tempId = imageRef.replace('temp:', '');
			const tempData = this.imageRefManager.getTempImageData(tempId);
			if (tempData) {
				return tempData.dataUrl;
			}
			getLogger().warn(`Temp image not found: ${tempId}`);
			return null;
		} else {
			// Vault图片 - 从文件加载base64
			if (imageRef.startsWith('data:')) {
				// 已经是base64格式，直接返回
				return imageRef;
			} else if (imageRef.startsWith('[') && imageRef.endsWith(']')) {
				// 跳过占位符路径
				return null;
			} else {
				// 从vault路径加载
				return await this.loadImageDataFromPath(imageRef);
			}
		}
	}

	/**
	 * Parse markdown content to extract image references (both vault and temp images) - Public method
	 */
	parseImageReferences(markdown: string): Array<{ alt: string; path: string; fileName: string }> {
		const imageRegex = /!\[(.*?)\]\((.*?)\)/g;
		const imageReferences: Array<{ alt: string; path: string; fileName: string }> = [];
		
		let match;
		while ((match = imageRegex.exec(markdown)) !== null) {
			const alt = match[1] || 'Image';
			const path = match[2];
			
			// 获取文件名
			let fileName: string;
			if (path.startsWith('temp:')) {
				const tempId = path.replace('temp:', '');
				const tempData = this.imageRefManager.getTempImageData(tempId);
				fileName = tempData?.fileName || alt;
			} else {
				fileName = path.split('/').pop() || alt;
			}
			
			imageReferences.push({
				alt: alt,
				path: path,
				fileName: fileName
			});
		}
		
		return imageReferences;
	}

	/**
	 * Parse markdown content to separate images and text
	 */
	private parseMarkdownContent(markdown: string): { textContent: string; imageReferences: Array<{ alt: string; path: string; fileName: string }>; tempImageRefs: Array<{ id: string; dataUrl: string }> } {
		const imageRegex = /!\[(.*?)\]\((.*?)\)/g;
		const imageReferences: Array<{ alt: string; path: string; fileName: string }> = [];
		const tempImageRefs: Array<{ id: string; dataUrl: string }> = [];
		let textContent = markdown;
		
		// Extract all image references (both regular and temp://)
		let match;
		while ((match = imageRegex.exec(markdown)) !== null) {
			const alt = match[1] || 'Image';
			const path = match[2];
			
			// Check if this is a temp: protocol image
			if (path.startsWith('temp:')) {
				const tempId = path.replace('temp:', '');
				// Get from ImageReferenceManager
				const tempImageData = this.getImageReferenceManager().getTempImageData(tempId);
				if (tempImageData) {
					tempImageRefs.push({
						id: tempId,
						dataUrl: tempImageData.dataUrl
					});
				}
			} else {
				// Regular image reference
				const fileName = path.split('/').pop() || alt;
				imageReferences.push({
					alt: alt,
					path: path,
					fileName: fileName
				});
			}
			
			// Remove the image markdown from text content
			textContent = textContent.replace(match[0], '').trim();
		}
		
		// Clean up extra whitespace
		textContent = textContent.replace(/\n\s*\n/g, '\n\n').trim();
		
		return { textContent, imageReferences, tempImageRefs };
	}

	/**
	 * Load image data from vault path
	 */
	private async loadImageDataFromPath(path: string): Promise<string | null> {
		try {
			const vault = this.plugin.app.vault;
			const abstractFile = vault.getAbstractFileByPath(path);
			
			// Check if it's a file (not a folder)
			if (abstractFile instanceof TFile && abstractFile && 'extension' in abstractFile) {
				const file = abstractFile;
				const arrayBuffer = await vault.readBinary(file);
				const uint8Array = new Uint8Array(arrayBuffer);
				
				// Determine MIME type based on file extension
				const extension = file.extension?.toLowerCase();
				let mimeType = 'image/png'; // default
				
				switch (extension) {
					case 'jpg':
					case 'jpeg':
						mimeType = 'image/jpeg';
						break;
					case 'png':
						mimeType = 'image/png';
						break;
					case 'gif':
						mimeType = 'image/gif';
						break;
					case 'webp':
						mimeType = 'image/webp';
						break;
					case 'svg':
						mimeType = 'image/svg+xml';
						break;
				}
				
				// Convert to base64
				let binary = '';
				const len = uint8Array.byteLength;
				for (let i = 0; i < len; i++) {
					binary += String.fromCharCode(uint8Array[i]);
				}
				const base64 = btoa(binary);
				
				return `data:${mimeType};base64,${base64}`;
			}
		} catch (error) {
			getLogger().warn('Failed to load image from path:', path, error);
		}
		
		return null;
	}

	private generateMessageId(): string {
		return 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
	}

	private generateConversationId(): string {
		return 'conv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
	}

	/**
	 * 生成临时图片ID
	 */
	private generateTempImageId(): string {
		return 'temp_img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
	}

	/**
	 * 检查并提醒临时图片数量
	 */
	private checkTempImageLimit(conversation: AIConversation): void {
		const tempImageCount = this.countTempImagesInConversation(conversation);
		const limit = this.plugin.settings.tempImageLimit || 10; // Use setting value with fallback
		if (tempImageCount > limit) {
			new Notice(
				t('notice.tempImageLimitWarning', { count: tempImageCount.toString() }),
				8000
			);
		}
	}

	/**
	 * 统计会话中的临时图片数量
	 */
	private countTempImagesInConversation(conversation: AIConversation): number {
		let count = 0;
		for (const message of conversation.messages) {
			// 统计消息内容中的temp:引用数量
			const tempRefs = (message.content || '').match(/!\[.*?\]\(temp:[^)]+\)/g);
			if (tempRefs) {
				count += tempRefs.length;
			}
		}
		return count;
	}

	/**
	 * 为图片数组创建临时图片占位符
	 */
	createTempImagePlaceholders(imageDataUrls: string[]): { content: string; tempImages: { [key: string]: string } } {
		const tempImages: { [key: string]: string } = {};
		const placeholders: string[] = [];

		for (const dataUrl of imageDataUrls) {
			const tempId = this.generateTempImageId();
			tempImages[tempId] = dataUrl;
			placeholders.push(`![tempimage](temp://${tempId})`);
		}

		return {
			content: placeholders.join('\n\n'),
			tempImages
		};
	}

	/**
	 * 将占位符内容和临时图片合并到消息内容中
	 */
	mergeTempImagesWithContent(baseContent: string, tempImageData?: { content: string; tempImages: { [key: string]: string } }): { content: string; tempImages?: { [key: string]: string } } {
		if (!tempImageData) {
			return { content: baseContent };
		}

		const finalContent = tempImageData.content + (baseContent ? '\n\n' + baseContent : '');
		return {
			content: finalContent,
			tempImages: tempImageData.tempImages
		};
	}

	// Text-only API methods for better chat experience
	private async callOpenAITextOnly(message: string, modelConfig: ModelConfig, credentials: any): Promise<RequestUrlResponsePromise> {
		// Get baseUrl from provider config or credentials
		const provider = LLM_PROVIDERS.find(p => p.id === 'openai');
		const baseUrl = credentials.baseUrl || provider?.defaultBaseUrl || 'https://api.openai.com/v1';
		
		return requestUrl( {
			url: `${baseUrl}/chat/completions`,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${credentials.apiKey}`
			},
			body: JSON.stringify({
				model: modelConfig.modelId,
				messages: [
					{
						role: 'system',
						content: this.getEffectiveSystemPrompt()
					},
					{
						role: 'user',
						content: message
					}
				],
				max_tokens: modelConfig.settings.maxTokens,
				temperature: modelConfig.settings.temperature,
				top_p: modelConfig.settings.topP,
				frequency_penalty: modelConfig.settings.frequencyPenalty,
				presence_penalty: modelConfig.settings.presencePenalty
			})
		});
	}

	private async callClaudeTextOnly(message: string, modelConfig: ModelConfig, credentials: any): Promise<RequestUrlResponsePromise> {
		const requestBody: any = {
			model: modelConfig.modelId,
			max_tokens: modelConfig.settings.maxTokens,
			temperature: modelConfig.settings.temperature,
			messages: [{
				role: 'user',
				content: message
			}],
			system: this.getEffectiveSystemPrompt()
		};

		return requestUrl( {
			url:'https://api.anthropic.com/v1/messages',
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': credentials.apiKey,
				'anthropic-version': '2023-06-01'
			},
			body: JSON.stringify(requestBody)
		});
	}

	private async callGoogleTextOnly(message: string, modelConfig: ModelConfig, credentials: any): Promise<RequestUrlResponsePromise> {
		const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelConfig.modelId}:generateContent?key=${credentials.apiKey}`;
		
		return requestUrl( {
			url:url,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				contents: [{
					parts: [{ text: message }]
				}],
				generationConfig: {
					temperature: modelConfig.settings.temperature,
					maxOutputTokens: modelConfig.settings.maxTokens
				}
			})
		});
	}

	private async callOpenRouterTextOnly(message: string, modelConfig: ModelConfig, credentials: any): Promise<RequestUrlResponsePromise> {
		return requestUrl( {
			url:'https://openrouter.ai/api/v1/chat/completions',
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${credentials.apiKey}`,
				'HTTP-Referer': 'https://obsidian.md',
				'X-Title': 'Obsidian CaptureAI Plugin'
			},
			body: JSON.stringify({
				model: modelConfig.modelId,
				messages: [
					{
						role: 'system',
						content: this.getEffectiveSystemPrompt()
					},
					{
						role: 'user',
						content: message
					}
				],
				max_tokens: modelConfig.settings.maxTokens,
				temperature: modelConfig.settings.temperature,
				top_p: modelConfig.settings.topP,
				frequency_penalty: modelConfig.settings.frequencyPenalty,
				presence_penalty: modelConfig.settings.presencePenalty
			})
		});
	}

	private async callCustomAPITextOnly(message: string, modelConfig: ModelConfig, credentials: any): Promise<RequestUrlResponsePromise> {
		// Use customProvider from modelConfig if available (new structure)
		const customConfig = modelConfig.customProvider;
		let baseUrl: string, apiPath: string, apiKey: string;

		if (customConfig) {
			// New structure: get config from modelConfig.customProvider
			baseUrl = customConfig.baseUrl;
			apiPath = customConfig.apiPath || '/v1/chat/completions';
			apiKey = customConfig.apiKey;
		} else {
			// Fallback to old structure: get config from credentials
			if (!credentials?.baseUrl) {
				throw new Error('Base URL is required for custom provider');
			}
			baseUrl = credentials.baseUrl;
			apiPath = credentials.apiPath || '/v1/chat/completions';
			apiKey = credentials.apiKey;
		}

		// Use custom API path if provided, otherwise default to "/v1/chat/completions"
		const fullUrl = `${baseUrl.replace(/\/+$/, '')}${apiPath}`;

		return requestUrl( {
			url:fullUrl,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiKey}`
			},
			body: JSON.stringify({
				model: modelConfig.modelId,
				messages: [
					{
						role: 'system',
						content: this.getEffectiveSystemPrompt()
					},
					{
						role: 'user',
						content: message
					}
				],
				max_tokens: modelConfig.settings.maxTokens,
				temperature: modelConfig.settings.temperature
			})
		});
	}


	private getEffectiveSystemPrompt(): string {
		const globalPrompt = this.plugin.settings.globalSystemPrompt?.trim();
		return globalPrompt || 'You are a helpful AI assistant.';
	}

	private getCurrentMode(): string {
		// Get current mode from AI chat view
		const aiLeaf = this.plugin.app.workspace.getLeavesOfType(AI_CHAT_VIEW_TYPE)[0];
		if (aiLeaf && (aiLeaf.view as AIChatViewMethods).getCurrentMode) {
			return (aiLeaf.view as AIChatViewMethods).getCurrentMode!();
		}
		return 'analyze'; // default mode
	}

	private getModePrompt(mode: string): string {
		const modePrompts = this.plugin.settings.aiChatModePrompts;
		if (!modePrompts || !modePrompts[mode as keyof typeof modePrompts]) {
			return this.plugin.settings.globalSystemPrompt || '';
		}
		return modePrompts[mode as keyof typeof modePrompts];
	}

	// Context-aware API calls for different providers
	private async callOpenAIWithContext(messages: any[], modelConfig: ModelConfig, credentials: any): Promise<RequestUrlResponsePromise> {
		// Import logger
		const { getLogger } = require('../utils/logger');
		const logger = getLogger();

		const requestBody = {
			model: modelConfig.modelId,
			messages: messages,
			max_tokens: modelConfig.settings.maxTokens,
			temperature: modelConfig.settings.temperature,
			top_p: modelConfig.settings.topP,
			frequency_penalty: modelConfig.settings.frequencyPenalty,
			presence_penalty: modelConfig.settings.presencePenalty
		};

		logger.log(`📤 OpenAI API Request Body:`, JSON.stringify(requestBody, null, 2));
		logger.log(`🔑 Using API Key: ${credentials.apiKey.substring(0, 10)}...`);

		// Get baseUrl from provider config or credentials
		const provider = LLM_PROVIDERS.find(p => p.id === 'openai');
		const baseUrl = credentials.baseUrl || provider?.defaultBaseUrl || 'https://api.openai.com/v1';

		return requestUrl( {
			url: `${baseUrl}/chat/completions`,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${credentials.apiKey}`
			},
			body: JSON.stringify(requestBody)
		});
	}

	private async callClaudeWithContext(messages: any[], modelConfig: ModelConfig, credentials: any): Promise<RequestUrlResponsePromise> {
		// Filter out system messages for Claude and extract system prompt
		let systemPrompt = '';
		const filteredMessages = messages.filter(msg => {
			if (msg.role === 'system') {
				systemPrompt = msg.content;
				return false;
			}
			return true;
		});

		return requestUrl( {
			url:'https://api.anthropic.com/v1/messages',
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': credentials.apiKey,
				'anthropic-version': '2023-06-01'
			},
			body: JSON.stringify({
				model: modelConfig.modelId,
				system: systemPrompt,
				messages: filteredMessages,
				max_tokens: modelConfig.settings.maxTokens,
				temperature: modelConfig.settings.temperature,
				top_p: modelConfig.settings.topP
			})
		});
	}

	private async callGoogleWithContext(messages: any[], modelConfig: ModelConfig, credentials: any): Promise<RequestUrlResponsePromise> {
		const baseUrl = credentials.baseUrl || 'https://generativelanguage.googleapis.com';
		
		// Convert messages to Gemini format
		const geminiMessages = messages.filter(msg => msg.role !== 'system').map(msg => ({
			role: msg.role === 'assistant' ? 'model' : 'user',
			parts: Array.isArray(msg.content) ? msg.content.map((part: any) => {
				if (part.type === 'text') {
					return { text: part.text };
				} else if (part.type === 'image_url') {
					return {
						inline_data: {
							mime_type: 'image/png',
							data: part.image_url.url.split(',')[1]
						}
					};
				}
				return part;
			}) : [{ text: msg.content }]
		}));

		return requestUrl( {
			url:`${baseUrl}/v1beta/models/${modelConfig.modelId}:generateContent?key=${credentials.apiKey}`,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				contents: geminiMessages,
				generationConfig: {
					maxOutputTokens: modelConfig.settings.maxTokens,
					temperature: modelConfig.settings.temperature,
					topP: modelConfig.settings.topP
				}
			})
		});
	}

	private async callCohereWithContext(messages: any[], modelConfig: ModelConfig, credentials: any): Promise<RequestUrlResponsePromise> {
		// Cohere's chat API format
		const chatHistory = messages.filter(msg => msg.role !== 'system' && msg.role !== 'user').map(msg => ({
			role: msg.role === 'assistant' ? 'CHATBOT' : 'USER',
			message: typeof msg.content === 'string' ? msg.content : msg.content[0]?.text || ''
		}));

		// Get the latest user message
		const userMessages = messages.filter(msg => msg.role === 'user');
		const latestUserMessage = userMessages[userMessages.length - 1];
		const messageText = typeof latestUserMessage.content === 'string' 
			? latestUserMessage.content 
			: latestUserMessage.content.find((part: any) => part.type === 'text')?.text || '';

		return requestUrl( {
			url:'https://api.cohere.ai/v1/chat',
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${credentials.apiKey}`
			},
			body: JSON.stringify({
				model: modelConfig.modelId,
				message: messageText,
				chat_history: chatHistory,
				max_tokens: modelConfig.settings.maxTokens,
				temperature: modelConfig.settings.temperature,
				p: modelConfig.settings.topP
			})
		});
	}

	private async callOpenRouterWithContext(messages: any[], modelConfig: ModelConfig, credentials: any): Promise<RequestUrlResponsePromise> {
		// Import logger
		const { getLogger } = require('../utils/logger');
		const logger = getLogger();

		const baseUrl = credentials.baseUrl || 'https://openrouter.ai/api/v1';
		
		const requestBody = {
			model: modelConfig.modelId,
			messages: messages,
			max_tokens: modelConfig.settings.maxTokens,
			temperature: modelConfig.settings.temperature,
			top_p: modelConfig.settings.topP,
			frequency_penalty: modelConfig.settings.frequencyPenalty,
			presence_penalty: modelConfig.settings.presencePenalty
		};

		logger.log(`📤 OpenRouter API Request Body:`, JSON.stringify(requestBody, null, 2));
		logger.log(`🔑 Using API Key: ${credentials.apiKey.substring(0, 10)}...`);
		logger.log(`🌐 Base URL: ${baseUrl}`);

		return requestUrl( {
			url:`${baseUrl}/chat/completions`,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${credentials.apiKey}`,
				'HTTP-Referer': 'https://obsidian.md',
				'X-Title': 'Obsidian CaptureAI'
			},
			body: JSON.stringify(requestBody)
		});
	}

	private async callCustomAPIWithContext(messages: any[], modelConfig: ModelConfig, credentials: any): Promise<RequestUrlResponsePromise> {
		// Import logger
		const { getLogger } = require('../utils/logger');
		const logger = getLogger();

		const requestBody = {
			model: modelConfig.modelId,
			messages: messages,
			max_tokens: modelConfig.settings.maxTokens,
			temperature: modelConfig.settings.temperature,
			top_p: modelConfig.settings.topP,
			frequency_penalty: modelConfig.settings.frequencyPenalty,
			presence_penalty: modelConfig.settings.presencePenalty
		};

		const fullUrl = `${credentials.baseUrl}${credentials.apiPath || '/v1/chat/completions'}`;

		logger.log(`📤 Custom API Request Body:`, JSON.stringify(requestBody, null, 2));
		logger.log(`🔑 Using API Key: ${credentials.apiKey.substring(0, 10)}...`);
		logger.log(`🌐 Full URL: ${fullUrl}`);

		// For custom APIs, we'll use OpenAI format as the default
		return requestUrl( {
			url:fullUrl,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${credentials.apiKey}`
			},
			body: JSON.stringify(requestBody)
		});
	}

	// Calculate safe maxTokens to avoid context window overflow
	private calculateSafeMaxTokens(messages: any[], modelConfig: ModelConfig): number {
		// Import logger
		const { getLogger } = require('../utils/logger');
		const logger = getLogger();

		// Get model's context window from type definitions
		const model = this.getModelInfo(modelConfig.providerId, modelConfig.modelId);
		const contextWindow = model?.contextWindow || 4096; // Fallback to conservative estimate
		
		logger.log(`🔍 Model info for ${modelConfig.modelId}: contextWindow = ${contextWindow}, found = ${!!model}`);
		
		// Estimate tokens in messages (rough approximation)
		const estimatedInputTokens = this.estimateTokens(messages);
		
		// Reserve space for input + safety margin (20% of context window)
		const safetyMargin = Math.floor(contextWindow * 0.2);
		const maxOutputTokens = contextWindow - estimatedInputTokens - safetyMargin;
		
		// Ensure we don't exceed the configured maxTokens or go below a minimum
		const configuredMax = modelConfig.settings.maxTokens;
		const minimumTokens = 512; // Minimum reasonable output
		
		const finalMaxTokens = Math.max(
			minimumTokens,
			Math.min(configuredMax, maxOutputTokens)
		);
		
		logger.log(`🧮 Token calculation - Context Window: ${contextWindow}, Input: ${estimatedInputTokens}, Safety Margin: ${safetyMargin}, Final Max: ${finalMaxTokens}`);
		
		return finalMaxTokens;
	}

	// Get model information from type definitions
	private getModelInfo(providerId: string, modelId: string): { contextWindow?: number } | null {
		// Import the providers from types
		const { LLM_PROVIDERS } = require('../types');
		const provider = LLM_PROVIDERS.find((p: any) => p.id === providerId);
		if (!provider) return null;
		
		const model = provider.models.find((m: any) => m.id === modelId);
		if (model) return model;
		
		// Smart inference for unknown models based on model name patterns
		const lowerModelId = modelId.toLowerCase();
		
		// Qwen models typically have 32K context window
		if (lowerModelId.includes('qwen')) {
			return { contextWindow: 32768 };  // 32K context window
		}
		
		// GPT-4 models typically have large context
		if (lowerModelId.includes('gpt-4')) {
			return { contextWindow: 128000 }; // 128K context window
		}
		
		// Claude models typically have large context
		if (lowerModelId.includes('claude')) {
			return { contextWindow: 200000 }; // 200K context window
		}
		
		// Conservative fallback
		return { contextWindow: 16384 }; // 16K context window
	}

	// Simple token estimation (rough approximation: 1 token ≈ 4 characters for text, special handling for images)
	private estimateTokens(messages: any[]): number {
		let totalTokens = 0;
		
		for (const message of messages) {
			if (typeof message.content === 'string') {
				// Simple text message
				totalTokens += Math.ceil(message.content.length / 4);
			} else if (Array.isArray(message.content)) {
				// Multi-modal message
				for (const content of message.content) {
					if (content.type === 'text') {
						totalTokens += Math.ceil((content.text || '').length / 4);
					} else if (content.type === 'image_url') {
						// Images typically cost ~1500 tokens for vision models
						totalTokens += 1500;
					}
				}
			}
		}
		
		// Add some overhead for system prompts and formatting
		totalTokens += 100;
		
		return totalTokens;
	}

	// Extract MIME type from data URL
	private getMimeTypeFromDataUrl(dataUrl: string): string | null {
		const match = dataUrl.match(/^data:([^;]+);base64,/);
		return match ? match[1] : null;
	}

	// Create properly formatted image URL for API
	private createImageDataUrl(dataUrl: string, base64: string): string {
		const mimeType = this.getMimeTypeFromDataUrl(dataUrl) || 'image/png';
		return `data:${mimeType};base64,${base64}`;
	}
}