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
}

export class AIManager {
	private plugin: ImageCapturePlugin;
	private conversations: Map<string, AIConversation> = new Map();
	private currentConversationId: string | null = null;

	constructor(plugin: ImageCapturePlugin) {
		this.plugin = plugin;
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

	private async callAIAPI(message: string, imageDataUrl: string, modelConfig: ModelConfig): Promise<string> {
		const provider = LLM_PROVIDERS.find(p => p.id === modelConfig.providerId);
		
		if (!provider) {
			throw new Error(`Unknown provider: ${modelConfig.providerId}`);
		}

		const model = provider.models.find(m => m.id === modelConfig.modelId);
		if (!model || !model.hasVision) {
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
		} else if (modelConfig.providerId === 'custom') {
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
		console.log('API Response:', responseText.substring(0, 200) + '...');
		
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
		} else if (modelConfig.providerId === 'custom') {
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
		if (!credentials.baseUrl) {
			throw new Error('Base URL is required for custom provider');
		}

		// Default to OpenAI-compatible format for custom APIs
		return fetch(`${credentials.baseUrl}/chat/completions`, {
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
				temperature: modelConfig.settings.temperature
			})
		});
	}

	private extractResponseContent(data: any, providerId: string): string {
		try {
			if (providerId === 'openai' || providerId === 'custom' || providerId === 'openrouter') {
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
			createdAt: new Date()
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
				await aiLeaf.setViewType(AI_CHAT_VIEW_TYPE);
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
		if (!credentials.baseUrl) {
			throw new Error('Base URL is required for custom provider');
		}

		return fetch(`${credentials.baseUrl}/chat/completions`, {
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
				temperature: modelConfig.settings.temperature
			})
		});
	}

	private combinePromptsForImage(userMessage: string): string {
		const screenshotPrompt = this.plugin.settings.screenshotPrompt;
		if (!screenshotPrompt.trim()) {
			return userMessage;
		}
		
		// Combine screenshot prompt with user message naturally
		if (userMessage === 'Please analyze this image') {
			return screenshotPrompt;
		} else {
			return `${screenshotPrompt}\n\nUser request: ${userMessage}`;
		}
	}

	private getEffectiveSystemPrompt(): string {
		const globalPrompt = this.plugin.settings.globalSystemPrompt?.trim();
		return globalPrompt || 'You are a helpful AI assistant.';
	}

	cleanup(): void {
		this.conversations.clear();
		this.currentConversationId = null;
	}
}