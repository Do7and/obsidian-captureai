export default {
  // Settings tab translations
  "settings.title": "Image Capture Settings",
  "settings.general": "General",
  "settings.screenshotFunction": "Screenshot Function",
  "settings.defaultSaveLocation.name": "Default save location",
  "settings.defaultSaveLocation.desc": "Directory where captured images will be saved. Leave empty to use vault root.",
  "settings.useRelativePath.name": "Use relative paths",
  "settings.useRelativePath.desc": "Use relative paths for images in markdown files. When disabled, uses absolute paths.",
  "settings.enableDebugLogging.name": "Enable Debug Logging",
  "settings.enableDebugLogging.desc": "Enable debug logging to console for troubleshooting. Recommended to disable.",
  "settings.showSendOnlyButton.name": "Show Send-Only Button",
  "settings.showSendOnlyButton.desc": "Show a button next to the send button that adds messages to chat without sending to AI",
  "settings.showNormalCaptureButton.name": "Show Normal Capture Button",
  "settings.showNormalCaptureButton.desc": "Show normal screenshot capture button in ribbon",
  "settings.enableMinimizedCapture.name": "Enable Minimized Capture",
  "settings.enableMinimizedCapture.desc": "⚠ Limited by API, performance may be inconsistent",
  "settings.showMinimizedCaptureButton.name": "Show Minimized Capture Button",
  "settings.showMinimizedCaptureButton.desc": "Show minimized window capture button in ribbon",
  "settings.showAIChatPanelButton.name": "Show AI Chat Panel Button", 
  "settings.showAIChatPanelButton.desc": "Show AI chat panel button in ribbon",
  "settings.imageFormat.name": "Image format",
  "settings.imageFormat.desc": "Choose the format for saved images",
  "settings.language.name": "Language",
  "settings.language.desc": "Select the language for the plugin interface. Changes take effect after restarting Obsidian.",
  "settings.removeAreaSelect.name": "Remove area selection",
  "settings.removeAreaSelect.desc": "Remove area selection after capture",
  "settings.jpegQuality.name": "JPEG Quality",
  "settings.jpegQuality.desc": "Quality setting for JPEG images (1-100)",
  "settings.imagePreprocessing.name": "Image preprocessing",
  "settings.imagePreprocessing.desc": "Enable image compression and resizing",
  "settings.maxImageWidth.name": "Max image width",
  "settings.maxImageWidth.desc": "Maximum width for captured images (0 for no limit)",
  
  // AI Settings
  "settings.aiFunction": "AI Chat Function",
  "settings.enableAI.name": "Enable AI",
  "settings.enableAI.desc": "Enable AI for image analysis",
  "settings.aiApiConfig": "AI API Configuration",
  "settings.apiKey.name": "API Key",
  "settings.apiKey.desc": "API key for selected provider",
  "settings.setModel.name": "Set Model",
  "settings.setModel.desc": "Set AI model for image analysis",
  "settings.defaultModel.name": "Default Model",
  "settings.defaultModel.desc": "Default AI model for AI interactions",
  "settings.defaultModel.visionCapable": "Vision",
  "settings.defaultModel.textOnly": "Text Only",
  "settings.imageSaveLocation.name": "Image save location",
  "settings.imageSaveLocation.desc": "Directory where images from other sources will be saved",
  "settings.conversationHistory": "Conversation History Settings",
  "settings.autoSave.name": "Auto-save conversations",
  "settings.autoSave.desc": "Automatically save AI chat conversations",
  "settings.autoSaveLocation.name": "Auto-save location",
  "settings.autoSaveLocation.desc": "Directory where chat conversations will be saved",
  "settings.maxHistory.name": "Max history count",
  "settings.maxHistory.desc": "Maximum number of conversations to keep (default: 5)",
  "settings.promptSettings": "Prompt Settings",
  "settings.globalPrompt.name": "Global system prompt",
  "settings.globalPrompt.desc": "Global system prompt for AI analysis",
  // AI Chat Mode Prompts
  "settings.aiChatModePrompts": "AI Chat Mode Prompts",
  "settings.defaultAIChatMode.name": "Default AI Chat Mode",
  "settings.defaultAIChatMode.desc": "The default mode when opening AI Chat panel",
  "settings.analyzePrompt.name": "Analyze mode prompt",
  "settings.analyzePrompt.desc": "Prompt used when analyzing images in detail",
  "settings.ocrPrompt.name": "OCR mode prompt", 
  "settings.ocrPrompt.desc": "Prompt used when extracting text from images",
  "settings.chatPrompt.name": "Chat mode prompt",
  "settings.chatPrompt.desc": "Prompt used when chat with AI without images",
  "settings.customPrompt.name": "Custom mode prompt",
  "settings.customPrompt.desc": "Prompt used for custom instructions from the user",
  
  // Placeholders
  "settings.defaultSaveLocation.placeholder": "Enter folder path (e.g., captureai-folder/savedscreenshots)",
  "settings.imageSaveLocation.placeholder": "Enter folder path (e.g., captureai-folder/othersourceimage)",
  "settings.autoSaveLocation.placeholder": "Enter folder path (e.g., captureai-folder/autosavedconversations)",
  "settings.globalPrompt.placeholder": "You are a helpful AI assistant...",
  "settings.screenshotPrompt.placeholder": "Please analyze this screenshot and provide detailed insights...",

  // Context Settings
  "settings.contextSettings": "Context Settings",
  "settings.maxContextMessages.name": "Max Context Message Blocks",
  "settings.maxContextMessages.desc": "Maximum number of historical message blocks to include in AI conversations (each block counts as 1 regardless of image count)",

  // AI Chat Panel
  "settings.aiChatPanel.desc": "Open the AI chat panel to interact with your configured models",
  
  // API Keys
  "settings.apiKeys.name": "API Keys",
  "settings.apiKeys.desc": "Configure API keys for different AI providers",
  "settings.setKeys.button": "Set Keys",
  
  // Model configurations
  "settings.modelConfigs.name": "Model Configurations",
  "settings.modelConfigs.desc": "Manage your AI models ({{count}} configured)",
  "settings.manageModels.button": "Manage Models",
  
  // Add Custom Provider
  "settings.addCustomProvider.name": "Add Custom Provider",
  "settings.addCustomProvider.desc": "Add a new custom AI provider with independent configuration",
  "settings.addCustomProvider.button": "Add Custom Provider",
  
  // Warnings and guides
  "settings.noVisionModels.warning": "⚠️ No vision-capable models configured. Use \"Set Keys\" to add models that support image analysis.",
  "settings.getStarted.guide": "💡 Get started by clicking \"Set Keys\" to configure your AI providers and add models.",
  
  // Section names
  "settings.usage.name": "Usage",
  "settings.troubleshooting.name": "Troubleshooting",
  
  // Help content
  "settings.shortcuts.help": `
    <p>Available keyboard shortcuts:</p>
    <ul>
      <li><kbd>Escape</kbd> - Cancel region selection</li>
      <li><kbd>Ctrl/Cmd + Z</kbd> - Undo last edit</li>
      <li><kbd>Ctrl/Cmd + Y</kbd> - Redo last edit</li>
    </ul>
  `,
  "settings.usage.help": `
    <p>How to use the screenshot capture plugin:</p>
    <ol>
      <li>Click the camera icon in the ribbon or use the command palette</li>
      <li>Select "Capture selected area" or "Capture full screen"</li>
      <li>For region capture: drag to select the area you want to capture</li>
      <li>Use the editing tools to annotate your screenshot</li>
      <li>Click "Save" to save the image or "Send to AI" for analysis</li>
    </ol>
    <p><strong>Note:</strong> This plugin requires Obsidian to be running on a desktop platform with Electron support.</p>
  `,
  "settings.troubleshooting.help": `
    <p>If screenshots are not working:</p>
    <ul>
      <li>Make sure you're running Obsidian on desktop (not mobile)</li>
      <li>Try restarting Obsidian</li>
      <li>Check that you have proper screen recording permissions on macOS</li>
      <li>Use the "Test desktopCapturer API" command to diagnose issues</li>
    </ul>
    <p>If AI analysis is not working:</p>
    <ul>
      <li>Check that your API keys are correctly configured using "Set Keys"</li>
      <li>Ensure you have at least one vision-capable model configured</li>
      <li>Verify your internet connection</li>
      <li>Check the Console (Ctrl+Shift+I) for error messages</li>
    </ul>
  `,
  
  // Other settings
  "settings.autoAnalysis.name": "Auto analysis",
  "settings.autoAnalysis.desc": "Automatically send screenshots for AI analysis",
  "settings.historyLimit.name": "History limit",
  "settings.historyLimit.desc": "Number of AI conversations to keep (default: 5)",
  "settings.notification.name": "Notification settings",
  "settings.notification.desc": "Control notification display and duration",
  "settings.shortcuts.name": "Shortcuts",
  "settings.shortcuts.desc": "Customize screenshot shortcuts",
  "settings.aiBehavior.name": "AI behavior",
  "settings.aiBehavior.desc": "Default AI behavior and custom questions",
  "settings.imageUpload.name": "Image upload and save",
  "settings.imageUpload.desc": "Control how images are uploaded and saved",
  
  // Commands
  "commands.captureNormal.name": "Capture selected area",
  "commands.captureMinimized.name": "Minimized window capture",
  "commands.toggleAiChat.name": "Toggle AI Chat Panel",

  
  // Notices
  "notice.screenshotSaved": "Screenshot saved to: {{filePath}}",
  "notice.aiAnalysisComplete": "AI analysis complete",
  "notice.clipboardImageProcessed": "Clipboard image processed and saved",
  "notice.aiChatOpened": "✅ AI Chat panel opened",
  "notice.aiChatFailed": "❌ Failed to open AI Chat",
  
  // UI elements
  "ui.save": "Save",
  "ui.cancel": "Cancel",
  "ui.close": "Close",
  "ui.delete": "Delete",
  "ui.edit": "Edit",
  "ui.done": "Done",
  "ui.add": "Add",
  "ui.remove": "Remove",
  "ui.captureAI": "CaptureAI",
  "ui.minimizedCapture": "Minimized window capture",
  "ui.aiChatPanel": "AI Chat Panel",
  "ui.sendOnlyButton": "Send message only (no AI response)",
  
  // Chat History Modal
  "ui.chatHistory": "Chat History",
  "ui.autoSavedConversations": "Auto-saved Conversations",
  "ui.loadConversation": "Load Conversation",
  "ui.deleteConversation": "Delete Conversation",
  "ui.noConversationsFound": "No conversations found",
  
  // Manage Models Modal
  "ui.manageModels": "Manage Models",
  "ui.addModel": "Add Model",
  "ui.editModel": "Edit Model",
  "ui.deleteModel": "Delete Model",
  "ui.noModelsConfigured": "No Models Configured",
  "ui.useSetKeysToAdd": "Use \"Set Keys\" to add API keys and configure models.",
  
  // Set Keys Modal
  "ui.setApiKeys": "Set API Keys",
  "ui.saveKeys": "Save Keys",
  
  // Troubleshooting
  "settings.troubleshooting": "Troubleshooting",

  // Screenshot Manager messages
  "notice.regionCaptureStarting": "Starting region capture...",
  "notice.regionSelectionCancelled": "Region selection cancelled",
  "notice.screenCaptureFailed": "Failed to capture screen",
  "notice.regionCaptureFailed": "Region capture failed: {{message}}",
  "notice.fullScreenCapturing": "Capturing full screen...",
  "notice.fullScreenCaptureFailed": "Full screen capture failed: {{message}}",
  "notice.screenCapturingOverlayInstruction": "🖱️ Drag to select screenshot area  Press ESC to cancel",
  "notice.electronAPINotAvailable": "Electron API not available - make sure you are running on desktop",
  "notice.electronRemoteNotAvailable": "Electron remote not available - try restarting Obsidian",
  "notice.desktopCapturerNotAvailable": "desktopCapturer not available",
  "notice.screenRecordingPermissionDenied": "Screen recording permission denied. Please grant screen recording permission to Obsidian in System Preferences.",
  "notice.windowControlNotAvailable": "Window control not available - please ensure you are running on desktop",
  "notice.minimizedCaptureFailed": "Minimized window capture failed: {{message}}",
  "notice.screenPermissionCheckFailed": "Screen recording permission check failed. Please check system permissions.",
  "notice.noScreenSourcesFound": "No screen sources found - check screen recording permissions",
  "notice.noThumbnailAvailable": "No thumbnail available",
  "notice.thumbnailEmpty": "Thumbnail is empty - check screen recording permissions in System Preferences",
  "notice.screenCaptureApiError": "Screen capture API not available. Please restart Obsidian.",
  "notice.screenCaptureGenericError": "Screen capture error: {{message}}",
  "notice.allCaptureAttemptsFailed": "Failed to capture screen with any resolution - check system permissions",
  "notice.testingAdvancedCapture": "Testing advanced capture methods...",
  "notice.advancedCaptureTestCompleted": "Advanced capture test completed",
  "notice.advancedTestError": "Error in advanced test: {{message}}",
  "notice.screenshotCapturedSuccessfully": "Screenshot captured successfully!",
  "notice.screenshotSavedToFile": "Screenshot saved to: {{fileName}}",
  "notice.failedToSaveScreenshot": "Failed to save screenshot: {{message}}",
  "notice.foundScreenSources": "Found {{count}} screen sources",
  "notice.primarySource": "Primary source: {{name}}",
  "notice.remoteDesktopCapturerAccessible": "Remote desktopCapturer accessible, testing capture...",
  "notice.desktopCapturerNotAvailableRemote": "desktopCapturer not available through remote",
  "notice.errorAccessingRemoteDesktopCapturer": "Error accessing remote desktopCapturer: {{message}}",

  // Image Editor messages
  "imageEditor.title": "Image Editor",
  "imageEditor.saveButton": "Copy(Save)",
  "imageEditor.aiButton": "Send to AI(Save)",
  "imageEditor.cancelButton": "Cancel",
  "imageEditor.undoButton": "Undo",
  "imageEditor.redoButton": "Redo",
  "imageEditor.penTool": "Pen",
  "imageEditor.lineTool": "Line",
  "imageEditor.arrowTool": "Arrow",
  "imageEditor.rectangleTool": "Rectangle",
  "imageEditor.circleTool": "Circle",
  "imageEditor.highlighterTool": "Highlighter",
  "imageEditor.eraserTool": "Eraser",
  "imageEditor.handTool": "Hand (Move)",
  "imageEditor.cropTool": "Crop",
  "imageEditor.textTool": "Text",
  "imageEditor.wavyLineTool": "Wavy Line",
  "imageEditor.dashedLineTool": "Dashed Line",
  "imageEditor.dottedLineTool": "Dotted Line",
  "imageEditor.strokeSize.small": "Small",
  "imageEditor.strokeSize.medium": "Medium",
  "imageEditor.strokeSize.large": "Large",
  "imageEditor.savingAndAddingToQueue": "Saving image and adding to the queue ready for sending...",
  "imageEditor.savingAndSendingToAI": "Saving and sending image to AI...",
  "imageEditor.imageAddedToQueue": "✅ Image added to queue, you can add more images",
  "imageEditor.imageSentToAI": "✅ Image sent to AI, check the right panel",
  "imageEditor.saveError": "Failed to save image: {{message}}",
  "imageEditor.aiSendError": "Failed to send to AI: {{message}}",
  "imageEditor.copyFailed": "❌ Copy failed: {{message}}",
  "imageEditor.addToQueueFailed": "❌ Failed to add to AI queue: {{message}}",
  "imageEditor.operationFailed": "❌ Operation failed: {{message}}",
  "imageEditor.aiAnalysisFailed": "❌ AI analysis failed: {{message}}",
  "imageEditor.noVisionModelsTooltip": "No vision-capable models configured. Use Settings > Set Keys to add models.",
  "imageEditor.tempSendToAI": "Send to AI (No Save)",
  "imageEditor.tempCopy": "Copy (No Save)",
  "imageEditor.fileNameLabel": "File Name for Saving:",
  "imageEditor.fileNamePlaceholder": "Enter filename...",
  "imageEditor.tempSendToAITooltip": "Send image to AI chat without saving to vault",
  "imageEditor.tempCopyTooltip": "Copy image to clipboard without saving to vault",
  "imageEditor.credentialsNotVerifiedTooltip": "API credentials not verified. Use Settings > Set Keys to verify.",
  "imageEditor.undoTooltip": "Undo",
  "imageEditor.redoTooltip": "Redo", 
  "imageEditor.clearCanvasTooltip": "Clear Canvas",
  "imageEditor.fileNameConflictWarning": "File name already exists, will be overwritten when saved",
  "imageEditor.fileNameConflictTooltip": "This file name already exists in the target directory",
  "imageEditor.fileNameInvalidWarning": "File name contains invalid characters or format",
  "imageEditor.fileNameInvalidTooltip": "File name cannot contain: \\ / : * ? \" < > |",
  
  // Set Keys Modal
  "setKeys.title": "AI Provider Settings",
  "setKeys.description": "Configure your AI providers by adding their API keys.",
  "setKeys.getApiKey": "Get API Key",
  "setKeys.apiKeyLabel": "API Key",
  "setKeys.apiKeyDescription": "Enter your API key for this provider",
  "setKeys.apiKeyPlaceholder": "Enter API key...",
  "setKeys.verifyButton": "Verify",
  "setKeys.verifyingButton": "Verifying...",
  "setKeys.verifiedButton": "Verified",
  "setKeys.retryButton": "Retry",
  "setKeys.baseUrlLabel": "Base URL",
  "setKeys.baseUrlDescription": "Enter the base URL for your custom API endpoint",
  "setKeys.baseUrlPlaceholder": "https://api.example.com/v1",
  "setKeys.apiPathLabel": "API Path",
  "setKeys.apiPathDescription": "Enter the API path (default: /v1/chat/completions)",
  "setKeys.apiPathPlaceholder": "/v1/chat/completions",
  "setKeys.customNameLabel": "Provider Name",
  "setKeys.customNameDescription": "Enter a custom name for this provider (e.g., 'My Company API')",
  "setKeys.customNamePlaceholder": "My Custom Provider",
  "setKeys.addModelLabel": "Add Model",
  "setKeys.addModelDescription": "Select and add available models",
  "setKeys.addCustomModelDescription": "Enter model name",
  "setKeys.addModelButton": "Add Model",
  "setKeys.selectModelPlaceholder": "Select a model...",
  "setKeys.customModelPlaceholder": "Enter model name (e.g., gpt-4-vision-preview)",
  "setKeys.verifyApiKeyFirst": "Verify API key first",
  "setKeys.enterApiKeyFirst": "Please enter an API key first",
  "setKeys.apiKeyVerified": "✅ {{providerName}} API key verified successfully",
  "setKeys.apiKeyVerificationFailed": "❌ {{providerName}} API key verification failed",
  "setKeys.verificationError": "❌ {{providerName}} verification error: {{message}}",
  "setKeys.noModelsAvailable": "No models available for this provider",
  "setKeys.modelAddedSuccessfully": "✅ Added {{modelName}} to your model configurations",
  "setKeys.modelSelectionTitle": "Add Model from {{providerName}}",
  "setKeys.modelSelectionDescription": "Select a model to add to your configuration:",
  "setKeys.visionCapableLabel": "Vision Capable",
  "setKeys.visionCapableDescription": "Check if this model supports image analysis",
  "setKeys.visionBadge": "Vision",
  "setKeys.contextBadge": "{{count}} tokens",

  // Add Custom Provider Modal
  "addCustomProvider.title": "Add Custom AI Provider",
  "addCustomProvider.description": "Add a new custom AI provider with your own API configuration.",
  "addCustomProvider.providerNameLabel": "Provider Name",
  "addCustomProvider.providerNameDescription": "Enter a name for this provider (e.g., 'My Company API')",
  "addCustomProvider.providerNamePlaceholder": "My Company API",
  "addCustomProvider.baseUrlLabel": "Base URL",
  "addCustomProvider.baseUrlDescription": "Enter the base URL for the API endpoint",
  "addCustomProvider.baseUrlPlaceholder": "https://api.302.ai",
  "addCustomProvider.apiPathLabel": "API Path",
  "addCustomProvider.apiPathDescription": "Enter the API path (default: /v1/chat/completions)",
  "addCustomProvider.apiPathPlaceholder": "/v1/chat/completions",
  "addCustomProvider.apiKeyLabel": "API Key",
  "addCustomProvider.apiKeyDescription": "Enter the API key for this provider",
  "addCustomProvider.apiKeyPlaceholder": "Enter API key...",
  "addCustomProvider.modelIdLabel": "Model ID",
  "addCustomProvider.modelIdDescription": "Enter the model ID (e.g., 'gpt-4o', 'claude-3-5-sonnet')",
  "addCustomProvider.modelIdPlaceholder": "gpt-4o",
  "addCustomProvider.modelNameLabel": "Model Display Name",
  "addCustomProvider.modelNameDescription": "Enter a display name for this model",
  "addCustomProvider.modelNamePlaceholder": "GPT-4o",
  "addCustomProvider.visionCapableLabel": "Vision Capable",
  "addCustomProvider.visionCapableDescription": "Check if this model supports image analysis",
  "addCustomProvider.testButton": "Test Connection",
  "addCustomProvider.testingButton": "Testing...",
  "addCustomProvider.addButton": "Add Provider",
  "addCustomProvider.testSuccess": "✅ Connection test successful!",
  "addCustomProvider.testFailed": "❌ Connection test failed: {{error}}",
  "addCustomProvider.addSuccess": "✅ Added {{providerName}} - {{modelName}} successfully!",
  "addCustomProvider.providerNameRequired": "Provider name is required",
  "addCustomProvider.baseUrlRequired": "Base URL is required",
  "addCustomProvider.apiKeyRequired": "API key is required",
  "addCustomProvider.modelIdRequired": "Model ID is required",

  // Manage Models Modal
  "manageModels.description": "Configure and manage your AI model configurations.",
  "manageModels.setDefaultButton": "Set Default",
  "manageModels.configureButton": "⚙️",
  "manageModels.deleteButton": "🗑️",
  "manageModels.deleteButtonTitle": "Delete this model configuration",
  "manageModels.configureButtonTitle": "Configure model settings",
  "manageModels.providerBadge": "{{providerName}}",
  "manageModels.defaultBadge": "Default",
  "manageModels.setAsDefaultSuccess": "✅ Set {{modelName}} as default model",
  "manageModels.deletedSuccessfully": "✅ Deleted {{modelName}}",
  "manageModels.maxTokensLabel": "Max Tokens",
  "manageModels.maxTokensDescription": "Maximum number of tokens for responses",
  "manageModels.maxTokensPlaceholder": "4000",
  "manageModels.temperatureLabel": "Temperature",
  "manageModels.temperatureDescription": "Controls randomness (0.0 = deterministic, 1.0 = very creative)",
  "manageModels.topPLabel": "Top P",
  "manageModels.topPDescription": "Nucleus sampling parameter",
  "manageModels.frequencyPenaltyLabel": "Frequency Penalty",
  "manageModels.frequencyPenaltyDescription": "Reduces repetition of tokens",
  "manageModels.presencePenaltyLabel": "Presence Penalty",
  "manageModels.presencePenaltyDescription": "Reduces repetition of topics",
  "manageModels.maxResponseTimeLabel": "Max Response Time",
  "manageModels.maxResponseTimeDescription": "Maximum time to wait for response (seconds)",
  "manageModels.maxResponseTimePlaceholder": "30",
  "manageModels.systemPromptLabel": "System Prompt",
  "manageModels.systemPromptDescription": "Custom system prompt for this model (optional)",
  "manageModels.systemPromptPlaceholder": "Enter custom system prompt...",
  "manageModels.resetToDefaultsButton": "Reset to Defaults",
  "manageModels.settingsResetSuccess": "✅ Settings reset to defaults",
  "manageModels.confirmDeleteTitle": "Delete Model Configuration",
  "manageModels.confirmDeleteMessage": "Are you sure you want to delete \"{{modelName}}\"? This action cannot be undone.",
  "manageModels.confirmDeleteCancel": "Cancel",
  "manageModels.confirmDeleteConfirm": "Delete",

  // Chat History Modal
  "chatHistory.manualSavedTitle": "Manually Saved Conversations",
  "chatHistory.closeButton": "Close",
  "chatHistory.noAutoSavedFound": "No auto-saved conversations found",
  "chatHistory.noManualSavedFound": "No manually saved conversations found",
  "chatHistory.errorLoading": "Error loading conversations: {{message}}",
  "chatHistory.autoSavedBadge": "Auto-saved",
  "chatHistory.manualBadge": "Manual",
  "chatHistory.conversationLoaded": "✅ Loaded conversation: {{title}}",
  "chatHistory.failedToParse": "❌ Failed to parse conversation",
  "chatHistory.failedToLoad": "❌ Failed to load conversation: {{message}}",

  // AI Chat View
  "aiChat.title": "CaptureAI",
  "aiChat.assistantTitle": "AI Assistant",
  "aiChat.howToUseTitle": "How to Use",
  "aiChat.instruction.screenshot": "Take a screenshot and it will be automatically analyzed",
  "aiChat.instruction.dragDrop": "Drag and drop images into the chat area",
  "aiChat.instruction.typeQuestions": "Type your questions and press Enter to send",
  "aiChat.instruction.configureKeys": "Configure API keys in Settings if you want to use AI",
  "aiChat.noModelsConfigured": "⚠️ No AI models configured",
  "aiChat.noModelsDescription": "Go to Settings → Set Keys to configure AI providers",
  "aiChat.readyWithModel": "✅ Ready with {{modelName}}",
  "aiChat.readyWithModelTextOnly": "⚪ Ready with {{modelName}} (Text Only)",
  "aiChat.textOnlyModelNotice": "This model doesn't support image analysis, but normal text chat is available",
  "aiChat.modelsConfigured": "{{count}} vision model{{plural}} configured",
  "aiChat.allModelsConfigured": "{{total}} model{{totalPlural}} configured, {{vision}} with vision",
  "aiChat.sendButton": "Send",
  "aiChat.typePlaceholder": "Type your message...",
  "aiChat.dragImageHere": "Drag images here or",
  "aiChat.selectImages": "select images",
  "aiChat.newConversationButton": "New Chat",
  "aiChat.loadHistoryButton": "Load History",
  "aiChat.saveConversationButton": "Save Chat",
  "aiChat.clearImagesButton": "Clear Images",
  "aiChat.removeImageButton": "Remove",
  "aiChat.insertToCursorButton": "Insert at cursor",
  "aiChat.copyMessageButton": "Copy message",
  "aiChat.switchEditViewButton": "Switch edit/read view",
  "aiChat.deleteMessageButton": "Delete message",
  "aiChat.includeInContextTooltip": "Include in AI context",
  "aiChat.user": "User",
  "aiChat.aiAssistant": "AI Assistant",
  "aiChat.textChatTitle": "Text Chat",
  "aiChat.screenshotAnalysisTitle": "Screenshot Analysis",
  "aiChat.sendingMessage": "Sending message...",
  "aiChat.aiThinking": "AI is thinking...",
  "aiChat.conversationSaved": "✅ Conversation saved as: {{fileName}}",
  "aiChat.failedToSave": "❌ Failed to save conversation: {{message}}",
  "aiChat.imagesCleared": "✅ Images cleared",
  "aiChat.noActiveConversation": "No active conversation to save",
  "aiChat.errorSendingMessage": "❌ Error sending message: {{message}}",
  "aiChat.menuButton": "Menu",
  "aiChat.browseFiles": "browse files",
  "aiChat.inputPlaceholder": "What do you want to know, or try a picture?",
  "aiChat.textCopied": "Text copied to clipboard",
  "aiChat.imageCopied": "Image copied to clipboard",
  "aiChat.selectionCopied": "Selection copied as Markdown",
  "aiChat.copyFailed": "Failed to copy message",
  "aiChat.copyImageFailed": "Failed to copy image",
  "aiChat.copySelectionFailed": "Failed to copy selection",
  "aiChat.imagesReadyToSend": "{{count}} image{{plural}} ready to send",
  "aiChat.clearAllImages": "Clear All",
  "aiChat.removeThisImage": "Remove this image",
  "aiChat.sendMessageTooltip": "Send message (Enter)",
  "aiChat.nonVisionModelWarning": "Current non-vision model cannot send images",
  "aiChat.nonVisionModelCannotSendImages": "Current non-vision model cannot process images. Please enter a text message or switch to a vision-capable model.",
  "aiChat.nonVisionModelNotice": "Current model does not support vision. Please enter a text message or switch to a vision-capable model.",

  // AI Chat Modes
  "aiChat.modes.analyze": "Analyze Image",
  "aiChat.modes.ocr": "Extract Text (OCR)",
  "aiChat.modes.chat": "Chat without Images",
  "aiChat.modes.custom": "Use Custom Prompt",

  // Main plugin messages
  "plugin.aiChatPanelToggleFailed": "❌ Failed to toggle AI chat panel: {{message}}",
  "plugin.aiManagerNotInitialized": "AI Manager not initialized",
  "plugin.aiChatPanelNotFound": "AI Chat panel not found or does not support image queue",
  "plugin.failedToCreateAiChatPanel": "Failed to create AI chat panel: {{message}}",

  // Settings tab - hardcoded content that needs i18n
  "settings.usage.helpContent": `
    <p>How to use the CaptureAI plugin:</p>
    <ol>
      <li>Click the camera icon in the ribbon or use the command palette</li>
      <li>Select "Capture selected area" or "Capture full screen"</li>
      <li>For region capture: drag to select the area you want to capture</li>
      <li>Use the editing tools to annotate your screenshot</li>
      <li>Click "Save" to save the image or "Send to AI" for analysis</li>
    </ol>
    <p><strong>Note:</strong> This plugin requires Obsidian to be running on a desktop platform with Electron support.</p>
  `,
  "settings.troubleshooting.helpContent": `
    <p>If screenshots are not working:</p>
    <ul>
      <li>Make sure you're running Obsidian on desktop (not mobile)</li>
      <li>Try restarting Obsidian</li>
      <li>Check that you have proper screen recording permissions on macOS</li>
      <li>Use the "Test desktopCapturer API" command to diagnose issues</li>
    </ul>
    <p>If AI analysis is not working:</p>
    <ul>
      <li>Check that your API keys are correctly configured using "Set Keys"</li>
      <li>Ensure you have at least one vision-capable model configured</li>
      <li>Verify your internet connection</li>
      <li>Check the Console (Ctrl+Shift+I) for error messages</li>
    </ul>
  `,

  // Missing Notice translations
  "notice.imageAndTextCopied": "Image and text copied to clipboard",
  "notice.textCopiedImageFailed": "Text copied to clipboard (image copy failed)",
  "notice.failedToCopyMessage": "Failed to copy message",
  "notice.pleaseConfigureModel": "Please configure at least one AI model in Settings > Set Keys",
  "notice.pleaseDropImageFilesOnly": "Please drop image files only",
  "notice.noConversationToSave": "❌ No conversation to save",
  "notice.openInMarkdownNote": "Please open cursor position in a markdown note to use this function",
  "notice.contentInsertedAtCursor": "Content inserted at cursor",
  "notice.failedToInsertContent": "Failed to insert content",
  "notice.noActiveConversation": "No active conversation",
  "notice.messageNotFound": "Message not found",
  "notice.messageDeleted": "Message deleted",
  "notice.failedToDeleteMessage": "Failed to delete message",
  "notice.enterApiKeyFirst": "Please enter an API key first",
  "notice.imageCopiedToClipboard": "✅ Image copied to clipboard",
  "notice.copyFailedUseSave": "❌ Copy failed, please use save function",
  "notice.failedToParseConversation": "❌ Failed to parse conversation",
  "notice.tempImageLimitWarning": "📸 Current conversation has {{count}} temporary images, recommend saving conversation to avoid high memory usage",
  "notice.reloadPluginRequired": "⚙️ UI changes require plugin reload to take effect",

  // Missing placeholder translations
  "placeholder.editMessageContent": "Edit message content...",
};