export default {
  // Settings tab translations
  "settings.title": "图像捕获设置",
  "settings.general": "通用",
  "settings.screenshotFunction": "截图功能",
  "settings.defaultSaveLocation.name": "默认保存位置",
  "settings.defaultSaveLocation.desc": "捕获图像将保存到的目录。留空以使用库根目录。",
  "settings.useRelativePath.name": "使用相对路径",
  "settings.useRelativePath.desc": "在 Markdown 文件中使用图像的相对路径。禁用时使用绝对路径。",
  "settings.enableDebugLogging.name": "启用调试日志",
  "settings.enableDebugLogging.desc": "启用控制台调试日志用于故障排除。建议禁用。",
  "settings.showSendOnlyButton.name": "显示仅发送按钮",
  "settings.showSendOnlyButton.desc": "在发送按钮旁显示一个仅发送到聊天的按钮，不会发给AI处理",
  "settings.showNormalCaptureButton.name": "显示普通截图按钮",
  "settings.showNormalCaptureButton.desc": "在工具栏中显示普通截图按钮",
  "settings.enableMinimizedCapture.name": "启用最小化截图功能",
  "settings.enableMinimizedCapture.desc": "⚠ 受限于 API，使用体验可能不够流畅",
  "settings.showMinimizedCaptureButton.name": "显示最小化截图按钮",
  "settings.showMinimizedCaptureButton.desc": "在工具栏中显示最小化截图按钮",
  "settings.showAIChatPanelButton.name": "显示AI聊天面板按钮",
  "settings.showAIChatPanelButton.desc": "在工具栏中显示AI聊天面板按钮",
  "settings.imageFormat.name": "图像格式",
  "settings.imageFormat.desc": "选择保存图像的格式",
  "settings.language.name": "语言",
  "settings.language.desc": "选择插件界面的语言。更改将在重启Obsidian后生效。",
  "settings.removeAreaSelect.name": "移除区域选择",
  "settings.removeAreaSelect.desc": "捕获后移除区域选择",
  "settings.jpegQuality.name": "JPEG 质量",
  "settings.jpegQuality.desc": "JPEG 图像的质量设置 (1-100)",
  "settings.imagePreprocessing.name": "图像预处理",
  "settings.imagePreprocessing.desc": "启用图像压缩和调整大小",
  "settings.maxImageWidth.name": "最大图像宽度",
  "settings.maxImageWidth.desc": "捕获图像的最大宽度 (0 表示无限制)",
  
  // AI Settings
  "settings.aiFunction": "AI 会话功能",
  "settings.enableAI.name": "启用 AI",
  "settings.enableAI.desc": "启用发送图像给 AI 的功能",
  "settings.aiApiConfig": "AI API 配置",
  "settings.apiKey.name": "API 密钥",
  "settings.apiKey.desc": "所选提供商的 API 密钥",
  "settings.setModel.name": "设置模型",
  "settings.setModel.desc": "设置用于图像分析的 AI 模型",
  "settings.defaultModel.name": "默认模型",
  "settings.defaultModel.desc": "用于AI交互的默认AI模型",
  "settings.defaultModel.visionCapable": "视觉",
  "settings.defaultModel.textOnly": "仅文本",
  "settings.imageSaveLocation.name": "图像保存位置",
  "settings.imageSaveLocation.desc": "从其他来源保存图像的目录",
  "settings.conversationHistory": "会话历史设置",
  "settings.autoSave.name": "自动保存会话",
  "settings.autoSave.desc": "自动保存 AI 会话",
  "settings.autoSaveLocation.name": "自动保存位置",
  "settings.autoSaveLocation.desc": "AI会话将保存到的目录",
  "settings.maxHistory.name": "自动保存的会话最大数量",
  "settings.maxHistory.desc": "要保留的会话最大数量",
  "settings.promptSettings": "提示词设置",
  "settings.globalPrompt.name": "全局系统提示词",
  "settings.globalPrompt.desc": "AI 会话的全局系统提示词",
  // AI Chat Mode Prompts
  "settings.aiChatModePrompts": "AI会话模式提示词",
  "settings.defaultAIChatMode.name": "默认AI会话模式",
  "settings.defaultAIChatMode.desc": "打开AI会话面板时的默认模式",
  "settings.analyzePrompt.name": "图像分析模式提示词",
  "settings.analyzePrompt.desc": "详细分析图像时使用的提示词",
  "settings.ocrPrompt.name": "OCR模式提示词",
  "settings.ocrPrompt.desc": "从图像中提取文本时使用的提示词",
  "settings.chatPrompt.name": "会话模式提示词",
  "settings.chatPrompt.desc": "只与AI文字会话时使用的提示词",
  "settings.customPrompt.name": "自定义模式提示词",
  "settings.customPrompt.desc": "自定义模式下的提示词",
  
  // Placeholders
  "settings.defaultSaveLocation.placeholder": "输入文件夹路径 (例如: screenshots-capture/savedscreenshots)",
  "settings.imageSaveLocation.placeholder": "输入文件夹路径 (例如: screenshots-capture/othersourceimage)",
  "settings.autoSaveLocation.placeholder": "输入文件夹路径 (例如: screenshots-capture/autosavedconversations)",
  "settings.globalPrompt.placeholder": "你是一个有用的AI助手...",
  "settings.screenshotPrompt.placeholder": "请分析这个截图并提供详细的见解...",

  // Context Settings
  "settings.contextSettings": "上下文设置",
  "settings.maxContextMessages.name": "最大上下文消息块数",
  "settings.maxContextMessages.desc": "AI会话时包含的历史消息块最大数量（一个消息块无论包含多少张图片都计为1块）",
  "settings.includeSystemPrompt.name": "包含系统提示",
  "settings.includeSystemPrompt.desc": "是否在上下文中包含系统提示词",

  // AI Chat Panel
  "settings.aiChatPanel.desc": "打开AI会话面板与您配置的模型交互",
  
  // API Keys
  "settings.apiKeys.name": "API密钥",
  "settings.apiKeys.desc": "为不同的AI提供商配置API密钥",
  "settings.setKeys.button": "设置密钥",
  
  // Model configurations
  "settings.modelConfigs.name": "模型配置",
  "settings.modelConfigs.desc": "管理您的AI模型 (已配置{{count}}个)",
  "settings.manageModels.button": "管理模型",
  
  // Add Custom Provider
  "settings.addCustomProvider.name": "添加自定义提供商",
  "settings.addCustomProvider.desc": "添加一个新的自定义AI提供商，具有独立配置",
  "settings.addCustomProvider.button": "添加自定义提供商",
  
  // Warnings and guides
  "settings.noVisionModels.warning": "⚠️ 未配置支持视觉的模型。使用设置密钥添加支持图像分析的模型。",
  "settings.getStarted.guide": "💡 点击设置密钥开始配置您的AI提供商并添加模型。",
  
  // Section names
  "settings.usage.name": "使用方法",
  "settings.troubleshooting.name": "故障排除",
  
  // Help content
  "settings.shortcuts.help": `
    <p>可用的键盘快捷键:</p>
    <ul>
      <li><kbd>Escape</kbd> - 取消区域选择</li>
      <li><kbd>Ctrl/Cmd + Z</kbd> - 撤销上次编辑</li>
      <li><kbd>Ctrl/Cmd + Y</kbd> - 重做上次编辑</li>
    </ul>
  `,
  "settings.usage.help": `
    <p>如何使用截图插件:</p>
    <ol>
      <li>点击功能区中的相机图标或使用命令面板</li>
      <li>选择"捕获选定区域"或"捕获全屏"</li>
      <li>对于区域捕获：拖动选择要捕获的区域</li>
      <li>使用编辑工具注释您的截图</li>
      <li>点击"保存"保存图像或"发送到AI"进行分析</li>
    </ol>
    <p><strong>注意:</strong> 此插件需要Obsidian在支持Electron的桌面平台上运行。</p>
  `,
  "settings.troubleshooting.help": `
    <p>如果截图不工作:</p>
    <ul>
      <li>确保您在桌面版Obsidian上运行（非移动版）</li>
      <li>尝试重启Obsidian</li>
      <li>检查您在macOS上是否有适当的屏幕录制权限</li>
      <li>使用"测试桌面捕获API"命令诊断问题</li>
    </ul>
    <p>如果AI会话不工作:</p>
    <ul>
      <li>检查您的API密钥是否使用"设置密钥"正确配置</li>
      <li>确保您至少配置了一个支持视觉的模型</li>
      <li>验证您的网络连接</li>
      <li>检查控制台 (Ctrl+Shift+I) 查看错误消息</li>
    </ul>
  `,
  
  // Other settings
  "settings.autoAnalysis.name": "自动分析",
  "settings.autoAnalysis.desc": "自动发送截图进行 AI 分析",
  "settings.historyLimit.name": "历史记录限制",
  "settings.historyLimit.desc": "要保留的 AI 会话数量 (默认: 5)",
  "settings.notification.name": "通知设置",
  "settings.notification.desc": "控制通知显示和持续时间",
  "settings.shortcuts.name": "快捷键",
  "settings.shortcuts.desc": "自定义截图快捷方式",
  "settings.aiBehavior.name": "AI 行为",
  "settings.aiBehavior.desc": "默认 AI 行为和自定义问题",
  "settings.imageUpload.name": "图像上传和保存",
  "settings.imageUpload.desc": "控制图像如何上传和保存",
  
  // Commands
  "commands.captureNormal.name": "截图",
  "commands.captureMinimized.name": "最小化窗口截图",
  "commands.toggleAiChat.name": "切换到 AI 会话面板",

  
  // Notices
  "notice.screenshotSaved": "截图已保存到: {{filePath}}",
  "notice.aiAnalysisComplete": "AI 分析完成",
  "notice.clipboardImageProcessed": "剪贴板图像已处理并保存",
  "notice.aiChatOpened": "✅ AI会话面板已打开",
  "notice.aiChatFailed": "❌ 打开AI会话失败",
  
  // UI elements
  "ui.save": "保存",
  "ui.cancel": "取消",
  "ui.close": "关闭",
  "ui.delete": "删除",
  "ui.edit": "编辑",
  "ui.done": "完成",
  "ui.add": "添加",
  "ui.remove": "移除",
  "ui.captureAI": "截图捕获",
  "ui.minimizedCapture": "最小化窗口截图",
  "ui.aiChatPanel": "AI 会话面板",
  "ui.sendOnlyButton": "仅发送消息（不调用AI）",
  
  // Chat History Modal
  "ui.chatHistory": "会话历史",
  "ui.autoSavedConversations": "自动保存的会话",
  "ui.loadConversation": "加载会话",
  "ui.deleteConversation": "删除会话",
  "ui.noConversationsFound": "未找到会话",
  
  // Manage Models Modal
  "ui.manageModels": "管理模型",
  "ui.addModel": "添加模型",
  "ui.editModel": "编辑模型",
  "ui.deleteModel": "删除模型",
  "ui.noModelsConfigured": "未配置模型",
  "ui.useSetKeysToAdd": "使用\"设置密钥\"来添加API密钥并配置模型。",
  
  // Set Keys Modal
  "ui.setApiKeys": "设置 API 密钥",
  "ui.saveKeys": "保存密钥",
  
  // Troubleshooting
  "settings.troubleshooting": "故障排除",

  // Screenshot Manager messages
  "notice.regionCaptureStarting": "开始区域截图...",
  "notice.regionSelectionCancelled": "区域选择已取消",
  "notice.screenCaptureFailed": "截屏失败",
  "notice.regionCaptureFailed": "区域截图失败: {{message}}",
  "notice.fullScreenCapturing": "正在截取全屏...",
  "notice.fullScreenCaptureFailed": "全屏截图失败: {{message}}",
  "notice.screenCapturingOverlayInstruction": "🖱️ 拖拽选择截图区域  按 ESC 取消",
  "notice.electronAPINotAvailable": "Electron API 不可用 - 请确保在桌面端运行",
  "notice.electronRemoteNotAvailable": "Electron remote 不可用 - 请尝试重启 Obsidian",
  "notice.desktopCapturerNotAvailable": "desktopCapturer 不可用",
  "notice.screenRecordingPermissionDenied": "屏幕录制权限被拒绝。请在系统偏好设置中授予 Obsidian 屏幕录制权限。",
  "notice.windowControlNotAvailable": "窗口控制不可用 - 请确保您在桌面版上运行",
  "notice.minimizedCaptureFailed": "最小化窗口截图失败: {{message}}",
  "notice.screenPermissionCheckFailed": "屏幕录制权限检查失败。请检查系统权限。",
  "notice.noScreenSourcesFound": "未找到屏幕源 - 请检查屏幕录制权限",
  "notice.noThumbnailAvailable": "无缩略图可用",
  "notice.thumbnailEmpty": "缩略图为空 - 请在系统偏好设置中检查屏幕录制权限",
  "notice.screenCaptureApiError": "屏幕截取 API 不可用。请重启 Obsidian。",
  "notice.screenCaptureGenericError": "屏幕截取错误: {{message}}",
  "notice.allCaptureAttemptsFailed": "所有分辨率的屏幕截取都失败了 - 请检查系统权限",
  "notice.testingAdvancedCapture": "正在测试高级截取方法...",
  "notice.advancedCaptureTestCompleted": "高级截取测试完成",
  "notice.advancedTestError": "高级测试错误: {{message}}",
  "notice.screenshotCapturedSuccessfully": "截图成功!",
  "notice.screenshotSavedToFile": "截图已保存到: {{fileName}}",
  "notice.failedToSaveScreenshot": "保存截图失败: {{message}}",
  "notice.foundScreenSources": "找到 {{count}} 个屏幕源",
  "notice.primarySource": "主要源: {{name}}",
  "notice.remoteDesktopCapturerAccessible": "远程 desktopCapturer 可访问，正在测试截取...",
  "notice.desktopCapturerNotAvailableRemote": "远程无法访问 desktopCapturer",
  "notice.errorAccessingRemoteDesktopCapturer": "访问远程 desktopCapturer 错误: {{message}}",

  // Image Editor messages
  "imageEditor.title": "图像编辑器",
  "imageEditor.saveButton": "复制 (保存)",
  "imageEditor.aiButton": "发送给AI (保存)",
  "imageEditor.cancelButton": "取消",
  "imageEditor.undoButton": "撤销",
  "imageEditor.redoButton": "重做",
  "imageEditor.penTool": "画笔",
  "imageEditor.lineTool": "直线",
  "imageEditor.arrowTool": "箭头",
  "imageEditor.rectangleTool": "矩形",
  "imageEditor.circleTool": "圆形",
  "imageEditor.highlighterTool": "荧光笔",
  "imageEditor.eraserTool": "橡皮擦",
  "imageEditor.handTool": "移动工具",
  "imageEditor.cropTool": "裁剪",
  "imageEditor.textTool": "文本",
  "imageEditor.wavyLineTool": "波浪线",
  "imageEditor.dashedLineTool": "虚线",
  "imageEditor.dottedLineTool": "点线",
  "imageEditor.strokeSize.small": "小",
  "imageEditor.strokeSize.medium": "中",
  "imageEditor.strokeSize.large": "大",
  "imageEditor.savingAndAddingToQueue": "正在保存图片并添加到待发送区...",
  "imageEditor.savingAndSendingToAI": "正在保存并发送图片给AI分析...",
  "imageEditor.imageAddedToQueue": "✅ 图片已添加到AI发送队列，可继续添加更多图片",
  "imageEditor.imageSentToAI": "✅ 图片已发送给AI，请查看右侧面板",
  "imageEditor.saveError": "保存图片失败: {{message}}",
  "imageEditor.aiSendError": "发送到AI失败: {{message}}",
  "imageEditor.copyFailed": "❌ 复制失败: {{message}}",
  "imageEditor.addToQueueFailed": "❌ 添加到AI队列失败: {{message}}",
  "imageEditor.operationFailed": "❌ 操作失败: {{message}}",
  "imageEditor.aiAnalysisFailed": "❌ AI分析失败: {{message}}",
  "imageEditor.noVisionModelsTooltip": "未配置支持视觉的模型。请使用设置 > 设置密钥来添加模型。",
  "imageEditor.tempSendToAI": "发送给AI (不保存)",
  "imageEditor.tempCopy": "复制 (不保存)",
  "imageEditor.fileNameLabel": "保存时的文件名:",
  "imageEditor.fileNamePlaceholder": "输入文件名...",
  "imageEditor.tempSendToAITooltip": "将图片发送到AI聊天而不保存到仓库",
  "imageEditor.tempCopyTooltip": "将图片复制到剪贴板而不保存到仓库",
  "imageEditor.noDefaultModelTooltip": "未选择默认模型或模型不支持视觉功能",
  "imageEditor.credentialsNotVerifiedTooltip": "API凭据未验证。请使用设置 > 设置密钥来验证。",
  "imageEditor.undoTooltip": "撤销",
  "imageEditor.redoTooltip": "重做", 
  "imageEditor.clearCanvasTooltip": "清空画布",
  "imageEditor.fileNameConflictWarning": "文件名已存在，保存时将被覆盖",
  "imageEditor.fileNameConflictTooltip": "该文件名在目标目录中已存在",
  "imageEditor.fileNameInvalidWarning": "文件名包含非法字符或格式不正确",
  "imageEditor.fileNameInvalidTooltip": "文件名不能包含以下字符: \\ / : * ? \" < > |",

  // Set Keys Modal
  "setKeys.title": "AI 提供商设置",
  "setKeys.description": "通过添加 API 密钥来配置您的 AI 提供商。",
  "setKeys.getApiKey": "获取 API 密钥",
  "setKeys.apiKeyLabel": "API 密钥",
  "setKeys.apiKeyDescription": "输入此提供商的 API 密钥",
  "setKeys.apiKeyPlaceholder": "输入 API 密钥...",
  "setKeys.verifyButton": "验证",
  "setKeys.verifyingButton": "验证中...",
  "setKeys.verifiedButton": "已验证",
  "setKeys.retryButton": "重试",
  "setKeys.baseUrlLabel": "基础 URL",
  "setKeys.baseUrlDescription": "输入自定义 API 端点的基础 URL",
  "setKeys.baseUrlPlaceholder": "https://api.example.com/v1",
  "setKeys.apiPathLabel": "API 路径",
  "setKeys.apiPathDescription": "输入API路径 (默认: /v1/chat/completions)",
  "setKeys.apiPathPlaceholder": "/v1/chat/completions",
  "setKeys.customNameLabel": "提供商名称",
  "setKeys.customNameDescription": "为此提供商输入自定义名称 (例如: '我的公司API')",
  "setKeys.customNamePlaceholder": "我的自定义提供商",
  "setKeys.addModelLabel": "添加模型",
  "setKeys.addModelDescription": "选择并添加可用模型",
  "setKeys.addCustomModelDescription": "输入模型名称",
  "setKeys.addModelButton": "添加模型",
  "setKeys.selectModelPlaceholder": "选择一个模型...",
  "setKeys.customModelPlaceholder": "输入模型名称 (例如: gpt-4-vision-preview)",
  "setKeys.verifyApiKeyFirst": "请先验证 API 密钥",
  "setKeys.enterApiKeyFirst": "请先输入 API 密钥",
  "setKeys.apiKeyVerified": "✅ {{providerName}} API 密钥验证成功",
  "setKeys.apiKeyVerificationFailed": "❌ {{providerName}} API 密钥验证失败",
  "setKeys.verificationError": "❌ {{providerName}} 验证错误: {{message}}",
  "setKeys.noModelsAvailable": "此提供商没有可用模型",
  "setKeys.modelAddedSuccessfully": "✅ 已将 {{modelName}} 添加到您的模型配置中",
  "setKeys.modelSelectionTitle": "从 {{providerName}} 添加模型",
  "setKeys.modelSelectionDescription": "选择要添加到配置的模型:",
  "setKeys.visionCapableLabel": "支持视觉",
  "setKeys.visionCapableDescription": "勾选此选项如果该模型支持图像分析",
  "setKeys.visionBadge": "视觉",
  "setKeys.contextBadge": "{{count}} 令牌",

  // Add Custom Provider Modal
  "addCustomProvider.title": "添加自定义AI提供商",
  "addCustomProvider.description": "添加一个新的自定义AI提供商及其API配置。",
  "addCustomProvider.providerNameLabel": "提供商名称",
  "addCustomProvider.providerNameDescription": "输入此提供商的名称 (例如: '我的公司API')",
  "addCustomProvider.providerNamePlaceholder": "我的公司API",
  "addCustomProvider.baseUrlLabel": "基础 URL",
  "addCustomProvider.baseUrlDescription": "输入API端点的基础URL",
  "addCustomProvider.baseUrlPlaceholder": "https://api.example.com/v1",
  "addCustomProvider.apiPathLabel": "API 路径",
  "addCustomProvider.apiPathDescription": "输入API路径 (默认: /v1/chat/completions)",
  "addCustomProvider.apiPathPlaceholder": "/v1/chat/completions",
  "addCustomProvider.apiKeyLabel": "API 密钥",
  "addCustomProvider.apiKeyDescription": "输入此提供商的API密钥",
  "addCustomProvider.apiKeyPlaceholder": "输入 API 密钥...",
  "addCustomProvider.modelIdLabel": "模型 ID",
  "addCustomProvider.modelIdDescription": "输入模型ID (例如: 'gpt-4o', 'claude-3-5-sonnet')",
  "addCustomProvider.modelIdPlaceholder": "gpt-4o",
  "addCustomProvider.modelNameLabel": "模型显示名称",
  "addCustomProvider.modelNameDescription": "输入此模型的显示名称",
  "addCustomProvider.modelNamePlaceholder": "GPT-4o",
  "addCustomProvider.visionCapableLabel": "支持视觉",
  "addCustomProvider.visionCapableDescription": "勾选此选项如果该模型支持图像分析",
  "addCustomProvider.testButton": "测试连接",
  "addCustomProvider.testingButton": "测试中...",
  "addCustomProvider.addButton": "添加提供商",
  "addCustomProvider.testSuccess": "✅ 连接测试成功！",
  "addCustomProvider.testFailed": "❌ 连接测试失败: {{error}}",
  "addCustomProvider.addSuccess": "✅ 成功添加 {{providerName}} - {{modelName}}！",
  "addCustomProvider.providerNameRequired": "提供商名称是必需的",
  "addCustomProvider.baseUrlRequired": "基础URL是必需的",
  "addCustomProvider.apiKeyRequired": "API密钥是必需的",
  "addCustomProvider.modelIdRequired": "模型ID是必需的",

  // Manage Models Modal
  "manageModels.description": "配置和管理您的 AI 模型配置。",
  "manageModels.setDefaultButton": "设为默认",
  "manageModels.configureButton": "⚙️",
  "manageModels.deleteButton": "🗑️",
  "manageModels.deleteButtonTitle": "删除此模型配置",
  "manageModels.configureButtonTitle": "配置模型设置",
  "manageModels.providerBadge": "{{providerName}}",
  "manageModels.defaultBadge": "默认",
  "manageModels.setAsDefaultSuccess": "✅ 已将 {{modelName}} 设为默认模型",
  "manageModels.deletedSuccessfully": "✅ 已删除 {{modelName}}",
  "manageModels.maxTokensLabel": "最大令牌数",
  "manageModels.maxTokensDescription": "响应的最大令牌数",
  "manageModels.maxTokensPlaceholder": "4000",
  "manageModels.temperatureLabel": "温度",
  "manageModels.temperatureDescription": "控制随机性 (0.0 = 确定性, 1.0 = 非常有创意)",
  "manageModels.topPLabel": "Top P",
  "manageModels.topPDescription": "核心采样参数",
  "manageModels.frequencyPenaltyLabel": "频率惩罚",
  "manageModels.frequencyPenaltyDescription": "减少令牌重复",
  "manageModels.presencePenaltyLabel": "存在惩罚",
  "manageModels.presencePenaltyDescription": "减少主题重复",
  "manageModels.maxResponseTimeLabel": "最大响应时间",
  "manageModels.maxResponseTimeDescription": "等待响应的最大时间(秒)",
  "manageModels.maxResponseTimePlaceholder": "30",
  "manageModels.systemPromptLabel": "系统提示词",
  "manageModels.systemPromptDescription": "此模型的自定义系统提示词(可选)",
  "manageModels.systemPromptPlaceholder": "输入自定义系统提示词...",
  "manageModels.resetToDefaultsButton": "重置为默认值",
  "manageModels.settingsResetSuccess": "✅ 设置已重置为默认值",
  "manageModels.confirmDeleteTitle": "删除模型配置",
  "manageModels.confirmDeleteMessage": "您确定要删除 \"{{modelName}}\" 吗？此操作无法撤销。",
  "manageModels.confirmDeleteCancel": "取消",
  "manageModels.confirmDeleteConfirm": "删除",

  // Chat History Modal
  "chatHistory.manualSavedTitle": "手动保存的会话",
  "chatHistory.closeButton": "关闭",
  "chatHistory.noAutoSavedFound": "未找到自动保存的会话",
  "chatHistory.noManualSavedFound": "未找到手动保存的会话",
  "chatHistory.errorLoading": "加载会话时出错: {{message}}",
  "chatHistory.autoSavedBadge": "自动保存",
  "chatHistory.manualBadge": "手动",
  "chatHistory.conversationLoaded": "✅ 已加载会话: {{title}}",
  "chatHistory.failedToParse": "❌ 解析会话失败",
  "chatHistory.failedToLoad": "❌ 加载会话失败: {{message}}",

  // AI Chat View
  "aiChat.title": "CaptureAI",
  "aiChat.assistantTitle": "AI 助手",
  "aiChat.howToUseTitle": "使用方法",
  "aiChat.instruction.screenshot": "截取屏幕截图，它将自动分析",
  "aiChat.instruction.dragDrop": "将图像拖放到会话区域",
  "aiChat.instruction.typeQuestions": "输入您的问题并按 Enter 发送",
  "aiChat.instruction.configureKeys": "要想使用AI，需要在设置中配置 API 密钥",
  "aiChat.noModelsConfigured": "⚠️ 未配置 AI 模型",
  "aiChat.noModelsDescription": "转到设置 → 设置密钥来配置 AI 提供商",
  "aiChat.readyWithModel": "✅ 准备就绪，使用 {{modelName}}",
  "aiChat.readyWithModelTextOnly": "⚪ 准备就绪，使用 {{modelName}} (仅文本)",
  "aiChat.textOnlyModelNotice": "此模型不支持图像分析，但正常文本会话仍然可用",
  "aiChat.modelsConfigured": "已配置 {{count}} 个视觉模型",
  "aiChat.allModelsConfigured": "已配置 {{total}} 个模型，其中 {{vision}} 个视觉模型",
  "aiChat.sendButton": "发送",
  "aiChat.typePlaceholder": "输入您的消息...",
  "aiChat.dragImageHere": "将图像拖拽到这里或",
  "aiChat.selectImages": "选择图像",
  "aiChat.newConversationButton": "新会话",
  "aiChat.loadHistoryButton": "加载历史会话",
  "aiChat.saveConversationButton": "保存会话",
  "aiChat.clearImagesButton": "清除图像",
  "aiChat.removeImageButton": "移除",
  "aiChat.insertToCursorButton": "插入到光标处",
  "aiChat.copyMessageButton": "复制",
  "aiChat.switchEditViewButton": "切换编辑/阅读视图",
  "aiChat.deleteMessageButton": "删除",
  "aiChat.includeInContextTooltip": "是否参与AI上下文构建",
  "aiChat.user": "用户",
  "aiChat.aiAssistant": "AI 助手",
  "aiChat.textChatTitle": "文本会话",
  "aiChat.screenshotAnalysisTitle": "截图分析",
  "aiChat.sendingMessage": "正在发送消息...",
  "aiChat.aiThinking": "AI 正在思考...",
  "aiChat.conversationSaved": "✅ 会话已保存为: {{fileName}}",
  "aiChat.failedToSave": "❌ 保存会话失败: {{message}}",
  "aiChat.imagesCleared": "✅ 图像已清除",
  "aiChat.noActiveConversation": "没有活跃的会话可保存",
  "aiChat.errorSendingMessage": "❌ 发送消息错误: {{message}}",
  "aiChat.menuButton": "菜单",
  "aiChat.browseFiles": "选择文件",
  "aiChat.inputPlaceholder": "您想了解什么，或者试试图片？",
  "aiChat.textCopied": "文本已复制到剪贴板",
  "aiChat.imageCopied": "图像已复制到剪贴板",
  "aiChat.selectionCopied": "选择内容已复制为 Markdown",
  "aiChat.copyFailed": "复制消息失败",
  "aiChat.copyImageFailed": "复制图片失败",
  "aiChat.copySelectionFailed": "复制选择内容失败",
  "aiChat.imagesReadyToSend": "{{count}} 张图片准备发送",
  "aiChat.clearAllImages": "清除全部",
  "aiChat.removeThisImage": "移除此图片",
  "aiChat.sendMessageTooltip": "发送消息 (Enter)",
  "aiChat.nonVisionModelWarning": "当前为非视觉模型无法发送图片",
  "aiChat.nonVisionModelCannotSendImages": "当前为非视觉模型无法处理图片。请输入文字消息或切换到支持视觉的模型。",
  "aiChat.nonVisionModelNotice": "当前使用的是非视觉模型，无法处理图片。请输入文字消息或切换到支持视觉的模型。",

  // AI Chat Modes
  "aiChat.modes.analyze": "图像分析",
  "aiChat.modes.ocr": "提取文本 (OCR)",
  "aiChat.modes.chat": "纯文字对话",
  "aiChat.modes.custom": "使用自定义提示词",

  // Main plugin messages
  "plugin.aiChatPanelToggleFailed": "❌ 切换 AI 会话面板失败: {{message}}",
  "plugin.aiManagerNotInitialized": "AI 管理器未初始化",
  "plugin.aiChatPanelNotFound": "未找到 AI 会话面板或不支持图像队列",
  "plugin.failedToCreateAiChatPanel": "创建 AI 会话面板失败: {{message}}",

  // Settings tab - hardcoded content that needs i18n
  "settings.usage.helpContent": `
    <p>如何使用截图插件:</p>
    <ol>
      <li>点击功能区中的相机图标或使用命令面板</li>
      <li>选择"捕获选定区域"或"捕获全屏"</li>
      <li>对于区域捕获：拖动选择要捕获的区域</li>
      <li>使用编辑工具注释您的截图</li>
      <li>点击"保存"保存图像或"发送到AI"进行分析</li>
    </ol>
    <p><strong>注意:</strong> 此插件需要Obsidian在支持Electron的桌面平台上运行。</p>
  `,
  "settings.troubleshooting.helpContent": `
    <p>如果截图不工作:</p>
    <ul>
      <li>确保您在桌面版Obsidian上运行（非移动版）</li>
      <li>尝试重启Obsidian</li>
      <li>检查您在macOS上是否有适当的屏幕录制权限</li>  
      <li>使用"测试桌面捕获API"命令诊断问题</li>
    </ul>
    <p>如果AI会话不工作:</p>
    <ul>
      <li>检查您的API密钥是否使用"设置密钥"正确配置</li>
      <li>确保您至少配置了一个支持视觉的模型</li>
      <li>验证您的网络连接</li>
      <li>检查控制台 (Ctrl+Shift+I) 查看错误消息</li>
    </ul>
  `,

  // Missing Notice translations
  "notice.imageAndTextCopied": "图片和文本已复制到剪贴板",
  "notice.textCopiedImageFailed": "文本已复制到剪贴板（图片复制失败）",
  "notice.failedToCopyMessage": "复制消息失败",
  "notice.pleaseConfigureModel": "请在设置 > 设置密钥中配置至少一个AI模型",
  "notice.pleaseDropImageFilesOnly": "请只拖放图片文件",
  "notice.noConversationToSave": "❌ 没有要保存的会话",
  "notice.openInMarkdownNote": "请在markdown笔记中打开光标位置再使用此功能",
  "notice.contentInsertedAtCursor": "内容已插入到光标位置",
  "notice.failedToInsertContent": "插入内容失败",
  "notice.noActiveConversation": "没有活跃的会话",
  "notice.messageNotFound": "未找到消息",
  "notice.messageDeleted": "消息已删除",
  "notice.failedToDeleteMessage": "删除消息失败",
  "notice.enterApiKeyFirst": "请先输入API密钥",
  "notice.imageCopiedToClipboard": "✅ 图片已复制到剪贴板",
  "notice.copyFailedUseSave": "❌ 复制失败，请使用保存功能",
  "notice.failedToParseConversation": "❌ 解析会话失败",
  "notice.tempImageLimitWarning": "📸 当前会话已有{{count}}张临时图片，建议保存会话以避免内存占用过高",
  "notice.reloadPluginRequired": "⚙️ 界面更改需要重新加载插件才能生效",

  // Missing placeholder translations
  "placeholder.editMessageContent": "编辑消息内容...",
};