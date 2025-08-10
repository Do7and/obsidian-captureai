import { Modal, Setting, Notice, DropdownComponent } from 'obsidian';
import ImageCapturePlugin from '../main';
import { LLM_PROVIDERS, LLMProvider, LLMModel, ModelConfig, DEFAULT_MODEL_SETTINGS } from '../types';
import { t } from '../i18n';
import { getLogger } from '../utils/logger';

export class SetKeysModal extends Modal {
	private plugin: ImageCapturePlugin;
	private verificationStates: Map<string, 'idle' | 'verifying' | 'verified' | 'error'> = new Map();
	private availableModels: Map<string, LLMModel[]> = new Map();

	constructor(plugin: ImageCapturePlugin) {
		super(plugin.app);
		this.plugin = plugin;
		this.modalEl.addClass('set-keys-modal');
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// Modal header
		const headerEl = contentEl.createEl('div', { cls: 'modal-header' });
		headerEl.createEl('h2', { text: t('setKeys.title') });
		headerEl.createEl('p', { 
			text: t('setKeys.description'),
			cls: 'modal-description'
		});

		// Providers container
		const providersEl = contentEl.createEl('div', { cls: 'providers-container' });

		// Create settings for each provider
		LLM_PROVIDERS.forEach(provider => {
			this.createProviderSetting(providersEl, provider);
		});
	}

	private createProviderSetting(container: HTMLElement, provider: LLMProvider) {
		const providerEl = container.createEl('div', { cls: 'provider-setting' });
		providerEl.setAttribute('data-provider', provider.id);
		
		// Provider header
		const headerEl = providerEl.createEl('div', { cls: 'provider-header' });
		headerEl.createEl('h3', { text: provider.displayName });
		
		if (provider.apiKeyLink) {
			const linkEl = headerEl.createEl('a', { 
				text: t('setKeys.getApiKey'),
				cls: 'provider-link',
				attr: { href: provider.apiKeyLink, target: '_blank' }
			});
		}

		// Get current credentials
		const credentials = this.plugin.settings.providerCredentials[provider.id];
		const apiKey = credentials?.apiKey || '';
		const baseUrl = credentials?.baseUrl || provider.defaultBaseUrl || '';
		const isVerified = credentials?.verified || false;

		// Initialize verification state
		this.verificationStates.set(provider.id, isVerified ? 'verified' : 'idle');
		if (isVerified) {
			// Automatically load models for verified providers
			this.loadAvailableModels(provider).then(() => {
				// Update UI after models are loaded
				this.updateAddModelSection(provider.id);
			}).catch((error) => {
				console.error(`Failed to load models for ${provider.displayName}:`, error);
				// Still update UI even if loading failed (will use fallback models)
				this.updateAddModelSection(provider.id);
			});
		} else if (provider.models) {
			this.availableModels.set(provider.id, provider.models);
		}

		// API Key setting with inline verify button
		const apiKeyContainer = providerEl.createEl('div', { cls: 'api-key-container' });
		const apiKeyLabel = apiKeyContainer.createEl('div', { cls: 'setting-item-info' });
		apiKeyLabel.createEl('div', { text: t('setKeys.apiKeyLabel'), cls: 'setting-item-name' });
		apiKeyLabel.createEl('div', { text: t('setKeys.apiKeyDescription'), cls: 'setting-item-description' });
		
		const apiKeyInputContainer = apiKeyContainer.createEl('div', { cls: 'api-key-input-container' });
		
		const apiKeyInput = apiKeyInputContainer.createEl('input', { 
			type: 'password',
			placeholder: t('setKeys.apiKeyPlaceholder'),
			cls: 'api-key-input'
		});
		apiKeyInput.value = apiKey;
		
		// Verify button inline with input
		const verifyButton = apiKeyInputContainer.createEl('button', { 
			text: t('setKeys.verifyButton'),
			cls: 'verify-button-inline'
		});
		
		apiKeyInput.addEventListener('input', async (e) => {
			const value = (e.target as HTMLInputElement).value;
			// Update credentials
			if (!this.plugin.settings.providerCredentials[provider.id]) {
				this.plugin.settings.providerCredentials[provider.id] = {
					apiKey: '',
					verified: false
				};
			}
			this.plugin.settings.providerCredentials[provider.id].apiKey = value;
			await this.plugin.saveSettings();
			
			// Reset verification state when API key changes
			if (this.verificationStates.get(provider.id) === 'verified') {
				this.verificationStates.set(provider.id, 'idle');
				this.updateVerifyButton(provider.id);
				this.updateAddModelSection(provider.id);
			}
		});
		
		verifyButton.addEventListener('click', () => this.verifyProvider(provider.id));

		// Base URL setting (if required)
		if (provider.requiresBaseUrl) {
			new Setting(providerEl)
				.setName(t('setKeys.baseUrlLabel'))
				.setDesc(t('setKeys.baseUrlDescription'))
				.addText(text => {
					text.setPlaceholder(t('setKeys.baseUrlPlaceholder'))
						.setValue(baseUrl)
						.onChange(async (value) => {
							if (!this.plugin.settings.providerCredentials[provider.id]) {
								this.plugin.settings.providerCredentials[provider.id] = {
									apiKey: '',
									verified: false
								};
							}
							this.plugin.settings.providerCredentials[provider.id].baseUrl = value;
							await this.plugin.saveSettings();
						});
				});

			// API Path setting (for custom providers)
			if (provider.id === 'custom') {
				const currentApiPath = this.plugin.settings.providerCredentials[provider.id]?.apiPath || '/v1/chat/completions';
				new Setting(providerEl)
					.setName(t('setKeys.apiPathLabel'))
					.setDesc(t('setKeys.apiPathDescription'))
					.addText(text => {
						text.setPlaceholder('/v1/chat/completions')
							.setValue(currentApiPath)
							.onChange(async (value) => {
								if (!this.plugin.settings.providerCredentials[provider.id]) {
									this.plugin.settings.providerCredentials[provider.id] = {
										apiKey: '',
										verified: false
									};
								}
								this.plugin.settings.providerCredentials[provider.id].apiPath = value || '/v1/chat/completions';
								await this.plugin.saveSettings();
							});
					});
			}
		}

		// Custom name setting (for custom providers)
		if (provider.id === 'custom') {
			const currentCustomName = this.plugin.settings.providerCredentials[provider.id]?.customName || '';
			new Setting(providerEl)
				.setName(t('setKeys.customNameLabel'))
				.setDesc(t('setKeys.customNameDescription'))
				.addText(text => {
					text.setPlaceholder(t('setKeys.customNamePlaceholder'))
						.setValue(currentCustomName)
						.onChange(async (value) => {
							if (!this.plugin.settings.providerCredentials[provider.id]) {
								this.plugin.settings.providerCredentials[provider.id] = {
									apiKey: '',
									verified: false
								};
							}
							this.plugin.settings.providerCredentials[provider.id].customName = value.trim();
							await this.plugin.saveSettings();
						});
				});
		}

		// Add Model section with dropdown or text input
		const addModelContainer = providerEl.createEl('div', { cls: 'add-model-container' });
		const addModelLabel = addModelContainer.createEl('div', { cls: 'setting-item-info' });
		addModelLabel.createEl('div', { text: t('setKeys.addModelLabel'), cls: 'setting-item-name' });
		
		const addModelInputContainer = addModelContainer.createEl('div', { cls: 'add-model-input-container' });
		
		let modelInput: HTMLSelectElement | HTMLInputElement;
		
		if (provider.id === 'custom') {
			// For custom provider, use text input
			addModelLabel.createEl('div', { text: t('setKeys.addCustomModelDescription'), cls: 'setting-item-description' });
			addModelInputContainer.addClass('custom-provider');
			
			modelInput = addModelInputContainer.createEl('input', { 
				cls: 'model-text-input',
				attr: {
					type: 'text',
					placeholder: t('setKeys.customModelPlaceholder')
				}
			});

			// Add vision checkbox for custom models
			const visionContainer = addModelInputContainer.createEl('div', { cls: 'vision-checkbox-container' });
			const visionCheckbox = visionContainer.createEl('input', {
				type: 'checkbox',
				cls: 'vision-checkbox'
			});
			visionCheckbox.checked = true; // Default to vision enabled
			visionContainer.createEl('label', { 
				text: t('setKeys.visionCapableLabel'),
				cls: 'vision-checkbox-label'
			});
			visionContainer.setAttribute('title', t('setKeys.visionCapableDescription'));
			
			// Store reference
			(providerEl as any)._visionCheckbox = visionCheckbox;
		} else {
			// For other providers, use dropdown
			addModelLabel.createEl('div', { text: t('setKeys.addModelDescription'), cls: 'setting-item-description' });
			modelInput = addModelInputContainer.createEl('select', { cls: 'modellist-dropdown' });
		}
		
		const addModelButton = addModelInputContainer.createEl('button', { 
			text: t('setKeys.addModelButton'),
			cls: 'add-model-button'
		});
		
		// Store references for updates
		(providerEl as any)._verifyButton = verifyButton;
		(providerEl as any)._addModelButton = addModelButton;
		(providerEl as any)._modelInput = modelInput;
		(providerEl as any)._isCustomProvider = provider.id === 'custom';

		// Set initial states
		this.updateVerifyButton(provider.id);
		// For verified providers, updateAddModelSection will be called after loadAvailableModels completes
		// For non-verified providers, update immediately
		if (!isVerified) {
			this.updateAddModelSection(provider.id);
		}

		// Add model selection handler
		addModelButton.addEventListener('click', () => {
			if (this.verificationStates.get(provider.id) === 'verified') {
				if (provider.id === 'custom') {
					// Handle custom model input
					const modelName = (modelInput as HTMLInputElement).value.trim();
					if (modelName) {
						this.addCustomModel(provider, modelName);
					}
				} else {
					// Handle dropdown selection
					const selectedValue = (modelInput as HTMLSelectElement).value;
					if (selectedValue) {
						const model = this.availableModels.get(provider.id)?.find(m => m.id === selectedValue);
						if (model) {
							this.addModelConfig(provider, model);
						}
					}
				}
			}
		});
	}

	private updateVerifyButton(providerId: string) {
		const provider = LLM_PROVIDERS.find(p => p.id === providerId);
		if (!provider) return;

		const providerEl = this.contentEl.querySelector(`[data-provider="${providerId}"]`) as HTMLElement;
		if (!providerEl) return;

		const verifyButton = (providerEl as any)._verifyButton as HTMLButtonElement;
		if (!verifyButton) return;

		const state = this.verificationStates.get(providerId) || 'idle';
		
		// Remove all state classes first
		verifyButton.classList.remove('verified', 'verifying', 'error');
		
		switch (state) {
			case 'idle':
				verifyButton.textContent = t('setKeys.verifyButton');
				verifyButton.disabled = false;
				break;
			case 'verifying':
				verifyButton.textContent = t('setKeys.verifyingButton');
				verifyButton.disabled = true;
				verifyButton.classList.add('verifying');
				break;
			case 'verified':
				verifyButton.textContent = t('setKeys.verifiedButton');
				verifyButton.disabled = false;
				verifyButton.classList.add('verified', 'set-keys-verify-success');
				break;
			case 'error':
				verifyButton.textContent = t('setKeys.retryButton');
				verifyButton.disabled = false;
				verifyButton.classList.add('error', 'set-keys-verify-error');
				break;
		}
	}

	private updateAddModelSection(providerId: string) {
		const provider = LLM_PROVIDERS.find(p => p.id === providerId);
		if (!provider) return;

		const providerEl = this.contentEl.querySelector(`[data-provider="${providerId}"]`) as HTMLElement;
		if (!providerEl) return;

		const addModelButton = (providerEl as any)._addModelButton as HTMLButtonElement;
		const modelInput = (providerEl as any)._modelInput as HTMLSelectElement | HTMLInputElement;
		const isCustomProvider = (providerEl as any)._isCustomProvider as boolean;
		
		if (!addModelButton || !modelInput) return;

		const state = this.verificationStates.get(providerId) || 'idle';
		const isVerified = state === 'verified';
		
		addModelButton.disabled = !isVerified;
		modelInput.disabled = !isVerified;
		
		if (isVerified) {
			addModelButton.classList.add('enabled');
			
			if (isCustomProvider) {
				// For custom provider, just enable the text input
				const textInput = modelInput as HTMLInputElement;
				textInput.placeholder = t('setKeys.customModelPlaceholder');
			} else {
				// For other providers, populate dropdown
				const dropdown = modelInput as HTMLSelectElement;
				const models = this.availableModels.get(providerId) || [];
				
				// Clear existing options properly
				while (dropdown.firstChild) {
					dropdown.removeChild(dropdown.firstChild);
				}
				
				// Add placeholder option
				const placeholderOption = document.createElement('option');
				placeholderOption.value = '';
				placeholderOption.textContent = t('setKeys.selectModelPlaceholder');
				dropdown.appendChild(placeholderOption);
				
				// Add model options
				models.forEach(model => {
					const option = document.createElement('option');
					option.value = model.id;
					option.textContent = `${model.name}${model.hasVision ? ' (Vision)' : ' (Text Only)'}`;
					
					// Add visual indicator for non-vision models
					if (!model.hasVision) {
						option.classList.add('set-keys-option-disabled');
					}
					
					dropdown.appendChild(option);
				});
			}
		} else {
			addModelButton.classList.remove('enabled');
			
			if (isCustomProvider) {
				const textInput = modelInput as HTMLInputElement;
				textInput.placeholder = t('setKeys.verifyApiKeyFirst');
				textInput.value = '';
			} else {
				const dropdown = modelInput as HTMLSelectElement;
				
				// Clear existing options properly
				while (dropdown.firstChild) {
					dropdown.removeChild(dropdown.firstChild);
				}
				
				// Add disabled placeholder option
				const placeholderOption = document.createElement('option');
				placeholderOption.value = '';
				placeholderOption.textContent = t('setKeys.verifyApiKeyFirst');
				dropdown.appendChild(placeholderOption);
			}
		}
	}

	private async verifyProvider(providerId: string) {
		const provider = LLM_PROVIDERS.find(p => p.id === providerId);
		if (!provider) return;

		const credentials = this.plugin.settings.providerCredentials[providerId];
		if (!credentials || !credentials.apiKey.trim()) {
			new Notice('Please enter an API key first');
			return;
		}

		this.verificationStates.set(providerId, 'verifying');
		this.updateVerifyButton(providerId);

		try {
			// Verify API key by making a test request
			const isValid = await this.testApiKey(provider, credentials);
			
			if (isValid) {
				this.verificationStates.set(providerId, 'verified');
				credentials.verified = true;
				credentials.verifiedAt = new Date();
				credentials.lastError = undefined;
				
				// Load available models
				await this.loadAvailableModels(provider);
				
				new Notice(`✅ ${provider.displayName} API key verified successfully`);
			} else {
				this.verificationStates.set(providerId, 'error');
				credentials.verified = false;
				credentials.lastError = 'Invalid API key';
				new Notice(`❌ ${provider.displayName} API key verification failed`);
			}

			await this.plugin.saveSettings();
			this.updateVerifyButton(providerId);
			this.updateAddModelSection(providerId);

		} catch (error) {
			this.verificationStates.set(providerId, 'error');
			credentials.verified = false;
			credentials.lastError = error.message;
			await this.plugin.saveSettings();
			
			this.updateVerifyButton(providerId);
			this.updateAddModelSection(providerId);
			
			new Notice(`❌ ${provider.displayName} verification error: ${error.message}`);
		}
	}

	private async testApiKey(provider: LLMProvider, credentials: any): Promise<boolean> {
		// This is a simplified test - in a real implementation you'd make actual API calls
		// For now, we'll just check that the API key is not empty and has reasonable format
		const apiKey = credentials.apiKey.trim();
		
		if (!apiKey) return false;

		// Basic format validation
		switch (provider.id) {
			case 'openai':
				return apiKey.startsWith('sk-') && apiKey.length > 40;
			case 'anthropic':
				return apiKey.startsWith('sk-ant-') && apiKey.length > 50;
			case 'google':
				return apiKey.length > 30; // Google API keys vary in format
			case 'cohere':
				return apiKey.length > 30;
			case 'openrouter':
				return apiKey.startsWith('sk-or-') && apiKey.length > 50; // OpenRouter format
			case 'custom':
				return apiKey.length > 5; // Very basic check for custom
			default:
				return apiKey.length > 5;
		}
	}

	private async loadAvailableModels(provider: LLMProvider) {
		try {
			const credentials = this.plugin.settings.providerCredentials[provider.id];
			if (!credentials || !credentials.apiKey) {
				console.warn(`No API key found for provider ${provider.id}`);
				this.availableModels.set(provider.id, provider.models || []);
				return;
			}

			// For major providers, try to fetch models from API
			if (provider.id !== 'custom') {
				getLogger().log(`Loading models for ${provider.displayName}...`);
				try {
					const fetchedModels = await this.fetchModelsFromAPI(provider, credentials);
					if (fetchedModels && fetchedModels.length > 0) {
						this.availableModels.set(provider.id, fetchedModels);
						getLogger().log(`✅ Fetched ${fetchedModels.length} models for ${provider.displayName}`);
						return;
					} else {
						console.warn(`No models returned from API for ${provider.displayName}, using fallback`);
					}
				} catch (error) {
					console.warn(`API fetch failed for ${provider.displayName}, using fallback:`, error);
				}
			}
			
			// Fallback to static models
			const fallbackModels = provider.models || [];
			this.availableModels.set(provider.id, fallbackModels);
			getLogger().log(`Using ${fallbackModels.length} fallback models for ${provider.displayName}`);
		} catch (error) {
			console.error(`Failed to load models for ${provider.displayName}:`, error);
			// Fallback to static models on error
			this.availableModels.set(provider.id, provider.models || []);
		}
	}

	private async fetchModelsFromAPI(provider: LLMProvider, credentials: any): Promise<LLMModel[]> {
		const baseUrl = credentials.baseUrl || provider.defaultBaseUrl;
		const apiKey = credentials.apiKey;

		try {
			let url: string;
			let headers: Record<string, string>;

			switch (provider.id) {
				case 'openai':
					url = `${baseUrl}/models`;
					headers = {
						'Authorization': `Bearer ${apiKey}`,
						'Content-Type': 'application/json'
					};
					break;
				
				case 'anthropic':
					// Anthropic doesn't have a public models endpoint, use static list
					return provider.models || [];
				
				case 'google':
					// Google AI Studio models endpoint
					url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
					headers = {
						'Content-Type': 'application/json'
					};
					break;
				
				case 'cohere':
					url = `${baseUrl}/models`;
					headers = {
						'Authorization': `Bearer ${apiKey}`,
						'Content-Type': 'application/json'
					};
					break;
				
				case 'openrouter':
					url = `${baseUrl}/models`;
					headers = {
						'Authorization': `Bearer ${apiKey}`,
						'Content-Type': 'application/json'
					};
					break;
				
				default:
					return provider.models || [];
			}

			// Create an AbortController for timeout
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

			const response = await fetch(url, {
				method: 'GET',
				headers: headers,
				signal: controller.signal
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			const data = await response.json();
			return this.parseModelsResponse(provider.id, data);

		} catch (error) {
			console.error(`API call failed for ${provider.displayName}:`, error);
			throw error;
		}
	}

	private parseModelsResponse(providerId: string, data: any): LLMModel[] {
		try {
			switch (providerId) {
				case 'openai':
					if (data.data && Array.isArray(data.data)) {
						return data.data
							.filter((model: any) => {
								// Include all OpenAI models
								const id = model.id?.toLowerCase() || '';
								return id.includes('gpt') || id.includes('davinci') || id.includes('curie') || id.includes('babbage') || id.includes('ada');
							})
							.map((model: any) => {
								const id = model.id?.toLowerCase() || '';
								
								// Priority 1: Check capabilities field from API metadata if available
								let hasVision = false;
								if (model.capabilities && Array.isArray(model.capabilities)) {
									hasVision = model.capabilities.some((cap: string) => 
										cap.toLowerCase().includes('vision') || 
										cap.toLowerCase().includes('image')
									);
								}
								
								// Priority 2: Fallback to model ID detection with enhanced patterns
								if (!hasVision) {
									hasVision = id.includes('vision') || 
												(id.includes('gpt-4') && (id.includes('turbo') || id.includes('preview') || id.includes('o'))) ||
												id.includes('gpt-4o');
								}
								
								return {
									id: model.id,
									name: model.id,
									hasVision: hasVision,
									contextWindow: 4096 // Default, can be improved
								};
							});
					}
					break;
				
				case 'google':
					if (data.models && Array.isArray(data.models)) {
						return data.models
							.filter((model: any) => {
								// Include all Google models that support text generation
								const name = model.name?.toLowerCase() || '';
								return name.includes('gemini') || name.includes('bison') || name.includes('chat');
							})
							.map((model: any) => {
								const name = model.name?.toLowerCase() || '';
								
								// Priority 1: Check supportedGenerationMethods from API metadata
								let hasVision = false;
								if (model.supportedGenerationMethods && Array.isArray(model.supportedGenerationMethods)) {
									hasVision = model.supportedGenerationMethods.some((method: string) => 
										method.toLowerCase().includes('vision') || 
										method.toLowerCase().includes('multimodal')
									);
								}
								
								// Priority 2: Check inputModalities if available
								if (!hasVision && model.inputModalities && Array.isArray(model.inputModalities)) {
									hasVision = model.inputModalities.some((modality: string) => 
										modality.toLowerCase().includes('image') || 
										modality.toLowerCase().includes('vision')
									);
								}
								
								// Priority 3: Fallback to model name detection with enhanced patterns
								if (!hasVision) {
									hasVision = name.includes('vision') || name.includes('gemini-pro') ||
												name.includes('gemini-1.5') || name.includes('gemini-2');
								}
								
								return {
									id: model.name.replace('models/', ''),
									name: model.displayName || model.name.replace('models/', ''),
									hasVision: hasVision,
									contextWindow: 4096
								};
							});
					}
					break;
				
				case 'cohere':
					if (data.models && Array.isArray(data.models)) {
						return data.models
							.filter((model: any) => model.endpoints?.includes('chat'))
							.map((model: any) => ({
								id: model.name,
								name: model.name,
								hasVision: false, // Cohere doesn't have vision models yet
								contextWindow: model.context_length || 4096
							}));
					}
					break;
				
				case 'openrouter':
					if (data.data && Array.isArray(data.data)) {
						return data.data
							.map((model: any) => {
								const id = model.id?.toLowerCase() || '';
								const name = model.name?.toLowerCase() || '';
								
								// Priority 1: Check modalities field from API metadata
								let hasVision = false;
								if (model.modalities && Array.isArray(model.modalities)) {
									// Check if model supports image input
									hasVision = model.modalities.some((modality: string) => 
										modality.toLowerCase().includes('image') || 
										modality.toLowerCase().includes('vision')
									);
								}
								
								// Priority 2: Fallback to model ID/name detection with enhanced patterns
								if (!hasVision) {
									hasVision = id.includes('vision') || name.includes('vision') || 
												id.includes('vl') || name.includes('vl') || // For Qwen VL models
												(id.includes('gpt-4') && (id.includes('turbo') || id.includes('preview') || id.includes('o'))) ||
												id.includes('claude-3') || id.includes('gemini') ||
												id.includes('llama') && (id.includes('vision') || id.includes('vl')) ||
												id.includes('pixtral') || id.includes('flamingo');
								}
								
								return {
									id: model.id,
									name: model.name || model.id,
									hasVision: hasVision,
									contextWindow: model.context_length || 4096
								};
							});
					}
					break;
			}
		} catch (error) {
			console.error(`Failed to parse models response for ${providerId}:`, error);
		}
		
		return [];
	}

	private addCustomModel(provider: LLMProvider, modelName: string) {
		const providerEl = this.contentEl.querySelector(`[data-provider="${provider.id}"]`) as HTMLElement;
		if (!providerEl) return;

		// Get vision checkbox state
		const visionCheckbox = (providerEl as any)._visionCheckbox as HTMLInputElement;
		const hasVision = visionCheckbox ? visionCheckbox.checked : true;

		// Get the current custom provider settings
		const credentials = this.plugin.settings.providerCredentials[provider.id];
		if (!credentials) {
			new Notice(t('notice.pleaseSetupProviderFirst'));
			return;
		}

		// Get custom provider name from input field
		const customName = credentials.customName?.trim() || 'Custom Provider';

		// Create a custom model object
		const customModel: LLMModel = {
			id: modelName,
			name: modelName,
			hasVision: hasVision,
			contextWindow: 4096 // Default context window
		};
		
		this.addModelConfigWithCustomProvider(provider, customModel, {
			name: customName,
			baseUrl: credentials.baseUrl || '',
			apiPath: credentials.apiPath || '/v1/chat/completions',
			apiKey: credentials.apiKey
		});
		
		// Clear the input field
		const modelInput = (providerEl as any)._modelInput as HTMLInputElement;
		if (modelInput) {
			modelInput.value = '';
		}
	}

	private getSmartMaxTokens(modelId: string, modelName: string, defaultMaxTokens?: number): number {
		// If model has explicit maxTokens, use it
		if (defaultMaxTokens) {
			return defaultMaxTokens;
		}
		
		// Smart inference based on model name patterns
		const lowerModel = modelId.toLowerCase() + ' ' + modelName.toLowerCase();
		
		// Large context models (8K+ output)
		if (lowerModel.includes('claude-3.5-sonnet') || lowerModel.includes('gemini-1.5-pro') || 
			lowerModel.includes('gemini-1.5-flash') || lowerModel.includes('gemini-2')) {
			return 8192;
		}
		
		// Medium-large context models (4K output) - includes most modern models
		if (lowerModel.includes('gpt-4') || lowerModel.includes('claude-3') || 
			lowerModel.includes('llama') || lowerModel.includes('qwen')) {
			return 4096;
		}
		
		// Small context models (2K output)
		if (lowerModel.includes('gemini-pro-vision') || lowerModel.includes('3.5-turbo')) {
			return 2048;
		}
		
		// For qwen/qwen2.5-vl-32b-instruct:free type models - use 2K as safe default
		if (lowerModel.includes('qwen2.5') || lowerModel.includes('32b') || 
			lowerModel.includes('instruct') || lowerModel.includes('free')) {
			return 2048;  // Conservative for free tier models
		}
		
		// Conservative default for unknown models
		return 2048;
	}

	private addModelConfigWithCustomProvider(provider: LLMProvider, model: LLMModel, customProviderInfo: {name: string, baseUrl: string, apiPath: string, apiKey: string}) {
		const modelConfig: ModelConfig = {
			id: `${provider.id}-${model.id}-${Date.now()}`,
			name: `${customProviderInfo.name} - ${model.name}`,
			providerId: provider.id,
			modelId: model.id,
			isVisionCapable: model.hasVision,
			settings: { ...DEFAULT_MODEL_SETTINGS },
			createdAt: new Date(),
			customProvider: {
				name: customProviderInfo.name,
				baseUrl: customProviderInfo.baseUrl,
				apiPath: customProviderInfo.apiPath,
				apiKey: customProviderInfo.apiKey
			}
		};

		// Apply model-specific defaults with smart inference
		const smartMaxTokens = this.getSmartMaxTokens(model.id, model.name, model.maxTokens);
		modelConfig.settings.maxTokens = smartMaxTokens;

		this.plugin.settings.modelConfigs.push(modelConfig);
		
		// Set as default if it's the first model, or if it's vision-capable and no vision model is set as default
		const currentDefault = this.plugin.settings.modelConfigs.find(mc => mc.id === this.plugin.settings.defaultModelConfigId);
		if (!this.plugin.settings.defaultModelConfigId || 
			(model.hasVision && (!currentDefault || !currentDefault.isVisionCapable))) {
			this.plugin.settings.defaultModelConfigId = modelConfig.id;
		}

		this.plugin.saveSettings();
		
		const visionStatus = model.hasVision ? "✅ Vision Enabled" : "❌ Vision Disabled";
		new Notice(`✅ Added ${modelConfig.name} - ${visionStatus}`);

		// Update display
		this.onOpen();
	}

	private addModelConfig(provider: LLMProvider, model: LLMModel) {
		// Get the display name for the provider, using custom name if available
		let providerDisplayName = provider.displayName;
		if (provider.id === 'custom') {
			const customName = this.plugin.settings.providerCredentials[provider.id]?.customName;
			if (customName && customName.trim()) {
				providerDisplayName = customName.trim();
			}
		}
		
		const modelConfig: ModelConfig = {
			id: `${provider.id}-${model.id}-${Date.now()}`,
			name: `${providerDisplayName} - ${model.name}`,
			providerId: provider.id,
			modelId: model.id,
			isVisionCapable: model.hasVision, // Will be updated by vision test for non-custom providers
			settings: { ...DEFAULT_MODEL_SETTINGS },
			createdAt: new Date()
		};

		// Apply model-specific defaults with smart inference
		const smartMaxTokens = this.getSmartMaxTokens(model.id, model.name, model.maxTokens);
		modelConfig.settings.maxTokens = smartMaxTokens;

		// For custom provider, don't test vision capability - trust user's checkbox setting
		if (provider.id === 'custom') {
			this.plugin.settings.modelConfigs.push(modelConfig);
			
			// Set as default if it's the first model, or if it's vision-capable and no vision model is set as default
			const currentDefault = this.plugin.settings.modelConfigs.find(mc => mc.id === this.plugin.settings.defaultModelConfigId);
			if (!this.plugin.settings.defaultModelConfigId || 
				(model.hasVision && (!currentDefault || !currentDefault.isVisionCapable))) {
				this.plugin.settings.defaultModelConfigId = modelConfig.id;
			}

			this.plugin.saveSettings();
			
			const visionStatus = model.hasVision ? "✅ Vision Enabled" : "❌ Vision Disabled";
			new Notice(`✅ Added ${modelConfig.name} - ${visionStatus} (User Setting)`);
			
			// Refresh all UI components that depend on model configurations
			this.refreshModelDependentComponents();
			return;
		}

		// For other providers, test vision capability by sending a test image
		new Notice(`🔍 Testing vision capability for ${modelConfig.name}...`);
		
		this.testVisionCapability(modelConfig).then((actualVisionCapability) => {
			// Update the model config with actual vision capability
			modelConfig.isVisionCapable = actualVisionCapability;
			
			this.plugin.settings.modelConfigs.push(modelConfig);
			
			// Set as default if it's the first model, or if it's vision-capable and no vision model is set as default
			const currentDefault = this.plugin.settings.modelConfigs.find(mc => mc.id === this.plugin.settings.defaultModelConfigId);
			if (!this.plugin.settings.defaultModelConfigId || 
				(actualVisionCapability && (!currentDefault || !currentDefault.isVisionCapable))) {
				this.plugin.settings.defaultModelConfigId = modelConfig.id;
			}

			this.plugin.saveSettings();
			
			const visionStatus = actualVisionCapability ? "✅ Vision Supported" : "❌ Vision Not Supported";
			new Notice(`✅ Added ${modelConfig.name} - ${visionStatus}`);
			
			// Refresh all UI components that depend on model configurations
			this.refreshModelDependentComponents();
		}).catch((error) => {
			console.error('Vision test failed, using default capability:', error);
			
			// On error, fall back to the original model definition
			this.plugin.settings.modelConfigs.push(modelConfig);
			
			// Set as default if it's the first model, or if it's vision-capable and no vision model is set as default
			const currentDefault = this.plugin.settings.modelConfigs.find(mc => mc.id === this.plugin.settings.defaultModelConfigId);
			if (!this.plugin.settings.defaultModelConfigId || 
				(model.hasVision && (!currentDefault || !currentDefault.isVisionCapable))) {
				this.plugin.settings.defaultModelConfigId = modelConfig.id;
			}

			this.plugin.saveSettings();
			new Notice(`✅ Added ${modelConfig.name} (Vision test failed, using default setting)`);
			
			// Refresh all UI components that depend on model configurations
			this.refreshModelDependentComponents();
		});
	}

	private refreshModelDependentComponents() {
		// The settings tab now has an auto-refresh mechanism
		// We just need to refresh AI chat views here
		const aiChatLeaves = this.plugin.app.workspace.getLeavesOfType('ai-chat');
		aiChatLeaves.forEach(leaf => {
			const view = leaf.view as any;
			if (view && typeof view.updateContent === 'function') {
				view.updateContent();
			}
		});
	}


	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		
		// Refresh AI chat views when modal closes
		const aiChatLeaves = this.plugin.app.workspace.getLeavesOfType('ai-chat');
		aiChatLeaves.forEach(leaf => {
			const view = leaf.view as any;
			if (view && typeof view.updateContent === 'function') {
				view.updateContent();
			}
		});
	}

	private async testVisionCapability(modelConfig: ModelConfig): Promise<boolean> {
		try {
			// Create a small test image (1x1 red pixel) as base64
			const testImageBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
			
			// Get provider credentials
			const credentials = this.plugin.settings.providerCredentials[modelConfig.providerId];
			if (!credentials || !credentials.verified || !credentials.apiKey.trim()) {
				throw new Error('Provider credentials not verified');
			}

			// Send test message with image
			const testMessage = 'This is a vision test. Can you see this image? Please respond with yes or no.';
			const result = await this.sendVisionTestRequest(testMessage, testImageBase64, modelConfig, credentials);
			
			return result;
		} catch (error) {
			console.error('Vision capability test failed:', error);
			throw error;
		}
	}

	private async sendVisionTestRequest(message: string, imageBase64: string, modelConfig: ModelConfig, credentials: any): Promise<boolean> {
		const provider = LLM_PROVIDERS.find(p => p.id === modelConfig.providerId);
		if (!provider) {
			throw new Error(`Unknown provider: ${modelConfig.providerId}`);
		}

		let response: Response;
		
		// Remove data URL prefix to get just the base64
		const base64Data = imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');

		try {
			switch (provider.id) {
				case 'openai':
					response = await this.testOpenAIVision(message, base64Data, modelConfig, credentials);
					break;
				case 'anthropic':
					response = await this.testAnthropicVision(message, base64Data, modelConfig, credentials);
					break;
				case 'google':
					response = await this.testGoogleVision(message, base64Data, modelConfig, credentials);
					break;
				case 'openrouter':
					response = await this.testOpenRouterVision(message, base64Data, modelConfig, credentials);
					break;
				case 'custom':
					response = await this.testCustomVision(message, base64Data, modelConfig, credentials);
					break;
				default:
					throw new Error(`Vision testing not implemented for provider: ${provider.id}`);
			}

			if (!response.ok) {
				const errorText = await response.text();
				getLogger().log('Vision test API error response:', errorText);
				
				// Check if the error indicates vision is not supported
				if (errorText.toLowerCase().includes('vision') || 
					errorText.toLowerCase().includes('image') ||
					errorText.toLowerCase().includes('multimodal') ||
					response.status === 400) {
					return false; // Vision not supported
				}
				
				throw new Error(`API call failed: ${response.status} ${response.statusText}`);
			}

			// If we get a successful response, the model supports vision
			const responseData = await response.json();
			getLogger().log('Vision test successful, response:', responseData);
			return true;
			
		} catch (error) {
			// If there's a network error or parsing error, check the error message
			const errorMessage = error.message.toLowerCase();
			if (errorMessage.includes('vision') || 
				errorMessage.includes('image') || 
				errorMessage.includes('multimodal') ||
				errorMessage.includes('does not support')) {
				return false; // Vision not supported
			}
			
			// For other errors, re-throw
			throw error;
		}
	}

	private async testOpenAIVision(message: string, base64Image: string, modelConfig: ModelConfig, credentials: any): Promise<Response> {
		return fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${credentials.apiKey}`
			},
			body: JSON.stringify({
				model: modelConfig.modelId,
				messages: [{
					role: 'user',
					content: [
						{ type: 'text', text: message },
						{ type: 'image_url', image_url: { url: `data:image/png;base64,${base64Image}` } }
					]
				}],
				max_tokens: 10
			})
		});
	}

	private async testAnthropicVision(message: string, base64Image: string, modelConfig: ModelConfig, credentials: any): Promise<Response> {
		return fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': credentials.apiKey,
				'anthropic-version': '2023-06-01'
			},
			body: JSON.stringify({
				model: modelConfig.modelId,
				messages: [{
					role: 'user',
					content: [
						{ type: 'text', text: message },
						{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64Image } }
					]
				}],
				max_tokens: 10
			})
		});
	}

	private async testGoogleVision(message: string, base64Image: string, modelConfig: ModelConfig, credentials: any): Promise<Response> {
		return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelConfig.modelId}:generateContent?key=${credentials.apiKey}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				contents: [{
					parts: [
						{ text: message },
						{ inline_data: { mime_type: 'image/png', data: base64Image } }
					]
				}],
				generationConfig: { maxOutputTokens: 10 }
			})
		});
	}

	private async testOpenRouterVision(message: string, base64Image: string, modelConfig: ModelConfig, credentials: any): Promise<Response> {
		return fetch('https://openrouter.ai/api/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${credentials.apiKey}`,
				'HTTP-Referer': 'https://obsidian.md',
				'X-Title': 'Obsidian CaptureAI Plugin'
			},
			body: JSON.stringify({
				model: modelConfig.modelId,
				messages: [{
					role: 'user',
					content: [
						{ type: 'text', text: message },
						{ type: 'image_url', image_url: { url: `data:image/png;base64,${base64Image}` } }
					]
				}],
				max_tokens: 10
			})
		});
	}

	private async testCustomVision(message: string, base64Image: string, modelConfig: ModelConfig, credentials: any): Promise<Response> {
		const baseUrl = credentials.baseUrl || 'https://api.openai.com/v1';
		return fetch(`${baseUrl}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${credentials.apiKey}`
			},
			body: JSON.stringify({
				model: modelConfig.modelId,
				messages: [{
					role: 'user',
					content: [
						{ type: 'text', text: message },
						{ type: 'image_url', image_url: { url: `data:image/png;base64,${base64Image}` } }
					]
				}],
				max_tokens: 10
			})
		});
	}
}

class ModelSelectionModal extends Modal {
	private plugin: ImageCapturePlugin;
	private provider: LLMProvider;
	private models: LLMModel[];
	private onSelect: (model: LLMModel) => void;

	constructor(plugin: ImageCapturePlugin, provider: LLMProvider, models: LLMModel[], onSelect: (model: LLMModel) => void) {
		super(plugin.app);
		this.plugin = plugin;
		this.provider = provider;
		this.models = models;
		this.onSelect = onSelect;
		this.modalEl.addClass('model-selection-modal');
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h3', { text: `Add Model from ${this.provider.displayName}` });
		contentEl.createEl('p', { 
			text: 'Select a model to add to your configuration:',
			cls: 'modal-description'
		});

		const modelsEl = contentEl.createEl('div', { cls: 'models-list' });

		this.models.forEach(model => {
			const modelEl = modelsEl.createEl('div', { cls: 'model-item' });
			
			const infoEl = modelEl.createEl('div', { cls: 'model-info' });
			infoEl.createEl('div', { text: model.name, cls: 'model-name' });
			
			const metaEl = infoEl.createEl('div', { cls: 'model-meta' });
			if (model.hasVision) {
				metaEl.createEl('span', { text: 'Vision', cls: 'vision-badge' });
			}
			if (model.contextWindow) {
				metaEl.createEl('span', { text: `${model.contextWindow.toLocaleString()} tokens`, cls: 'context-badge' });
			}
			
			const addBtn = modelEl.createEl('button', { text: 'Add', cls: 'add-btn' });
			addBtn.addEventListener('click', () => {
				this.onSelect(model);
				this.close();
			});
		});

	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		
		// Refresh AI chat views when modal closes
		const aiChatLeaves = this.plugin.app.workspace.getLeavesOfType('ai-chat');
		aiChatLeaves.forEach(leaf => {
			const view = leaf.view as any;
			if (view && typeof view.updateContent === 'function') {
				view.updateContent();
			}
		});
	}
}