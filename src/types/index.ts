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
	// For custom providers, store provider info directly in model config
	customProvider?: {
		name: string;
		baseUrl: string;
		apiPath?: string;
		apiKey: string;
	};
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
		apiPath?: string; // Custom API path, e.g., "/v1/chat/completions"
		customName?: string; // For custom providers to have user-friendly names
		verified: boolean;
		verifiedAt?: Date;
		lastError?: string;
	};
}

// AI Chat Mode Types
export type AIChatMode = 'analyze' | 'ocr' | 'chat' | 'custom';

export interface AIChatModeConfig {
	id: AIChatMode;
	nameKey: string; // i18n key for the mode name
	prompt: string;
}

export const AI_CHAT_MODES: AIChatModeConfig[] = [
	{
		id: 'analyze',
		nameKey: 'aiChat.modes.analyze',
		prompt: 'Please analyze this image in detail. Describe what you see, identify key elements, patterns, and provide insights about the content, context, and any notable features.'
	},
	{
		id: 'ocr',
		nameKey: 'aiChat.modes.ocr',
		prompt: 'Please extract all text from this image. Provide the text content exactly as it appears, maintaining the structure and formatting where possible. If there are multiple text sections, organize them clearly.'
	},
	{
		id: 'chat',
		nameKey: 'aiChat.modes.chat',
		prompt: 'Please examine this image and be ready to answer questions about what you see. Provide detailed observations and be prepared to discuss any aspect of the image.'
	},
	{
		id: 'custom',
		nameKey: 'aiChat.modes.custom',
		prompt: 'Please examine this image and respond according to the custom instructions provided by the user.'
	}
];

export interface ImageCaptureSettings {
	language: string;
	defaultSaveLocation: string;
	otherSourceImageLocation: string; // 其他来源图片保存位置
	conversationSaveLocation: string;
	autoSavedConversationLocation: string;
	tempImageLimit: number; // Maximum number of temporary images before warning
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
	// AI Chat Mode Settings
	defaultAIChatMode: AIChatMode;
	aiChatModePrompts: {
		[key in AIChatMode]: string;
	};
	// Custom providers storage
	customProviders: {[providerId: string]: CustomProvider};
	// Context settings for AI conversations
	contextSettings: {
		maxContextMessages: number;      // Maximum number of historical message blocks to include (1 block = 1 UI message regardless of image count)
		includeSystemPrompt: boolean;    // Whether to include system prompt in context
	};
	// Debug settings
	enableDebugLogging: boolean;        // Enable debug logging to console
	// Send-only button settings
	showSendOnlyButton: boolean;        // Whether to show the "send only" button
	// UI control settings
	showNormalCaptureButton: boolean;       // Whether to show normal capture button
	enableMinimizedCapture: boolean;        // Whether to enable minimized capture feature
	showMinimizedCaptureButton: boolean;    // Whether to show minimized capture button (sub-option)
	showAIChatPanelButton: boolean;         // Whether to show AI chat panel button
	// Internal tracking for UI refresh
	_modelConfigsLastCount?: number;   // Internal: tracks model count for settings refresh
}

export interface CustomProvider {
	id: string;
	name: string;
	baseUrl: string;
	apiPath: string;
	apiKey: string;
	verified: boolean;
	verifiedAt?: Date;
	lastError?: string;
	createdAt: Date;
}

export const LLM_PROVIDERS: LLMProvider[] = [
	{
		id: 'openai',
		name: 'OpenAI',
		displayName: 'OpenAI',
		requiresApiKey: true,
		requiresBaseUrl: false,
		defaultBaseUrl: 'https://api.openai.com/v1',
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
		defaultBaseUrl: 'https://api.anthropic.com/v1',
		apiKeyLink: 'https://console.anthropic.com/',
		models: [
			{ id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', hasVision: true, maxTokens: 8192, contextWindow: 199988 },
			{ id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', hasVision: true, maxTokens: 4096, contextWindow: 199988 },
			{ id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet', hasVision: true, maxTokens: 4096, contextWindow: 199988 },
			{ id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', hasVision: true, maxTokens: 4096, contextWindow: 199988 }
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
			{ id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', hasVision: true, maxTokens: 8192, contextWindow: 19998 },
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
		defaultBaseUrl: 'https://api.cohere.com/v1',
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
			{ id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', hasVision: true, maxTokens: 8192, contextWindow: 199988 },
			{ id: 'anthropic/claude-3-opus', name: 'Claude 3 Opus', hasVision: true, maxTokens: 4096, contextWindow: 199988 },
			{ id: 'anthropic/claude-3-sonnet', name: 'Claude 3 Sonnet', hasVision: true, maxTokens: 4096, contextWindow: 199988 },
			{ id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku', hasVision: true, maxTokens: 4096, contextWindow: 199988 },
			
			// Google models via OpenRouter
			{ id: 'google/gemini-pro-vision', name: 'Gemini Pro Vision', hasVision: true, maxTokens: 2048, contextWindow: 32768 },
			{ id: 'google/gemini-1.5-pro', name: 'Gemini 1.5 Pro', hasVision: true, maxTokens: 8192, contextWindow: 1999880 },
			{ id: 'google/gemini-1.5-flash', name: 'Gemini 1.5 Flash', hasVision: true, maxTokens: 8192, contextWindow: 1000000 },
			
			// Other popular vision models
			{ id: 'meta-llama/llama-3.2-90b-vision-instruct', name: 'Llama 3.2 90B Vision', hasVision: true, maxTokens: 4096, contextWindow: 131072 },
			{ id: 'meta-llama/llama-3.2-11b-vision-instruct', name: 'Llama 3.2 11B Vision', hasVision: true, maxTokens: 4096, contextWindow: 131072 },
			{ id: 'qwen/qwen-2-vl-72b-instruct', name: 'Qwen2-VL 72B', hasVision: true, maxTokens: 4096, contextWindow: 32768 },
			{ id: 'qwen/qwen-2-vl-7b-instruct', name: 'Qwen2-VL 7B', hasVision: true, maxTokens: 4096, contextWindow: 32768 },
			{ id: 'qwen/qwenvl-max', name: 'QwenVL Max', hasVision: true, maxTokens: 4096, contextWindow: 32768 },
			{ id: 'qwen/qwenvl-plus', name: 'QwenVL Plus', hasVision: true, maxTokens: 4096, contextWindow: 32768 },
			{ id: 'qwen/qwenvl', name: 'QwenVL', hasVision: true, maxTokens: 4096, contextWindow: 32768 },
			{ id: 'qwen/qwen-vl-max', name: 'Qwen VL Max', hasVision: true, maxTokens: 4096, contextWindow: 32768 },
			{ id: 'qwen/qwen-vl-plus', name: 'Qwen VL Plus', hasVision: true, maxTokens: 4096, contextWindow: 32768 },
			{ id: 'qwen/qwen-vl-chat', name: 'Qwen VL Chat', hasVision: true, maxTokens: 4096, contextWindow: 32768 }
		]
	},
	{
		id: 'custom',
		name: 'Custom',
		displayName: 'Custom Provider',
		requiresApiKey: true,
		requiresBaseUrl: true,
		models: [
			// Placeholder models - will be dynamically populated
			{ id: 'gpt-4o', name: 'GPT-4o', hasVision: true, maxTokens: 4096, contextWindow: 128000 },
			{ id: 'gpt-4o-mini', name: 'GPT-4o Mini', hasVision: true, maxTokens: 4096, contextWindow: 128000 },
			{ id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', hasVision: true, maxTokens: 8192, contextWindow: 199988 },
			{ id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', hasVision: true, maxTokens: 8192, contextWindow: 1999880 },
			{ id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', hasVision: true, maxTokens: 8192, contextWindow: 1000000 },
			{ id: 'deepseek-chat', name: 'DeepSeek Chat', hasVision: false, maxTokens: 4096, contextWindow: 64000 },
			{ id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', hasVision: false, maxTokens: 4096, contextWindow: 64000 },
			{ id: 'chatgpt-4o-latest', name: 'ChatGPT-4o Latest', hasVision: true, maxTokens: 4096, contextWindow: 128000 },
			{ id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', hasVision: true, maxTokens: 8192, contextWindow: 1000000 },
			{ id: 'gpt-4.1', name: 'GPT-4.1', hasVision: true, maxTokens: 4096, contextWindow: 1000000 },
			{ id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', hasVision: true, maxTokens: 4096, contextWindow: 1000000 },
			{ id: 'o3', name: 'O3', hasVision: true, maxTokens: 4096, contextWindow: 199988 },
			{ id: 'o4-mini', name: 'O4 Mini', hasVision: true, maxTokens: 4096, contextWindow: 199988 },
			{ id: 'qwen3-235b-a22b', name: 'Qwen3 235B', hasVision: false, maxTokens: 4096, contextWindow: 128000 },
			{ id: 'llama-4-maverick', name: 'Llama 4 Maverick', hasVision: false, maxTokens: 4096, contextWindow: 128000 },
			{ id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', hasVision: true, maxTokens: 8192, contextWindow: 1000000 },
			{ id: 'gemini-2.5-flash-nothink', name: 'Gemini 2.5 Flash NoThink', hasVision: true, maxTokens: 8192, contextWindow: 1000000 },
			{ id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', hasVision: true, maxTokens: 8192, contextWindow: 199988 },
			{ id: 'claude-opus-4-20250514', name: 'Claude Opus 4', hasVision: true, maxTokens: 8192, contextWindow: 199988 },
			{ id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', hasVision: true, maxTokens: 8192, contextWindow: 1000000 },
			{ id: 'doubao-1.5-vision-pro-250328', name: 'Doubao 1.5 Vision Pro', hasVision: true, maxTokens: 4096, contextWindow: 128000 },
			{ id: 'grok-4', name: 'Grok 4', hasVision: true, maxTokens: 4096, contextWindow: 128000 },
			{ id: 'kimi-k2-0711-preview', name: 'Kimi K2 Preview', hasVision: false, maxTokens: 4096, contextWindow: 128000 }
		]
	}
];

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
	maxTokens: 4096,  // 更安全的默认值，适合大多数模型
	temperature: 0.7,
	topP: 1,
	frequencyPenalty: 0,
	presencePenalty: 0,
	maxResponseTime: 30,
	systemPrompt: ''
};

// Default prompts for different languages
export const DEFAULT_PROMPTS = {
	en: {
		globalSystemPrompt: 'You are a helpful AI assistant.',
		aiChatModePrompts: {
			analyze: 'Please analyze this image in detail. Describe what you see, identify key elements, patterns, and provide insights about the content, context, and any notable features.',
			ocr: 'Please extract all text from this image. Provide the text content exactly as it appears, maintaining the structure and formatting where possible. If there are multiple text sections, organize them clearly.',
			chat: 'You are a helpful AI assistant engaged in a text-based conversation. Answer questions, provide information, and assist with various tasks to the best of your ability. Be concise yet thorough in your responses.',
			custom: 'Please examine this image and respond according to the custom instructions provided by the user.'
		}
	},
	zh: {
		globalSystemPrompt: '你是一个有用的AI助手。',
		aiChatModePrompts: {
			analyze: '请详细分析这张图片。描述你看到的内容，识别关键元素、模式，并提供关于内容、背景和任何显著特征的见解。',
			ocr: '请提取这张图片中的所有文字。准确提供文字内容，尽可能保持结构和格式。如果有多个文字部分，请清晰地组织它们。',
			chat: '你是一个有用的AI助手，参与基于文本的对话。回答问题，提供信息，并尽力协助各种任务。回答要简洁而全面。',
			custom: '请检查这张图片，并根据用户提供的自定义指令进行回应。'
		}
	}
};

// Helper function to get localized prompts
export function getLocalizedPrompts(language: string): typeof DEFAULT_PROMPTS.en {
	const lang = language as keyof typeof DEFAULT_PROMPTS;
	return DEFAULT_PROMPTS[lang] || DEFAULT_PROMPTS.en;
}

export const DEFAULT_SETTINGS: ImageCaptureSettings = {
	language: 'en',
	defaultSaveLocation: 'screenshots-capture/savedscreenshots',
	otherSourceImageLocation: 'screenshots-capture/othersourceimage',
	conversationSaveLocation: 'screenshots-capture/conversations',
	autoSavedConversationLocation: 'screenshots-capture/autosavedconversations',
	tempImageLimit: 10,
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
	globalSystemPrompt: DEFAULT_PROMPTS.en.globalSystemPrompt,
	// AI Chat Mode Settings
	defaultAIChatMode: 'analyze',
	aiChatModePrompts: DEFAULT_PROMPTS.en.aiChatModePrompts,
	// Custom providers storage
	customProviders: {},
	contextSettings: {
		maxContextMessages: 20,
		includeSystemPrompt: true
	},
	// Debug settings
	enableDebugLogging: false,
	// Send-only button settings
	showSendOnlyButton: false,
	// UI control settings
	showNormalCaptureButton: true,
	enableMinimizedCapture: false,
	showMinimizedCaptureButton: true,
	showAIChatPanelButton: false
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