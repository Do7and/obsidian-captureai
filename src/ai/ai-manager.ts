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

	async sendImagesToAI(images: { dataUrl: string, fileName: string, localPath?: string | null }[], userMessage: string): Promise<void> {
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
		const userMsg: AIMessage = {
			id: this.generateMessageId(),
			type: 'user',
			content: userMessage || `Please analyze these ${images.length} images`,
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
			
			// Call AI API with context support using multiple images
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

	async sendImageToAI(imageDataUrl: string, userMessage: string, fileName: string): Promise<void> {
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
			conversation = this.createNewConversation(`Image Analysis - ${fileName}`);
		}

		// Add user message with image
		const userMsg: AIMessage = {
			id: this.generateMessageId(),
			type: 'user',
			content: userMessage || 'Please analyze this image',
			image: imageDataUrl,
			timestamp: new Date()
		};
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
			const fullMessage = this.combinePromptsForImage(userMsg.content);
			
			// Call AI API using the configured model
			const response = await this.callAIAPI(fullMessage, imageDataUrl, defaultModelConfig);

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

	async callAIForFollowUp(message: string, imageDataUrl: string): Promise<string> {
		// Use the current default model for follow-up
		const defaultModelConfig = this.plugin.settings.modelConfigs.find(
			mc => mc.id === this.plugin.settings.defaultModelConfigId
		);
		
		if (!defaultModelConfig) {
			throw new Error('No default model configured');
		}
		
		return await this.callAIAPI(message, imageDataUrl, defaultModelConfig);
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
	buildContextMessages(conversation: AIConversation | null, currentMessage: string, currentImages?: string[]): any[] {
		const messages: any[] = [];
		const contextSettings = this.plugin.settings.contextSettings || {
			maxContextMessages: 20,
			maxContextImages: 3,
			includeSystemPrompt: true,
			contextStrategy: 'recent'
		};

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
				
				if (msg.image && imageCount < contextSettings.maxContextImages) {
					// Message with image
					const messageContent = [
						{ type: 'text', text: msg.content }
					];
					
					// Add image if within limit
					if (imageCount < contextSettings.maxContextImages) {
						messageContent.push({
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
					// Text-only message
					messages.push({
						role: role,
						content: msg.content
					});
				}
			}
		}

		// Add current message
		if (currentImages && currentImages.length > 0) {
			// Current message with images
			const messageContent = [
				{ type: 'text', text: currentMessage }
			];
			
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
	async callAIWithContext(conversation: AIConversation | null, message: string, images?: string[], modelConfig?: ModelConfig): Promise<string> {
		// Use provided model config or default
		const targetModelConfig = modelConfig || this.plugin.settings.modelConfigs.find(
			mc => mc.id === this.plugin.settings.defaultModelConfigId
		);
		
		if (!targetModelConfig) {
			throw new Error('No model configured');
		}

		// Build context messages
		const contextMessages = this.buildContextMessages(conversation, message, images);
		
		// Call appropriate API with context
		return await this.callAPIWithContextMessages(contextMessages, targetModelConfig);
	}

	// New function to call API with pre-built context messages
	private async callAPIWithContextMessages(messages: any[], modelConfig: ModelConfig): Promise<string> {
		// Get provider credentials
		const credentials = this.plugin.settings.providerCredentials[modelConfig.providerId];
		if (!credentials || !credentials.verified || !credentials.apiKey.trim()) {
			throw new Error('Provider credentials not verified');
		}

		console.log(`Calling AI API with context - Provider: ${modelConfig.providerId}, Model: ${modelConfig.modelId}`);
		console.log(`Context messages count: ${messages.length}`);

		let response: Response;

		if (modelConfig.providerId === 'openai') {
			response = await this.callOpenAIWithContext(messages, modelConfig, credentials);
		} else if (modelConfig.providerId === 'anthropic') {
			response = await this.callClaudeWithContext(messages, modelConfig, credentials);
		} else if (modelConfig.providerId === 'google') {
			response = await this.callGoogleWithContext(messages, modelConfig, credentials);
		} else if (modelConfig.providerId === 'cohere') {
			response = await this.callCohereWithContext(messages, modelConfig, credentials);
		} else if (modelConfig.providerId === 'openrouter') {
			response = await this.callOpenRouterWithContext(messages, modelConfig, credentials);
		} else if (modelConfig.providerId === 'custom' || modelConfig.providerId.startsWith('custom_')) {
			response = await this.callCustomAPIWithContext(messages, modelConfig, credentials);
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

		// Convert data URLs to base64
		const base64Images = imageDataUrls.map(dataUrl => dataUrl.split(',')[1]);

		let response: Response;

		if (modelConfig.providerId === 'openai') {
			response = await this.callOpenAIWithMultipleImages(message, base64Images, modelConfig, credentials);
		} else if (modelConfig.providerId === 'anthropic') {
			response = await this.callClaudeWithMultipleImages(message, base64Images, modelConfig, credentials);
		} else if (modelConfig.providerId === 'google') {
			response = await this.callGoogleWithMultipleImages(message, base64Images, modelConfig, credentials);
		} else if (modelConfig.providerId === 'openrouter') {
			response = await this.callOpenRouterWithMultipleImages(message, base64Images, modelConfig, credentials);
		} else if (modelConfig.providerId === 'custom' || modelConfig.providerId.startsWith('custom_')) {
			response = await this.callCustomAPIWithMultipleImages(message, base64Images, modelConfig, credentials);
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

		// Convert data URL to base64
		const base64Image = imageDataUrl.split(',')[1];

		let response: Response;

		if (modelConfig.providerId === 'openai') {
			response = await this.callOpenAI(message, base64Image, modelConfig, credentials);
		} else if (modelConfig.providerId === 'anthropic') {
			response = await this.callClaude(message, base64Image, modelConfig, credentials);
		} else if (modelConfig.providerId === 'google') {
			response = await this.callGoogle(message, base64Image, modelConfig, credentials);
		} else if (modelConfig.providerId === 'cohere') {
			response = await this.callCohere(message, base64Image, modelConfig, credentials);
		} else if (modelConfig.providerId === 'openrouter') {
			response = await this.callOpenRouter(message, base64Image, modelConfig, credentials);
		} else if (modelConfig.providerId === 'custom' || modelConfig.providerId.startsWith('custom_')) {
			response = await this.callCustomAPI(message, base64Image, modelConfig, credentials);
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

	private async callOpenAI(message: string, base64Image: string, modelConfig: ModelConfig, credentials: any): Promise<Response> {
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
									url: `data:image/png;base64,${base64Image}` 
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

	private async callClaude(message: string, base64Image: string, modelConfig: ModelConfig, credentials: any): Promise<Response> {
		const messages = [];
		
		messages.push({
			role: 'user',
			content: [
				{ type: 'text', text: message },
				{
					type: 'image',
					source: {
						type: 'base64',
						media_type: 'image/png',
						data: base64Image
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

	private async callGoogle(message: string, base64Image: string, modelConfig: ModelConfig, credentials: any): Promise<Response> {
		// Gemini API implementation
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
						{
							inline_data: {
								mime_type: 'image/png',
								data: base64Image
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

	private async callOpenRouter(message: string, base64Image: string, modelConfig: ModelConfig, credentials: any): Promise<Response> {
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
									url: `data:image/png;base64,${base64Image}` 
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

	private async callCustomAPI(message: string, base64Image: string, modelConfig: ModelConfig, credentials: any): Promise<Response> {
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
									url: `data:image/png;base64,${base64Image}` 
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
		
		// Combine mode prompt with user message naturally for multiple images
		if (userMessage === `Please analyze these ${imageCount} images`) {
			return `${modePrompt} (analyzing ${imageCount} images)`;
		} else {
			return `${modePrompt}\n\nUser request for ${imageCount} images: ${userMessage}`;
		}
	}

	private combinePromptsForImage(userMessage: string): string {
		const currentMode = this.getCurrentMode();
		const modePrompt = this.getModePrompt(currentMode);
		
		if (!modePrompt.trim()) {
			return userMessage;
		}
		
		// Combine mode prompt with user message naturally
		if (userMessage === 'Please analyze this image') {
			return modePrompt;
		} else {
			return `${modePrompt}\n\nUser request: ${userMessage}`;
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
	private async callOpenAIWithMultipleImages(message: string, base64Images: string[], modelConfig: ModelConfig, credentials: any): Promise<Response> {
		const imageContent = base64Images.map(base64 => ({
			type: 'image_url',
			image_url: {
				url: `data:image/png;base64,${base64}`
			}
		}));

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

	private async callClaudeWithMultipleImages(message: string, base64Images: string[], modelConfig: ModelConfig, credentials: any): Promise<Response> {
		const imageContent = base64Images.map(base64 => ({
			type: 'image',
			source: {
				type: 'base64',
				media_type: 'image/png',
				data: base64
			}
		}));

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

	private async callGoogleWithMultipleImages(message: string, base64Images: string[], modelConfig: ModelConfig, credentials: any): Promise<Response> {
		const imageParts = base64Images.map(base64 => ({
			inline_data: {
				mime_type: 'image/png',
				data: base64
			}
		}));

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

	private async callOpenRouterWithMultipleImages(message: string, base64Images: string[], modelConfig: ModelConfig, credentials: any): Promise<Response> {
		const imageContent = base64Images.map(base64 => ({
			type: 'image_url',
			image_url: {
				url: `data:image/png;base64,${base64}`
			}
		}));

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

	private async callCustomAPIWithMultipleImages(message: string, base64Images: string[], modelConfig: ModelConfig, credentials: any): Promise<Response> {
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

		const imageContent = base64Images.map(base64 => ({
			type: 'image_url',
			image_url: {
				url: `data:image/png;base64,${base64}`
			}
		}));

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
		return fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${credentials.apiKey}`
			},
			body: JSON.stringify({
				model: modelConfig.modelId,
				messages: messages,
				max_tokens: modelConfig.settings.maxTokens,
				temperature: modelConfig.settings.temperature,
				top_p: modelConfig.settings.topP,
				frequency_penalty: modelConfig.settings.frequencyPenalty,
				presence_penalty: modelConfig.settings.presencePenalty
			})
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
		const baseUrl = credentials.baseUrl || 'https://openrouter.ai/api/v1';
		
		return fetch(`${baseUrl}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${credentials.apiKey}`,
				'HTTP-Referer': 'https://obsidian.md',
				'X-Title': 'Obsidian Screenshot Capture'
			},
			body: JSON.stringify({
				model: modelConfig.modelId,
				messages: messages,
				max_tokens: modelConfig.settings.maxTokens,
				temperature: modelConfig.settings.temperature,
				top_p: modelConfig.settings.topP,
				frequency_penalty: modelConfig.settings.frequencyPenalty,
				presence_penalty: modelConfig.settings.presencePenalty
			})
		});
	}

	private async callCustomAPIWithContext(messages: any[], modelConfig: ModelConfig, credentials: any): Promise<Response> {
		// For custom APIs, we'll use OpenAI format as the default
		return fetch(`${credentials.baseUrl}${credentials.apiPath || '/v1/chat/completions'}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${credentials.apiKey}`
			},
			body: JSON.stringify({
				model: modelConfig.modelId,
				messages: messages,
				max_tokens: modelConfig.settings.maxTokens,
				temperature: modelConfig.settings.temperature,
				top_p: modelConfig.settings.topP,
				frequency_penalty: modelConfig.settings.frequencyPenalty,
				presence_penalty: modelConfig.settings.presencePenalty
			})
		});
	}
}