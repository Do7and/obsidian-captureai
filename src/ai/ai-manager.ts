import { Notice, WorkspaceLeaf } from 'obsidian';
import ImageCapturePlugin from '../main';
import { LLM_PROVIDERS, ModelConfig } from '../types';
import { AI_CHAT_VIEW_TYPE } from './ai-chat-view';

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
}

export class AIManager {
	private plugin: ImageCapturePlugin;
	private conversations: Map<string, AIConversation> = new Map();
	private currentConversationId: string | null = null;

	constructor(plugin: ImageCapturePlugin) {
		this.plugin = plugin;
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
			const fileNames = images.map(img => img.fileName).join(', ');
			conversation = this.createNewConversation(`Multi-Image Analysis - ${fileNames}`);
		}

		// Add user message with all images
		const defaultMessage = images.length === 1 ? 'Please analyze this image' : `Please analyze these ${images.length} images`;
		const userMsg: AIMessage = {
			id: this.generateMessageId(),
			type: 'user',
			content: userMessage || defaultMessage,
			image: images[0].dataUrl, // Use first image for display compatibility
			timestamp: new Date()
		};
		// Store all images with both dataUrl and localPath for display and saving
		(userMsg as any).images = images.map(img => ({
			dataUrl: img.dataUrl,
			fileName: img.fileName,
			localPath: img.localPath
		}));
		conversation.messages.push(userMsg);

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
			// Combine prompts for image analysis
			const fullMessage = this.combinePromptsForImages(userMsg.content, images.length);
			
			// Call AI API with context support using images array
			const response = await this.callAIWithContext(
				conversation, 
				fullMessage, 
				images.map(img => img.dataUrl), 
				defaultModelConfig
			);

			// Remove typing indicator
			const typingIndex = conversation.messages.findIndex(m => m.id === typingMessage.id);
			if (typingIndex > -1) {
				conversation.messages.splice(typingIndex, 1);
			}

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
			console.error('AI API call failed:', error);
			
			// Remove typing indicator
			const typingIndex = conversation.messages.findIndex(m => m.hasOwnProperty('isTyping'));
			if (typingIndex > -1) {
				conversation.messages.splice(typingIndex, 1);
			}

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
	buildContextMessages(conversation: AIConversation | null, currentMessage: string, currentImages?: string[], modelConfig?: ModelConfig): any[] {
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

		// Add system prompt if enabled
		if (contextSettings.includeSystemPrompt) {
			messages.push({
				role: 'system',
				content: this.getEffectiveSystemPrompt()
			});
		}

		// Add historical messages if conversation exists
		if (conversation && conversation.messages.length > 0) {
			let historicalMessages = conversation.messages.slice(); // Copy array
			let imageCount = 0;

			// Filter out error messages to prevent context pollution
			historicalMessages = historicalMessages.filter(msg => {
				// Skip error messages that start with "Error:"
				if (msg.type === 'assistant' && msg.content.startsWith('Error:')) {
					return false;
				}
				return true;
			});

			// Apply context strategy
			if (contextSettings.contextStrategy === 'recent') {
				// Take the most recent messages up to the limit
				historicalMessages = historicalMessages.slice(-contextSettings.maxContextMessages);
			} else if (contextSettings.contextStrategy === 'smart') {
				// Smart selection: prioritize messages with images and recent messages
				const messagesWithImages = historicalMessages.filter(m => m.image);
				const messagesWithoutImages = historicalMessages.filter(m => !m.image);
				
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
				if (msg.isTyping) continue; // Skip typing indicators

				const role = msg.type === 'user' ? 'user' : 'assistant';
				
				if (msg.image && isVisionCapable && imageCount < contextSettings.maxContextImages) {
					// Message with image - only include if model supports vision
					const messageContent = [
						{ type: 'text', text: msg.content }
					];
					
					// Add image if within limit and model supports vision
					if (imageCount < contextSettings.maxContextImages) {
						(messageContent as any).push({
							type: 'image_url',
							image_url: { url: msg.image }
						});
						imageCount++;
					}
					
					messages.push({
						role: role,
						content: messageContent
					});
				} else {
					// Text-only message (either no image or model doesn't support vision)
					messages.push({
						role: role,
						content: msg.content
					});
				}
			}
		}

		// Add current message
		if (currentImages && currentImages.length > 0 && isVisionCapable) {
			// Current message with images - only if model supports vision
			const messageContent = [
				{ type: 'text', text: currentMessage }
			];
			
			// Add current images
			for (const imageDataUrl of currentImages) {
				(messageContent as any).push({
					type: 'image_url',
					image_url: { url: imageDataUrl }
				});
			}
			
			messages.push({
				role: 'user',
				content: messageContent
			});
		} else {
			// Current text-only message (either no images or model doesn't support vision)
			messages.push({
				role: 'user',
				content: currentMessage
			});
		}

		return messages;
	}

	// New API call with context support
	async callAIWithContext(conversation: AIConversation | null, message: string, images?: string[], modelConfig?: ModelConfig): Promise<string> {
		// Use provided model config or default
		const targetModelConfig = modelConfig || this.plugin.settings.modelConfigs.find(
			mc => mc.id === this.plugin.settings.defaultModelConfigId
		);
		
		if (!targetModelConfig) {
			throw new Error('No model configured');
		}

		// Build context messages
		const contextMessages = this.buildContextMessages(conversation, message, images, targetModelConfig);
		
		// Call appropriate API with context
		return await this.callAPIWithContextMessages(contextMessages, targetModelConfig);
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

		let response: Response;

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

		console.log(`API Response Status: ${response.status}, URL: ${response.url}`);

		if (!response.ok) {
			const errorText = await response.text();
			console.error(`API call failed. Status: ${response.status}, URL: ${response.url}, Response: ${errorText}`);
			throw new Error(`API call failed: ${response.status} ${errorText}`);
		}

		const responseText = await response.text();
		console.log('API Response Length:', responseText.length);
		console.log('API Response Preview:', responseText.substring(0, 200) + '...');
		console.log('API Response End:', responseText.substring(Math.max(0, responseText.length - 200)));
		
		// Check if response appears to be truncated (doesn't end properly)
		if (responseText.includes('<think>') && !responseText.includes('</think>')) {
			console.warn('⚠️ Thinking response appears to be truncated - missing closing tag');
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

	private async callAIAPIWithMultipleImages(message: string, imageDataUrls: string[], modelConfig: ModelConfig): Promise<string> {
		// Vision capability is now determined during model addition, so we can trust modelConfig.isVisionCapable
		if (!modelConfig.isVisionCapable) {
			throw new Error('Selected model does not support vision');
		}

		// Get provider credentials
		const credentials = this.plugin.settings.providerCredentials[modelConfig.providerId];
		if (!credentials || !credentials.verified || !credentials.apiKey.trim()) {
			throw new Error('Provider credentials not verified');
		}

		console.log(`Calling AI API with ${imageDataUrls.length} images - Provider: ${modelConfig.providerId}, Model: ${modelConfig.modelId}`);

		let response: Response;

		if (modelConfig.providerId === 'openai') {
			response = await this.callOpenAIWithMultipleImages(message, imageDataUrls, modelConfig, credentials);
		} else if (modelConfig.providerId === 'anthropic') {
			response = await this.callClaudeWithMultipleImages(message, imageDataUrls, modelConfig, credentials);
		} else if (modelConfig.providerId === 'google') {
			response = await this.callGoogleWithMultipleImages(message, imageDataUrls, modelConfig, credentials);
		} else if (modelConfig.providerId === 'openrouter') {
			response = await this.callOpenRouterWithMultipleImages(message, imageDataUrls, modelConfig, credentials);
		} else if (modelConfig.providerId === 'custom' || modelConfig.providerId.startsWith('custom_')) {
			response = await this.callCustomAPIWithMultipleImages(message, imageDataUrls, modelConfig, credentials);
		} else {
			// Fallback to single image for unsupported providers
			return await this.callAIAPI(message, imageDataUrls[0], modelConfig);
		}

		console.log(`Multi-image API Response Status: ${response.status}`);

		if (!response.ok) {
			const errorText = await response.text();
			console.error(`Multi-image API call failed. Status: ${response.status}, Response: ${errorText}`);
			throw new Error(`API call failed: ${response.status} ${errorText}`);
		}

		const responseText = await response.text();
		console.log('Multi-image API Response:', responseText.substring(0, 200) + '...');
		
		let data;
		try {
			data = JSON.parse(responseText);
		} catch (parseError) {
			console.error('Failed to parse JSON response:', parseError);
			throw new Error(`Invalid JSON response from API. Response starts with: ${responseText.substring(0, 100)}`);
		}
		return this.extractResponseContent(data, modelConfig.providerId);
	}

	private async callAIAPI(message: string, imageDataUrl: string, modelConfig: ModelConfig): Promise<string> {
		// Vision capability is now determined during model addition, so we can trust modelConfig.isVisionCapable
		if (!modelConfig.isVisionCapable) {
			throw new Error('Selected model does not support vision');
		}

		// Get provider credentials
		const credentials = this.plugin.settings.providerCredentials[modelConfig.providerId];
		if (!credentials || !credentials.verified || !credentials.apiKey.trim()) {
			throw new Error('Provider credentials not verified');
		}

		console.log(`Calling AI API - Provider: ${modelConfig.providerId}, Model: ${modelConfig.modelId}`);
		console.log(`API Key present: ${!!credentials.apiKey}`);
		if (credentials.baseUrl) {
			console.log(`Base URL: ${credentials.baseUrl}`);
		}

		// Extract base64 and MIME type from data URL
		const base64Image = imageDataUrl.split(',')[1];
		const mimeType = this.getMimeTypeFromDataUrl(imageDataUrl) || 'image/png';

		let response: Response;

		if (modelConfig.providerId === 'openai') {
			response = await this.callOpenAI(message, imageDataUrl, modelConfig, credentials);
		} else if (modelConfig.providerId === 'anthropic') {
			response = await this.callClaude(message, imageDataUrl, modelConfig, credentials);
		} else if (modelConfig.providerId === 'google') {
			response = await this.callGoogle(message, imageDataUrl, modelConfig, credentials);
		} else if (modelConfig.providerId === 'cohere') {
			response = await this.callCohere(message, base64Image, modelConfig, credentials);
		} else if (modelConfig.providerId === 'openrouter') {
			response = await this.callOpenRouter(message, imageDataUrl, modelConfig, credentials);
		} else if (modelConfig.providerId === 'custom' || modelConfig.providerId.startsWith('custom_')) {
			response = await this.callCustomAPI(message, imageDataUrl, modelConfig, credentials);
		} else {
			throw new Error(`Unsupported provider: ${modelConfig.providerId}`);
		}

		console.log(`API Response Status: ${response.status}, URL: ${response.url}`);

		if (!response.ok) {
			const errorText = await response.text();
			console.error(`API call failed. Status: ${response.status}, URL: ${response.url}, Response: ${errorText}`);
			throw new Error(`API call failed: ${response.status} ${errorText}`);
		}

		const responseText = await response.text();
		console.log('API Response Length:', responseText.length);
		console.log('API Response Preview:', responseText.substring(0, 200) + '...');
		console.log('API Response End:', responseText.substring(Math.max(0, responseText.length - 200)));
		
		// Check if response appears to be truncated (doesn't end properly)
		if (responseText.includes('<think>') && !responseText.includes('</think>')) {
			console.warn('⚠️ Thinking response appears to be truncated - missing closing tag');
		}
		
		let data;
		try {
			data = JSON.parse(responseText);
		} catch (parseError) {
			console.error('Failed to parse JSON response:', parseError);
			console.error('Response text:', responseText);
			throw new Error(`Invalid JSON response from API. Response starts with: ${responseText.substring(0, 100)}`);
		}
		return this.extractResponseContent(data, modelConfig.providerId);
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

		console.log(`Calling text-only AI API - Provider: ${modelConfig.providerId}, Model: ${modelConfig.modelId}`);

		let response: Response;

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

		console.log(`Text API Response Status: ${response.status}, URL: ${response.url}`);

		if (!response.ok) {
			const errorText = await response.text();
			console.error(`Text API call failed. Status: ${response.status}, Response: ${errorText}`);
			throw new Error(`API call failed: ${response.status} ${errorText}`);
		}

		const responseText = await response.text();
		console.log('Text API Response:', responseText.substring(0, 200) + '...');
		
		let data;
		try {
			data = JSON.parse(responseText);
		} catch (parseError) {
			console.error('Failed to parse JSON response:', parseError);
			throw new Error(`Invalid JSON response from API. Response starts with: ${responseText.substring(0, 100)}`);
		}
		return this.extractResponseContent(data, modelConfig.providerId);
	}

	private async callOpenAI(message: string, imageDataUrl: string, modelConfig: ModelConfig, credentials: any): Promise<Response> {
		return fetch('https://api.openai.com/v1/chat/completions', {
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
						content: [
							{ type: 'text', text: message },
							{ 
								type: 'image_url', 
								image_url: { 
									url: imageDataUrl
								} 
							}
						]
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

	private async callClaude(message: string, imageDataUrl: string, modelConfig: ModelConfig, credentials: any): Promise<Response> {
		const messages = [];
		
		const base64Data = imageDataUrl.split(',')[1];
		const mimeType = this.getMimeTypeFromDataUrl(imageDataUrl) || 'image/png';
		
		messages.push({
			role: 'user',
			content: [
				{ type: 'text', text: message },
				{
					type: 'image',
					source: {
						type: 'base64',
						media_type: mimeType,
						data: base64Data
					}
				}
			]
		});

		const requestBody: any = {
			model: modelConfig.modelId,
			max_tokens: modelConfig.settings.maxTokens,
			temperature: modelConfig.settings.temperature,
			messages: messages,
			system: this.getEffectiveSystemPrompt()
		};

		return fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': credentials.apiKey,
				'anthropic-version': '2023-06-01'
			},
			body: JSON.stringify(requestBody)
		});
	}

	private async callGoogle(message: string, imageDataUrl: string, modelConfig: ModelConfig, credentials: any): Promise<Response> {
		// Gemini API implementation
		const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelConfig.modelId}:generateContent?key=${credentials.apiKey}`;
		
		const base64Data = imageDataUrl.split(',')[1];
		const mimeType = this.getMimeTypeFromDataUrl(imageDataUrl) || 'image/png';
		
		return fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				contents: [{
					parts: [
						{ text: message },
						{
							inline_data: {
								mime_type: mimeType,
								data: base64Data
							}
						}
					]
				}],
				generationConfig: {
					temperature: modelConfig.settings.temperature,
					maxOutputTokens: modelConfig.settings.maxTokens
				}
			})
		});
	}

	private async callCohere(message: string, base64Image: string, modelConfig: ModelConfig, credentials: any): Promise<Response> {
		// Note: Cohere doesn't support vision models in the same way
		// This is a placeholder implementation
		throw new Error('Cohere vision models not yet supported');
	}

	private async callOpenRouter(message: string, imageDataUrl: string, modelConfig: ModelConfig, credentials: any): Promise<Response> {
		// OpenRouter uses OpenAI-compatible API format
		return fetch('https://openrouter.ai/api/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${credentials.apiKey}`,
				'HTTP-Referer': 'https://obsidian.md', // Optional: for analytics
				'X-Title': 'Obsidian Screenshot Capture Plugin' // Optional: for analytics
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
						content: [
							{ type: 'text', text: message },
							{ 
								type: 'image_url', 
								image_url: { 
									url: imageDataUrl
								} 
							}
						]
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

	private async callCustomAPI(message: string, imageDataUrl: string, modelConfig: ModelConfig, credentials: any): Promise<Response> {
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

		console.log(`Custom API URL: ${fullUrl}`);

		// Default to OpenAI-compatible format for custom APIs
		return fetch(fullUrl, {
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
						content: [
							{ type: 'text', text: message },
							{ 
								type: 'image_url', 
								image_url: { 
									url: imageDataUrl
								} 
							}
						]
					}
				],
				max_tokens: modelConfig.settings.maxTokens,
				temperature: modelConfig.settings.temperature
			})
		});
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
			console.error('Failed to extract response content:', error);
			return 'Failed to parse AI response';
		}
	}

	createNewConversation(title: string): AIConversation {
		const conversation: AIConversation = {
			id: this.generateConversationId(),
			title,
			messages: [],
			createdAt: new Date(),
			lastUpdated: new Date()
		};
		
		this.conversations.set(conversation.id, conversation);
		this.currentConversationId = conversation.id;
		return conversation;
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
			console.error('Failed to show AI panel:', error);
			throw new Error(`Failed to create AI panel: ${error.message}`);
		}
	}

	private updateAIPanel(): void {
		// Find AI panel and update it
		const aiLeaf = this.plugin.app.workspace.getLeavesOfType(AI_CHAT_VIEW_TYPE)[0];
		if (aiLeaf && (aiLeaf.view as any).updateContent) {
			(aiLeaf.view as any).updateContent();
		}
	}

	getCurrentConversationData(): AIConversation | null {
		return this.getCurrentConversation();
	}

	private generateMessageId(): string {
		return 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
	}

	private generateConversationId(): string {
		return 'conv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
	}

	// Text-only API methods for better chat experience
	private async callOpenAITextOnly(message: string, modelConfig: ModelConfig, credentials: any): Promise<Response> {
		return fetch('https://api.openai.com/v1/chat/completions', {
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

	private async callClaudeTextOnly(message: string, modelConfig: ModelConfig, credentials: any): Promise<Response> {
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

		return fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': credentials.apiKey,
				'anthropic-version': '2023-06-01'
			},
			body: JSON.stringify(requestBody)
		});
	}

	private async callGoogleTextOnly(message: string, modelConfig: ModelConfig, credentials: any): Promise<Response> {
		const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelConfig.modelId}:generateContent?key=${credentials.apiKey}`;
		
		return fetch(url, {
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

	private async callOpenRouterTextOnly(message: string, modelConfig: ModelConfig, credentials: any): Promise<Response> {
		return fetch('https://openrouter.ai/api/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${credentials.apiKey}`,
				'HTTP-Referer': 'https://obsidian.md',
				'X-Title': 'Obsidian Screenshot Capture Plugin'
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

	private async callCustomAPITextOnly(message: string, modelConfig: ModelConfig, credentials: any): Promise<Response> {
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

		return fetch(fullUrl, {
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

	private combinePromptsForImages(userMessage: string, imageCount: number): string {
		const currentMode = this.getCurrentMode();
		const modePrompt = this.getModePrompt(currentMode);
		
		if (!modePrompt.trim()) {
			return userMessage;
		}
		
		// Handle both single and multiple images uniformly
		if (imageCount === 1) {
			// Single image case
			if (userMessage === 'Please analyze this image') {
				return modePrompt;
			} else {
				return `${modePrompt}\n\nUser request: ${userMessage}`;
			}
		} else {
			// Multiple images case
			if (userMessage === `Please analyze these ${imageCount} images`) {
				return `${modePrompt} (analyzing ${imageCount} images)`;
			} else {
				return `${modePrompt}\n\nUser request for ${imageCount} images: ${userMessage}`;
			}
		}
	}

	private getEffectiveSystemPrompt(): string {
		const globalPrompt = this.plugin.settings.globalSystemPrompt?.trim();
		return globalPrompt || 'You are a helpful AI assistant.';
	}

	private getCurrentMode(): string {
		// Get current mode from AI chat view
		const aiLeaf = this.plugin.app.workspace.getLeavesOfType(AI_CHAT_VIEW_TYPE)[0];
		if (aiLeaf && (aiLeaf.view as any).getCurrentMode) {
			return (aiLeaf.view as any).getCurrentMode();
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

	cleanup(): void {
		this.conversations.clear();
		this.currentConversationId = null;
	}

	// Multi-image API methods
	private async callOpenAIWithMultipleImages(message: string, dataUrls: string[], modelConfig: ModelConfig, credentials: any): Promise<Response> {
		const imageContent = dataUrls.map(dataUrl => {
			const base64Data = dataUrl.split(',')[1];
			const mimeType = this.getMimeTypeFromDataUrl(dataUrl) || 'image/png';
			return {
				type: 'image_url',
				image_url: {
					url: `data:${mimeType};base64,${base64Data}`
				}
			};
		});

		return fetch('https://api.openai.com/v1/chat/completions', {
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
						content: [
							{ type: 'text', text: message },
							...imageContent
						]
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

	private async callClaudeWithMultipleImages(message: string, dataUrls: string[], modelConfig: ModelConfig, credentials: any): Promise<Response> {
		const imageContent = dataUrls.map(dataUrl => {
			const base64Data = dataUrl.split(',')[1];
			const mimeType = this.getMimeTypeFromDataUrl(dataUrl) || 'image/png';
			return {
				type: 'image',
				source: {
					type: 'base64',
					media_type: mimeType,
					data: base64Data
				}
			};
		});

		const messages = [{
			role: 'user',
			content: [
				{ type: 'text', text: message },
				...imageContent
			]
		}];

		const requestBody: any = {
			model: modelConfig.modelId,
			max_tokens: modelConfig.settings.maxTokens,
			temperature: modelConfig.settings.temperature,
			messages: messages,
			system: this.getEffectiveSystemPrompt()
		};

		return fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': credentials.apiKey,
				'anthropic-version': '2023-06-01'
			},
			body: JSON.stringify(requestBody)
		});
	}

	private async callGoogleWithMultipleImages(message: string, dataUrls: string[], modelConfig: ModelConfig, credentials: any): Promise<Response> {
		const imageParts = dataUrls.map(dataUrl => {
			const base64Data = dataUrl.split(',')[1];
			const mimeType = this.getMimeTypeFromDataUrl(dataUrl) || 'image/png';
			return {
				inline_data: {
					mime_type: mimeType,
					data: base64Data
				}
			};
		});

		const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelConfig.modelId}:generateContent?key=${credentials.apiKey}`;
		
		return fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				contents: [{
					parts: [
						{ text: message },
						...imageParts
					]
				}],
				generationConfig: {
					temperature: modelConfig.settings.temperature,
					maxOutputTokens: modelConfig.settings.maxTokens
				}
			})
		});
	}

	private async callOpenRouterWithMultipleImages(message: string, dataUrls: string[], modelConfig: ModelConfig, credentials: any): Promise<Response> {
		const imageContent = dataUrls.map(dataUrl => {
			const base64Data = dataUrl.split(',')[1];
			const mimeType = this.getMimeTypeFromDataUrl(dataUrl) || 'image/png';
			return {
				type: 'image_url',
				image_url: {
					url: `data:${mimeType};base64,${base64Data}`
				}
			};
		});

		return fetch('https://openrouter.ai/api/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${credentials.apiKey}`,
				'HTTP-Referer': 'https://obsidian.md',
				'X-Title': 'Obsidian Screenshot Capture Plugin'
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
						content: [
							{ type: 'text', text: message },
							...imageContent
						]
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

	private async callCustomAPIWithMultipleImages(message: string, dataUrls: string[], modelConfig: ModelConfig, credentials: any): Promise<Response> {
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

		const imageContent = dataUrls.map(dataUrl => {
			const base64Data = dataUrl.split(',')[1];
			const mimeType = this.getMimeTypeFromDataUrl(dataUrl) || 'image/png';
			return {
				type: 'image_url',
				image_url: {
					url: `data:${mimeType};base64,${base64Data}`
				}
			};
		});

		// Default to OpenAI-compatible format for custom APIs
		return fetch(fullUrl, {
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
						content: [
							{ type: 'text', text: message },
							...imageContent
						]
					}
				],
				max_tokens: modelConfig.settings.maxTokens,
				temperature: modelConfig.settings.temperature
			})
		});
	}

	// Context-aware API calls for different providers
	private async callOpenAIWithContext(messages: any[], modelConfig: ModelConfig, credentials: any): Promise<Response> {
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

		return fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${credentials.apiKey}`
			},
			body: JSON.stringify(requestBody)
		});
	}

	private async callClaudeWithContext(messages: any[], modelConfig: ModelConfig, credentials: any): Promise<Response> {
		// Filter out system messages for Claude and extract system prompt
		let systemPrompt = '';
		const filteredMessages = messages.filter(msg => {
			if (msg.role === 'system') {
				systemPrompt = msg.content;
				return false;
			}
			return true;
		});

		return fetch('https://api.anthropic.com/v1/messages', {
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

	private async callGoogleWithContext(messages: any[], modelConfig: ModelConfig, credentials: any): Promise<Response> {
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

		return fetch(`${baseUrl}/v1beta/models/${modelConfig.modelId}:generateContent?key=${credentials.apiKey}`, {
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

	private async callCohereWithContext(messages: any[], modelConfig: ModelConfig, credentials: any): Promise<Response> {
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

		return fetch('https://api.cohere.ai/v1/chat', {
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

	private async callOpenRouterWithContext(messages: any[], modelConfig: ModelConfig, credentials: any): Promise<Response> {
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

		return fetch(`${baseUrl}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${credentials.apiKey}`,
				'HTTP-Referer': 'https://obsidian.md',
				'X-Title': 'Obsidian Screenshot Capture'
			},
			body: JSON.stringify(requestBody)
		});
	}

	private async callCustomAPIWithContext(messages: any[], modelConfig: ModelConfig, credentials: any): Promise<Response> {
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
		return fetch(fullUrl, {
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