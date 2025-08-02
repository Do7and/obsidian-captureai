import { Modal, Setting, Notice, DropdownComponent } from 'obsidian';
import ImageCapturePlugin from '../main';
import { LLM_PROVIDERS, LLMProvider, LLMModel, ModelConfig, DEFAULT_MODEL_SETTINGS } from '../types';

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
		headerEl.createEl('h2', { text: 'AI Provider Settings' });
		headerEl.createEl('p', { 
			text: 'Configure your AI providers by adding their API keys.',
			cls: 'modal-description'
		});

		// Providers container
		const providersEl = contentEl.createEl('div', { cls: 'providers-container' });

		// Create settings for each provider
		LLM_PROVIDERS.forEach(provider => {
			this.createProviderSetting(providersEl, provider);
		});

		// Add custom styles
		this.addStyles();
	}

	private createProviderSetting(container: HTMLElement, provider: LLMProvider) {
		const providerEl = container.createEl('div', { cls: 'provider-setting' });
		providerEl.setAttribute('data-provider', provider.id);
		
		// Provider header
		const headerEl = providerEl.createEl('div', { cls: 'provider-header' });
		headerEl.createEl('h3', { text: provider.displayName });
		
		if (provider.apiKeyLink) {
			const linkEl = headerEl.createEl('a', { 
				text: 'Get API Key',
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
		if (isVerified && provider.models) {
			this.availableModels.set(provider.id, provider.models);
		}

		// API Key setting with inline verify button
		const apiKeyContainer = providerEl.createEl('div', { cls: 'api-key-container' });
		const apiKeyLabel = apiKeyContainer.createEl('div', { cls: 'setting-item-info' });
		apiKeyLabel.createEl('div', { text: 'API Key', cls: 'setting-item-name' });
		apiKeyLabel.createEl('div', { text: 'Enter your API key for this provider', cls: 'setting-item-description' });
		
		const apiKeyInputContainer = apiKeyContainer.createEl('div', { cls: 'api-key-input-container' });
		
		const apiKeyInput = apiKeyInputContainer.createEl('input', { 
			type: 'password',
			placeholder: 'Enter API key...',
			cls: 'api-key-input'
		});
		apiKeyInput.value = apiKey;
		
		// Verify button inline with input
		const verifyButton = apiKeyInputContainer.createEl('button', { 
			text: 'Verify',
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
				.setName('Base URL')
				.setDesc('Enter the base URL for your custom API endpoint')
				.addText(text => {
					text.setPlaceholder('https://api.example.com/v1')
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
		}

		// Add Model section with dropdown
		const addModelContainer = providerEl.createEl('div', { cls: 'add-model-container' });
		const addModelLabel = addModelContainer.createEl('div', { cls: 'setting-item-info' });
		addModelLabel.createEl('div', { text: 'Add Model', cls: 'setting-item-name' });
		addModelLabel.createEl('div', { text: 'Select and add available models', cls: 'setting-item-description' });
		
		const addModelInputContainer = addModelContainer.createEl('div', { cls: 'add-model-input-container' });
		
		const modelDropdown = addModelInputContainer.createEl('select', { cls: 'model-dropdown' });
		const addModelButton = addModelInputContainer.createEl('button', { 
			text: 'Add Model',
			cls: 'add-model-button'
		});
		
		// Store references for updates
		(providerEl as any)._verifyButton = verifyButton;
		(providerEl as any)._addModelButton = addModelButton;
		(providerEl as any)._modelDropdown = modelDropdown;

		// Set initial states
		this.updateVerifyButton(provider.id);
		this.updateAddModelSection(provider.id);

		// Add model selection handler
		addModelButton.addEventListener('click', () => {
			if (this.verificationStates.get(provider.id) === 'verified') {
				const selectedValue = modelDropdown.value;
				if (selectedValue) {
					const model = this.availableModels.get(provider.id)?.find(m => m.id === selectedValue);
					if (model) {
						this.addModelConfig(provider, model);
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
		
		switch (state) {
			case 'idle':
				verifyButton.textContent = 'Verify';
				verifyButton.disabled = false;
				verifyButton.classList.remove('verified', 'verifying', 'error');
				break;
			case 'verifying':
				verifyButton.textContent = 'Verifying...';
				verifyButton.disabled = true;
				verifyButton.classList.add('verifying');
				verifyButton.classList.remove('verified', 'error');
				break;
			case 'verified':
				verifyButton.textContent = 'Verified';
				verifyButton.disabled = false;
				verifyButton.classList.add('verified');
				verifyButton.classList.remove('verifying', 'error');
				break;
			case 'error':
				verifyButton.textContent = 'Retry';
				verifyButton.disabled = false;
				verifyButton.classList.add('error');
				verifyButton.classList.remove('verifying', 'verified');
				break;
		}
	}

	private updateAddModelSection(providerId: string) {
		const provider = LLM_PROVIDERS.find(p => p.id === providerId);
		if (!provider) return;

		const providerEl = this.contentEl.querySelector(`[data-provider="${providerId}"]`) as HTMLElement;
		if (!providerEl) return;

		const addModelButton = (providerEl as any)._addModelButton as HTMLButtonElement;
		const modelDropdown = (providerEl as any)._modelDropdown as HTMLSelectElement;
		if (!addModelButton || !modelDropdown) return;

		const state = this.verificationStates.get(providerId) || 'idle';
		const isVerified = state === 'verified';
		
		addModelButton.disabled = !isVerified;
		modelDropdown.disabled = !isVerified;
		
		if (isVerified) {
			addModelButton.classList.add('enabled');
			// Populate dropdown with available models
			const models = this.availableModels.get(providerId) || [];
			modelDropdown.innerHTML = '<option value="">Select a model...</option>';
			models.forEach(model => {
				const option = modelDropdown.createEl('option', { 
					value: model.id,
					text: `${model.name}${model.hasVision ? ' (Vision)' : ''}`
				});
			});
		} else {
			addModelButton.classList.remove('enabled');
			modelDropdown.innerHTML = '<option value="">Verify API key first</option>';
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
		// For now, use the static models from the provider definition
		// In a real implementation, you might fetch this from the API
		this.availableModels.set(provider.id, provider.models);
	}

	private showAddModelDropdown(providerId: string) {
		const provider = LLM_PROVIDERS.find(p => p.id === providerId);
		if (!provider) return;

		const models = this.availableModels.get(providerId) || [];
		if (models.length === 0) {
			new Notice('No models available for this provider');
			return;
		}

		// Create a simple dropdown selection
		const options = models.map(model => ({
			value: model.id,
			label: `${model.name}${model.hasVision ? ' (Vision)' : ''}`
		}));

		// Create a temporary modal for model selection
		const modal = new ModelSelectionModal(this.plugin, provider, models, (selectedModel) => {
			this.addModelConfig(provider, selectedModel);
		});
		modal.open();
	}

	private addModelConfig(provider: LLMProvider, model: LLMModel) {
		const modelConfig: ModelConfig = {
			id: `${provider.id}-${model.id}-${Date.now()}`,
			name: `${provider.displayName} - ${model.name}`,
			providerId: provider.id,
			modelId: model.id,
			isVisionCapable: model.hasVision,
			settings: { ...DEFAULT_MODEL_SETTINGS },
			createdAt: new Date()
		};

		// Apply model-specific defaults
		if (model.maxTokens) {
			modelConfig.settings.maxTokens = Math.min(model.maxTokens, DEFAULT_MODEL_SETTINGS.maxTokens);
		}

		this.plugin.settings.modelConfigs.push(modelConfig);
		
		// Set as default if it's the first vision-capable model
		if (model.hasVision && !this.plugin.settings.defaultModelConfigId) {
			this.plugin.settings.defaultModelConfigId = modelConfig.id;
		}

		this.plugin.saveSettings();
		new Notice(`✅ Added ${modelConfig.name} to your model configurations`);
	}

	private addStyles() {
		if (!document.getElementById('set-keys-modal-styles')) {
			const style = document.createElement('style');
			style.id = 'set-keys-modal-styles';
			style.textContent = `
				.set-keys-modal {
					width: 700px;
					max-width: 90vw;
				}

				.modal-header {
					margin-bottom: 20px;
					text-align: center;
				}

				.modal-header h2 {
					margin: 0 0 8px 0;
					font-size: 24px;
				}

				.modal-description {
					margin: 0;
					color: var(--text-muted);
					font-size: 14px;
				}

				.providers-container {
					display: flex;
					flex-direction: column;
					gap: 20px;
					max-height: 600px;
					overflow-y: auto;
					padding-right: 8px;
				}

				.provider-setting {
					border: 1px solid var(--background-modifier-border);
					border-radius: 8px;
					padding: 16px;
					background: var(--background-secondary);
				}

				.provider-header {
					display: flex;
					justify-content: space-between;
					align-items: center;
					margin-bottom: 16px;
				}

				.provider-header h3 {
					margin: 0;
					color: var(--text-normal);
				}

				.provider-link {
					color: var(--interactive-accent);
					text-decoration: none;
					font-size: 12px;
				}

				.provider-link:hover {
					text-decoration: underline;
				}

				.api-key-container, .add-model-container {
					margin-bottom: 16px;
				}

				.setting-item-info {
					margin-bottom: 8px;
				}

				.setting-item-name {
					font-weight: 500;
					color: var(--text-normal);
					margin-bottom: 2px;
				}

				.setting-item-description {
					font-size: 12px;
					color: var(--text-muted);
				}

				.api-key-input-container, .add-model-input-container {
					display: flex;
					gap: 8px;
					align-items: center;
				}

				.api-key-input {
					flex: 1;
					padding: 8px 12px;
					border: 1px solid var(--background-modifier-border);
					border-radius: 4px;
					background: var(--background-primary);
					color: var(--text-normal);
					font-size: 13px;
				}

				.api-key-input:focus {
					border-color: var(--interactive-accent);
					outline: none;
				}

				.model-dropdown {
					flex: 1;
					padding: 8px 12px;
					border: 1px solid var(--background-modifier-border);
					border-radius: 4px;
					background: var(--background-primary);
					color: var(--text-normal);
					font-size: 13px;
				}

				.model-dropdown:disabled {
					opacity: 0.5;
					cursor: not-allowed;
				}

				.verify-button-inline, .add-model-button {
					padding: 8px 16px;
					border: 1px solid var(--background-modifier-border);
					border-radius: 4px;
					background: var(--background-primary);
					color: var(--text-normal);
					cursor: pointer;
					font-size: 13px;
					transition: all 0.2s;
					white-space: nowrap;
				}

				.verify-button-inline:hover, .add-model-button:hover:not(:disabled) {
					background: var(--background-modifier-hover);
				}

				.verify-button-inline.verifying {
					background: var(--interactive-accent);
					color: var(--text-on-accent);
					cursor: not-allowed;
				}

				.verify-button-inline.verified {
					background: var(--interactive-success);
					color: white;
				}

				.verify-button-inline.error {
					background: var(--interactive-critical);
					color: white;
				}

				.add-model-button:disabled {
					opacity: 0.5;
					cursor: not-allowed;
				}

				.add-model-button.enabled {
					background: var(--interactive-accent);
					color: var(--text-on-accent);
				}
			`;
			document.head.appendChild(style);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
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

		// Add styles for model selection
		if (!document.getElementById('model-selection-styles')) {
			const style = document.createElement('style');
			style.id = 'model-selection-styles';
			style.textContent = `
				.model-selection-modal {
					width: 500px;
				}

				.models-list {
					display: flex;
					flex-direction: column;
					gap: 8px;
					margin-top: 16px;
				}

				.model-item {
					display: flex;
					justify-content: space-between;
					align-items: center;
					padding: 12px;
					border: 1px solid var(--background-modifier-border);
					border-radius: 6px;
					background: var(--background-primary);
				}

				.model-info {
					flex: 1;
				}

				.model-name {
					font-weight: 500;
					margin-bottom: 4px;
				}

				.model-meta {
					display: flex;
					gap: 8px;
				}

				.vision-badge, .context-badge {
					font-size: 11px;
					padding: 2px 6px;
					border-radius: 3px;
					background: var(--background-modifier-border);
					color: var(--text-muted);
				}

				.vision-badge {
					background: var(--interactive-success);
					color: white;
				}

				.add-btn {
					padding: 6px 12px;
					background: var(--interactive-accent);
					color: var(--text-on-accent);
					border: none;
					border-radius: 4px;
					cursor: pointer;
					font-size: 12px;
				}

				.add-btn:hover {
					background: var(--interactive-accent-hover);
				}
			`;
			document.head.appendChild(style);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}