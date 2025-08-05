export interface LLMProvider {
	id: string;
	name: string;
	displayName: string;
	requiresApiKey: boolean;
	requiresBaseUrl: boolean;
	defaultBaseUrl?: string;
	apiKeyLink?: string;
	models: LLMModel[];
}

export interface LLMModel {
	id: string;
	name: string;
	hasVision: boolean;
	maxTokens?: number;
	contextWindow?: number;
	inputCost?: number;  // per 1M tokens
	outputCost?: number; // per 1M tokens
}

export interface ModelConfig {
	id: string;
	name: string;
	providerId: string;
	modelId: string;
	isVisionCapable: boolean;
	settings: ModelSettings;
	createdAt: Date;
	lastUsed?: Date;
}

export interface ModelSettings {
	maxTokens: number;
	temperature: number;
	topP?: number;
	frequencyPenalty?: number;
	presencePenalty?: number;
	maxResponseTime: number; // seconds
	systemPrompt?: string;
}

export interface ProviderCredentials {
	[providerId: string]: {
		apiKey: string;
		baseUrl?: string;
		customName?: string; // For custom providers to have user-friendly names
		verified: boolean;
		verifiedAt?: Date;
		lastError?: string;
	};
}

export interface ImageCaptureSettings {
	language: string;
	defaultSaveLocation: string;
	otherSourceImageLocation: string; // 其他来源图片保存位置
	conversationSaveLocation: string;
	autoSavedConversationLocation: string;
	enableAIAnalysis: boolean;
	imageFormat: 'png' | 'jpg';
	enableRegionSelect: boolean;
	useRelativePath: boolean;
	autoSaveConversations: boolean;
	maxAutoSavedConversations: number;
	autoSaveInterval: number;
	modelConfigs: ModelConfig[];
	providerCredentials: ProviderCredentials;
	defaultModelConfigId: string;
	globalSystemPrompt: string;
	screenshotPrompt: string;
}

export const LLM_PROVIDERS: LLMProvider[] = [
	{
		id: 'openai',
		name: 'OpenAI',
		displayName: 'OpenAI',
		requiresApiKey: true,
		requiresBaseUrl: false,
		apiKeyLink: 'https://platform.openai.com/api-keys',
		models: [
			{ id: 'gpt-4o', name: 'GPT-4o', hasVision: true, maxTokens: 4096, contextWindow: 128000 },
			{ id: 'gpt-4o-mini', name: 'GPT-4o Mini', hasVision: true, maxTokens: 4096, contextWindow: 128000 },
			{ id: 'gpt-4-vision-preview', name: 'GPT-4 Vision Preview', hasVision: true, maxTokens: 4096, contextWindow: 128000 },
			{ id: 'gpt-4', name: 'GPT-4', hasVision: false, maxTokens: 4096, contextWindow: 8192 },
			{ id: 'gpt-4-turbo', name: 'GPT-4 Turbo', hasVision: true, maxTokens: 4096, contextWindow: 128000 },
			{ id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', hasVision: false, maxTokens: 4096, contextWindow: 16384 }
		]
	},
	{
		id: 'anthropic',
		name: 'Anthropic',
		displayName: 'Anthropic (Claude)',
		requiresApiKey: true,
		requiresBaseUrl: false,
		apiKeyLink: 'https://console.anthropic.com/',
		models: [
			{ id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', hasVision: true, maxTokens: 8192, contextWindow: 200000 },
			{ id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', hasVision: true, maxTokens: 4096, contextWindow: 200000 },
			{ id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet', hasVision: true, maxTokens: 4096, contextWindow: 200000 },
			{ id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', hasVision: true, maxTokens: 4096, contextWindow: 200000 }
		]
	},
	{
		id: 'google',
		name: 'Google',
		displayName: 'Google (Gemini)',
		requiresApiKey: true,
		requiresBaseUrl: false,
		apiKeyLink: 'https://makersuite.google.com/app/apikey',
		models: [
			{ id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', hasVision: true, maxTokens: 8192, contextWindow: 2000000 },
			{ id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', hasVision: true, maxTokens: 8192, contextWindow: 1000000 },
			{ id: 'gemini-pro-vision', name: 'Gemini Pro Vision', hasVision: true, maxTokens: 2048, contextWindow: 32768 }
		]
	},
	{
		id: 'cohere',
		name: 'Cohere',
		displayName: 'Cohere',
		requiresApiKey: true,
		requiresBaseUrl: false,
		apiKeyLink: 'https://dashboard.cohere.ai/api-keys',
		models: [
			{ id: 'command-r-plus', name: 'Command R+', hasVision: false, maxTokens: 4096, contextWindow: 128000 },
			{ id: 'command-r', name: 'Command R', hasVision: false, maxTokens: 4096, contextWindow: 128000 }
		]
	},
	{
		id: 'openrouter',
		name: 'OpenRouter',
		displayName: 'OpenRouter',
		requiresApiKey: true,
		requiresBaseUrl: false,
		defaultBaseUrl: 'https://openrouter.ai/api/v1',
		apiKeyLink: 'https://openrouter.ai/keys',
		models: [
			// OpenAI models via OpenRouter
			{ id: 'openai/gpt-4o', name: 'GPT-4o', hasVision: true, maxTokens: 4096, contextWindow: 128000 },
			{ id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', hasVision: true, maxTokens: 4096, contextWindow: 128000 },
			{ id: 'openai/gpt-4-vision-preview', name: 'GPT-4 Vision Preview', hasVision: true, maxTokens: 4096, contextWindow: 128000 },
			{ id: 'openai/gpt-4-turbo', name: 'GPT-4 Turbo', hasVision: true, maxTokens: 4096, contextWindow: 128000 },
			
			// Anthropic models via OpenRouter
			{ id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', hasVision: true, maxTokens: 8192, contextWindow: 200000 },
			{ id: 'anthropic/claude-3-opus', name: 'Claude 3 Opus', hasVision: true, maxTokens: 4096, contextWindow: 200000 },
			{ id: 'anthropic/claude-3-sonnet', name: 'Claude 3 Sonnet', hasVision: true, maxTokens: 4096, contextWindow: 200000 },
			{ id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku', hasVision: true, maxTokens: 4096, contextWindow: 200000 },
			
			// Google models via OpenRouter
			{ id: 'google/gemini-pro-vision', name: 'Gemini Pro Vision', hasVision: true, maxTokens: 2048, contextWindow: 32768 },
			{ id: 'google/gemini-1.5-pro', name: 'Gemini 1.5 Pro', hasVision: true, maxTokens: 8192, contextWindow: 2000000 },
			{ id: 'google/gemini-1.5-flash', name: 'Gemini 1.5 Flash', hasVision: true, maxTokens: 8192, contextWindow: 1000000 },
			
			// Other popular vision models
			{ id: 'meta-llama/llama-3.2-90b-vision-instruct', name: 'Llama 3.2 90B Vision', hasVision: true, maxTokens: 4096, contextWindow: 131072 },
			{ id: 'meta-llama/llama-3.2-11b-vision-instruct', name: 'Llama 3.2 11B Vision', hasVision: true, maxTokens: 4096, contextWindow: 131072 },
			{ id: 'qwen/qwen-2-vl-72b-instruct', name: 'Qwen2-VL 72B', hasVision: true, maxTokens: 4096, contextWindow: 32768 },
			{ id: 'qwen/qwen-2-vl-7b-instruct', name: 'Qwen2-VL 7B', hasVision: true, maxTokens: 4096, contextWindow: 32768 }
		]
	},
	{
		id: 'custom',
		name: 'Custom',
		displayName: 'Custom Provider',
		requiresApiKey: true,
		requiresBaseUrl: true,
		models: [
			{ id: 'custom-model', name: 'Custom Model', hasVision: true, maxTokens: 4096, contextWindow: 8192 }
		]
	}
];

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
	maxTokens: 4000,
	temperature: 0.7,
	topP: 1,
	frequencyPenalty: 0,
	presencePenalty: 0,
	maxResponseTime: 30,
	systemPrompt: ''
};

export const DEFAULT_SETTINGS: ImageCaptureSettings = {
	language: 'en',
	defaultSaveLocation: 'screenshots-capture/savedscreenshots',
	otherSourceImageLocation: 'screenshots-capture/othersourceimage',
	conversationSaveLocation: 'screenshots-capture/conversations',
	autoSavedConversationLocation: 'screenshots-capture/autosavedconversations',
	enableAIAnalysis: true,
	imageFormat: 'png',
	enableRegionSelect: true,
	useRelativePath: true,
	autoSaveConversations: true,
	maxAutoSavedConversations: 5,
	autoSaveInterval: 30,
	modelConfigs: [],
	providerCredentials: {},
	defaultModelConfigId: '',
	globalSystemPrompt: 'You are a helpful AI assistant.',
	screenshotPrompt: 'Please analyze this screenshot and provide detailed insights about what you see.'
};

export interface EditTool {
	name: string;
	icon: string;
	cursor: string;
}

export interface Region {
	x: number;
	y: number;
	width: number;
	height: number;
}

export type StrokeSize = 'small' | 'medium' | 'large';

export interface StrokeSetting {
	size: StrokeSize;
	width: number;
}