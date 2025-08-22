import { Component, MarkdownRenderer, setIcon, TFile } from 'obsidian';
import { AIMessage } from '../ai/ai-manager';
import { t } from '../i18n';
import { getLogger } from '../utils/logger';

export class MessageRenderManager {
    private messageElements = new Map<string, HTMLElement>();
    private messagesContainer: HTMLElement | null = null;
    private shouldScrollToBottom = false;
    private markdownComponent: Component;
    
    constructor(private chatView: any) {
        this.markdownComponent = new Component();
    }
    
    /**
     * 主渲染方法 - 增量更新消息
     */
    async renderMessages(container: HTMLElement, messages: AIMessage[]): Promise<void> {
        // 确保消息容器只创建一次
        if (!this.messagesContainer || !container.contains(this.messagesContainer)) {
            this.messagesContainer = container.createEl('div', { cls: 'ai-chat-messages' });
            this.messageElements.clear();
            
            // 设置事件委托，处理所有按钮点击
            this.setupEventDelegation();
        }

        // 增量更新算法
        await this.incrementalUpdateMessages(messages);

        // 自动滚动到底部
        if (this.shouldScrollToBottom) {
            this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
            this.shouldScrollToBottom = false;
        }
    }
    
    /**
     * 添加单条消息
     */
    async appendMessage(message: AIMessage, containerEl?: HTMLElement): Promise<void> {
        // 确保消息容器存在
        if (!this.messagesContainer) {
            // 如果容器不存在，使用提供的容器或寻找聊天区域
            const chatArea = containerEl || this.chatView.containerEl.querySelector('.ai-chat-area') as HTMLElement;
            
            if (chatArea) {
                // 清空现有内容（移除空状态）
                chatArea.empty();
                this.messagesContainer = chatArea.createEl('div', { cls: 'ai-chat-messages' });
                this.messageElements.clear();
                this.setupEventDelegation();
            } else {
                getLogger().error('Chat area not found, cannot append message');
                return;
            }
        }

        const messageElement = await this.createMessageElement(message);
        this.messagesContainer.appendChild(messageElement);
        this.messageElements.set(message.id, messageElement);
        
        this.shouldScrollToBottom = true;
        messageElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
    
    /**
     * 更新单条消息
     */
    async updateMessage(message: AIMessage): Promise<void> {
        const existingElement = this.messageElements.get(message.id);
        if (existingElement) {
            await this.updateExistingMessageIfNeeded(message, existingElement);
        }
    }
    
    /**
     * 移除消息
     */
    async removeMessage(messageId: string): Promise<void> {
        this.removeMessageElement(messageId);
    }
    
    /**
     * 替换消息
     */
    async replaceMessage(oldId: string, newMessage: AIMessage): Promise<void> {
        const oldElement = this.messageElements.get(oldId);
        if (!oldElement) return;

        // 确保消息容器存在
        if (!this.messagesContainer) {
            console.error('Messages container not found, cannot replace message');
            return;
        }

        const newElement = await this.createMessageElement(newMessage);
        this.messagesContainer.replaceChild(newElement, oldElement);
        
        this.messageElements.delete(oldId);
        this.messageElements.set(newMessage.id, newElement);
    }
    
    /**
     * 获取消息元素
     */
    getMessageElement(messageId: string): HTMLElement | undefined {
        return this.messageElements.get(messageId);
    }
    
    /**
     * 获取所有消息元素
     */
    getAllMessageElements(): Map<string, HTMLElement> {
        return this.messageElements;
    }
    
    /**
     * 处理消息内容中的temp协议，将其转换为实际的base64 data URLs
     * 使用source作为alt文本，提供有意义的描述
     */
    processContentTempProtocols(content: string): string {
        return this.processContentTempProtocolsWithReplacer(content, (tempData, alt, tempId) => {
            // Use source as alt text to provide meaningful description
            return `![${tempData.source}](${tempData.dataUrl})`;
        });
    }
    
    /**
     * 通用的temp协议解析和替换方法
     * @param content 包含temp协议的内容
     * @param replacer 替换函数，接收(tempData, alt, tempId)参数，返回替换后的字符串
     * @returns 处理后的内容
     */
    processContentTempProtocolsWithReplacer(content: string, replacer: (tempData: any, alt: string, tempId: string) => string): string {
        const tempImageRegex = /!\[(.*?)\]\(temp:([^)]+)\)/g;
        return content.replace(tempImageRegex, (match, alt, tempId) => {
            const tempData = this.chatView.aiManager.getImageReferenceManager().getTempImageData(tempId);
            if (tempData) {
                return replacer(tempData, alt, tempId);
            } else {
                getLogger().warn('Temp image not found for ID:', tempId);
                // 保持原样或返回警告
                return match;
            }
        });
    }
    
    /**
     * 解析内容中的所有temp协议引用
     * @param content 要解析的内容
     * @returns temp引用的数组，每个元素包含{alt, tempId, tempData, fullMatch}
     */
    parseTempImageReferences(content: string): Array<{alt: string, tempId: string, tempData: any, fullMatch: string}> {
        const tempImageRegex = /!\[(.*?)\]\(temp:([^)]+)\)/g;
        const references: Array<{alt: string, tempId: string, tempData: any, fullMatch: string}> = [];
        let match;
        
        while ((match = tempImageRegex.exec(content)) !== null) {
            const [fullMatch, alt, tempId] = match;
            const tempData = this.chatView.aiManager.getImageReferenceManager().getTempImageData(tempId);
            
            references.push({
                alt,
                tempId,
                tempData,
                fullMatch
            });
        }
        
        return references;
    }
    
    /**
     * 清理资源
     */
    destroy(): void {
        this.messageElements.clear();
        this.messagesContainer = null;
        this.markdownComponent.unload();
    }
    
    /**
     * 重置消息渲染器状态（用于新会话）
     */
    resetForNewConversation(): void {
        this.messageElements.clear();
        this.messagesContainer = null;
        this.shouldScrollToBottom = false;
        getLogger().log('🔄 MessageRenderManager reset for new conversation');
    }
    
    // ========== 私有方法 ==========
    
    /**
     * 设置事件委托
     */
    private setupEventDelegation(): void {
        if (!this.messagesContainer) return;
        
        this.messagesContainer.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const button = target.closest('[data-action]') as HTMLElement;
            if (button) {
                const action = button.getAttribute('data-action');
                const messageId = button.getAttribute('data-message-id');
                if (action && messageId) {
                    this.handleMessageAction(messageId, action, button);
                }
            }
        });
    }
    
    /**
     * 处理消息按钮点击
     */
    private handleMessageAction(messageId: string, action: string, button: HTMLElement): void {
        // 检查按钮是否被禁用
        if (button instanceof HTMLButtonElement && button.disabled) {
            return; // 如果按钮被禁用，不执行任何操作
        }
        
        // 获取完整的消息对象
        const conversation = this.chatView.aiManager.getCurrentConversationData();
        if (!conversation) return;
        
        const message = conversation.messages.find((m: AIMessage) => m.id === messageId);
        if (!message) return;
        
        switch(action) {
            case 'copy':
                this.chatView.copyMessage(message);
                break;
            case 'edit':
                const messageEl = button.closest('.ai-chat-message');
                const contentEl = messageEl?.querySelector('.ai-chat-message-content');
                if (contentEl) {
                    this.chatView.toggleMessageEditMode(contentEl, message, button);
                }
                break;
            case 'delete':
                this.chatView.deleteMessage(messageId);
                break;
            case 'insert':
                this.chatView.insertMessageAtCursor(message);
                break;
        }
    }
    
    /**
     * 增量更新算法
     */
    private async incrementalUpdateMessages(newMessages: AIMessage[]): Promise<void> {
        const existingIds = new Set(this.messageElements.keys());
        const newIds = new Set(newMessages.map(m => m.id));

        // 1. 删除不存在的消息
        for (const id of existingIds) {
            if (!newIds.has(id)) {
                this.removeMessageElement(id);
            }
        }

        // 2. 更新或添加消息（保持顺序）
        for (let i = 0; i < newMessages.length; i++) {
            const message = newMessages[i];
            const existingElement = this.messageElements.get(message.id);

            if (existingElement) {
                // 检查是否需要更新
                await this.updateExistingMessageIfNeeded(message, existingElement);
            } else {
                // 创建新消息
                const newElement = await this.createMessageElement(message);
                this.insertMessageAtPosition(newElement, i, message.id);
            }
        }
    }
    
    /**
     * 在指定位置插入消息
     */
    private insertMessageAtPosition(messageElement: HTMLElement, targetIndex: number, messageId: string): void {
        if (!this.messagesContainer) return;
        
        const existingMessages = Array.from(this.messagesContainer.children);
        
        if (targetIndex >= existingMessages.length) {
            // 添加到末尾
            this.messagesContainer.appendChild(messageElement);
            this.shouldScrollToBottom = true;
        } else {
            // 插入到指定位置
            this.messagesContainer.insertBefore(messageElement, existingMessages[targetIndex]);
        }
        
        this.messageElements.set(messageId, messageElement);
    }
    
    /**
     * 检查并更新现有消息
     */
    private async updateExistingMessageIfNeeded(message: AIMessage, element: HTMLElement): Promise<void> {
        // 检查内容是否变化
        const currentContent = element.getAttribute('data-content');
        const newContent = message.content || '';
        
        if (currentContent !== newContent) {
            // 只更新内容区域，不重建整个消息元素
            const contentArea = element.querySelector('.ai-chat-message-content');
            if (contentArea) {
                contentArea.empty();
                await this.renderMessageContentFromMarkdown(contentArea as HTMLElement, message);
                element.setAttribute('data-content', newContent);
            }
        }
        
        // 更新typing状态
        const isTyping = (message as any).isTyping || false;
        element.toggleClass('typing', isTyping);
        
        // 更新按钮状态
        const buttons = element.querySelectorAll('.message-action-btn');
        buttons.forEach(btn => {
            if (isTyping) {
                (btn as HTMLButtonElement).disabled = true;
                btn.classList.add('ai-chat-button-disabled');
            } else {
                (btn as HTMLButtonElement).disabled = false;
                btn.classList.remove('ai-chat-button-disabled');
            }
        });
    }
    
    /**
     * 移除消息元素
     */
    private removeMessageElement(messageId: string): void {
        const element = this.messageElements.get(messageId);
        if (element) {
            element.remove();
            this.messageElements.delete(messageId);
        }
    }
    
    /**
     * 创建消息元素
     */
    private async createMessageElement(message: AIMessage): Promise<HTMLElement> {
        const messageEl = createEl('div', { 
            cls: `ai-chat-message ai-chat-message-block`,
            attr: { 
                'data-message-id': message.id,
                'data-content': message.content || ''
            }
        });

        // Message block with avatar on left and content on right
        const messageRow = messageEl.createEl('div', { cls: 'ai-chat-message-row' });
        
        // Avatar section (always on left)
        const avatarSection = messageRow.createEl('div', { cls: 'ai-chat-message-avatar' });
        const avatarIcon = avatarSection.createEl('div', { cls: 'ai-chat-avatar-icon' });
        
        if (message.type === 'user') {
            // User icon
            setIcon(avatarIcon, 'user-round');
            avatarIcon.addClass('user-avatar');
        } else {
            // AI Assistant icon
            setIcon(avatarIcon, 'bot');
            avatarIcon.addClass('ai-avatar');
        }

        // Content section (full width minus avatar)
        const contentSection = messageRow.createEl('div', { cls: 'ai-chat-message-content-section' });
        
        // Header with timestamp on left and action buttons on right
        const messageHeader = contentSection.createEl('div', { cls: 'ai-chat-message-header' });
        messageHeader.createEl('span', { 
            text: this.formatTime(message.timestamp),
            cls: 'ai-chat-message-time'
        });
        
        // Action buttons (4 buttons as requested) - moved to header right
        const actionButtons = messageHeader.createEl('div', { cls: 'ai-chat-message-actions' });

        // Message content with text selection support
        const messageContent = contentSection.createEl('div', { 
            cls: 'ai-chat-message-content',
            attr: { 'data-message-id': message.id }
        });
        
        // Check if message is currently being typed (AI response in progress)
        const isTyping = (message as any).isTyping || false;
        
        // 1. Insert at cursor button
        const insertBtn = actionButtons.createEl('button', { 
            cls: 'btn-transparent btn-transparent-sm message-action-btn',
            attr: { 
                title: t('aiChat.insertToCursorButton'),
                'data-tooltip': t('aiChat.insertToCursorButton'),
                'data-action': 'insert',
                'data-message-id': message.id
            }
        });
        
        setIcon(insertBtn, 'between-horizontal-end');
        if (isTyping) {
            insertBtn.disabled = true;
            insertBtn.classList.add('ai-chat-button-disabled');
        }
        
        // 2. Copy button  
        const copyBtn = actionButtons.createEl('button', { 
            cls: 'btn-transparent btn-transparent-sm message-action-btn',
            attr: { 
                title: t('aiChat.copyMessageButton'),
                'data-tooltip': t('aiChat.copyMessageButton'),
                'data-action': 'copy',
                'data-message-id': message.id
            }
        });

        setIcon(copyBtn, 'copy');
        if (isTyping) {
            copyBtn.disabled = true;
            copyBtn.classList.add('ai-chat-button-disabled');
        }
        
        // 3. Toggle edit/read view button
        const editBtn = actionButtons.createEl('button', { 
            cls: 'btn-transparent btn-transparent-sm message-action-btn',
            attr: { 
                title: t('aiChat.switchEditViewButton'),
                'data-tooltip': t('aiChat.switchEditViewButton'),
                'data-action': 'edit',
                'data-message-id': message.id
            }
        });

        setIcon(editBtn, 'square-pen');
        if (isTyping) {
            editBtn.disabled = true;
            editBtn.classList.add('ai-chat-button-disabled');
        }
        
        // 4. Delete button
        const deleteBtn = actionButtons.createEl('button', { 
            cls: 'btn-transparent btn-transparent-sm message-action-btn delete-btn',
            attr: { 
                title: t('aiChat.deleteMessageButton'),
                'data-tooltip': t('aiChat.deleteMessageButton'),
                'data-action': 'delete',
                'data-message-id': message.id
            }
        });
        setIcon(deleteBtn, 'trash-2');
        if (isTyping) {
            deleteBtn.disabled = true;
            deleteBtn.classList.add('ai-chat-button-disabled');
        }

        // Enable text selection for the entire message area
        messageEl.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
                this.handleKeyboardCopy(e, message);
            }
        });
        messageEl.setAttribute('tabindex', '0'); // Make it focusable for keyboard events

        // Show text content or typing indicator
        if ((message as any).isTyping) {
            const typingEl = messageContent.createEl('div', { cls: 'ai-chat-typing-indicator' });
            typingEl.empty();
            for (let i = 0; i < 3; i++) {
                typingEl.createEl('span', { cls: 'typing-dot' });
            }
        } else if (message.content) {
            // Use new markdown rendering that handles both images and text
            await this.renderMessageContentFromMarkdown(messageContent, message);
        }
        
        return messageEl;
    }
    
    /**
     * 渲染消息内容（从Markdown）- 公开方法供外部调用
     */
    async renderMessageContentFromMarkdown(container: HTMLElement, message: AIMessage): Promise<void> {
        container.empty();
        
        if (!message.content) return;
        
        getLogger().log('🖼️ Rendering message content:', message.content);
        
        // Parse markdown content to extract images and text  
        const imageReferences = this.chatView.aiManager.parseImageReferences(message.content);
        getLogger().log('🔍 Found image references:', imageReferences);
        
        // Remove image markdown from text content
        let textContent = message.content;
        imageReferences.forEach((imgRef: any) => {
            const imgMarkdown = `![${imgRef.alt}](${imgRef.path})`;
            textContent = textContent.replace(imgMarkdown, '').trim();
        });
        // Clean up extra whitespace
        textContent = textContent.replace(/\n\s*\n/g, '\n\n').trim();
        
        // Render images first (统一处理，不区分单张多张)
        if (imageReferences.length > 0) {
            const imagesContainer = container.createEl('div', { cls: 'ai-chat-message-images' });
            for (const imageRef of imageReferences) {
                await this.renderImage(imagesContainer, imageRef);
            }
        }
        
        // Render text content if present
        if (textContent.trim()) {
            const textEl = container.createEl('div', { cls: 'ai-chat-message-text' });
            await this.renderMarkdown(textEl, textContent);
        }
    }
    
    /**
     * 渲染图片（统一处理）
     */
    private async renderImage(container: HTMLElement, imageRef: { alt: string; path: string; fileName: string }): Promise<void> {
        const { alt, path, fileName } = imageRef;
        
        getLogger().log('🖼️ Rendering image:', { alt, path, fileName });
        
        // 创建图片容器
        const imageContainer = container.createEl('div', { cls: 'ai-chat-message-image-container' });
        
        let imageSrc: string;
        
        // Handle different path types
        if (path.startsWith('data:')) {
            // Data URL - use directly
            imageSrc = path;
            getLogger().log('✅ Using data URL directly');
        } else if (path.startsWith('temp:')) {
            // Temp protocol image - resolve it using ImageReferenceManager
            const tempId = path.replace('temp:', '');
            getLogger().log('🔍 Looking for temp image with ID:', tempId);
            
            const tempData = this.chatView.aiManager.getImageReferenceManager().getTempImageData(tempId);
            if (tempData) {
                imageSrc = tempData.dataUrl;
                getLogger().log('✅ Found temp image data:', { source: tempData.source, fileName: tempData.fileName });
            } else {
                getLogger().warn('❌ Temp image not found for ID:', tempId);
                
                imageSrc = 'data:image/svg+xml;base64,' + btoa(`
                    <svg width="200" height="100" xmlns="http://www.w3.org/2000/svg">
                        <rect width="100%" height="100%" fill="#f0f0f0" stroke="#ccc" stroke-width="2"/>
                        <text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="#666">
                            Missing Temp Image
                        </text>
                    </svg>
                `);
            }
        } else if (path.startsWith('[TempPic ') && path.endsWith(']')) {
            // Legacy placeholder path - show a placeholder image
            imageSrc = 'data:image/svg+xml;base64,' + btoa(`
                <svg width="200" height="100" xmlns="http://www.w3.org/2000/svg">
                    <rect width="100%" height="100%" fill="#f0f0f0" stroke="#ccc" stroke-width="2"/>
                    <text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="#666">
                        Temporary Image
                    </text>
                </svg>
            `);
        } else {
            // Regular path - try to get vault resource URL first, fallback to direct path
            imageSrc = this.getVaultResourceUrl(path) || path;
            
            // If that fails, try to load as data URL
            if (!imageSrc.startsWith('app://')) {
                const dataUrl = await this.loadImageDataFromPath(path);
                if (dataUrl) {
                    imageSrc = dataUrl;
                }
            }
        }
        
        const imageEl = imageContainer.createEl('img', { 
            cls: 'ai-chat-message-image',
            attr: { 
                src: imageSrc,
                alt: alt || fileName || 'AI Image',
                loading: 'lazy'
            }
        });

        // Add click handler for image preview
        imageEl.addEventListener('click', () => {
            this.chatView.showImageModal(imageSrc);
        });

        // Make the image draggable with proper Obsidian integration
        imageEl.draggable = true;
        imageEl.addEventListener('dragstart', (e) => {
            getLogger().log('Image drag started:', fileName, 'path:', path);
            
            // Verify the file exists before drag
            const vault = this.chatView.plugin.app.vault;
            const file = vault.getAbstractFileByPath(path);
            
            if (file) {
                getLogger().log('✅ Image file exists in vault:', path);
                
                // Use multiple dataTransfer formats for maximum compatibility
                e.dataTransfer?.setData('text/plain', `![[${file.name}]]`);
                e.dataTransfer?.setData('text/uri-list', path);
                e.dataTransfer?.setData('text/html', `![[${path}]]`);
                e.dataTransfer?.setData('application/x-obsidian-file', JSON.stringify({
                    type: 'file',
                    path: path,
                    name: fileName
                }));
                
                getLogger().log('Set drag data for vault image:', file.name);
            } else {
                getLogger().log('⚠️ Image file not found in vault, using path:', path);
                e.dataTransfer?.setData('text/plain', path);
            }
        });

        // 消息块中的图片不显示文件名标签，保持界面简洁

        // Error handling for image load failures
        imageEl.addEventListener('error', () => {
            getLogger().warn('Failed to load image:', imageSrc);
            imageEl.src = 'data:image/svg+xml;base64,' + btoa(`
                <svg width="200" height="100" xmlns="http://www.w3.org/2000/svg">
                    <rect width="100%" height="100%" fill="#f0f0f0" stroke="#ccc" stroke-width="2"/>
                    <text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="#666">
                        Failed to Load Image
                    </text>
                </svg>
            `);
        });
    }
    
    /**
     * 渲染Markdown内容
     */
    private async renderMarkdown(container: HTMLElement, content: string): Promise<void> {
        // First, extract and render thinking blocks
        let processedContent = this.extractAndRenderThinkingBlocks(container, content);
        
        // Convert temp: protocol images to actual data URLs for Obsidian rendering
        processedContent = this.processContentTempProtocols(processedContent);
        
        // LaTeX delimiter conversion - 修复转换逻辑和注释
        // \( ... \) -> $...$ (行内公式)
        processedContent = processedContent.replace(/\\\(\s*([^]*?)\s*\\\)/g, function(match, formula) {
            return '$' + formula.trim() + '$'; // 移除额外空格，避免影响渲染
        });
        
        // \[ ... \] -> $$...$$ (行间公式)  
        processedContent = processedContent.replace(/\\\[\s*([^]*?)\s*\\\]/g, function(match, formula) {
            return '$$' + formula.trim() + '$$'; // 移除额外空格，让渲染与原生$$公式一致
        });
        
        
        // Create a simple container with minimal interference
        const markdownContainer = container.createEl('div', { cls: 'markdown-rendered' });
        
        try {
            // Let Obsidian handle everything naturally
            await MarkdownRenderer.renderMarkdown(
                processedContent,
                markdownContainer,
                '', 
                this.markdownComponent
            );
            
        } catch (error) {
            getLogger().error('Failed to render markdown:', error);
            markdownContainer.createEl('div', { text: processedContent });
        }
    }
    
    // ========== 辅助方法 ==========
    
    private formatTime(timestamp: Date): string {
        return timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    private getVaultResourceUrl(path: string | null): string | null {
        if (!path) return null;
        
        try {
            // Try to get the file from the vault
            const file = this.chatView.plugin.app.vault.getAbstractFileByPath(path);
            if (file && file instanceof TFile) {
                // Get the resource path that Obsidian can use to display the image
                return this.chatView.plugin.app.vault.getResourcePath(file);
            }
        } catch (error) {
            getLogger().warn('Failed to get vault resource URL for path:', path, error);
        }
        
        return null;
    }
    
    private async loadImageDataFromPath(path: string): Promise<string | null> {
        // Implementation would go here - delegate to chatView if needed
        return this.chatView.loadImageDataFromPath?.(path) || null;
    }
    
    private getImageSourceLabel(path: string): string {
        if (path.startsWith('temp:')) {
            return 'Temp';
        } else if (path.startsWith('data:')) {
            return 'Data';
        } else {
            return 'File';
        }
    }
    
    private openImagePreview(imageSrc: string, alt: string): void {
        // Implementation would go here - delegate to chatView if needed
        this.chatView.openImagePreview?.(imageSrc, alt);
    }
    
    private handleKeyboardCopy(e: KeyboardEvent, message: AIMessage): void {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return;

        e.preventDefault();
        this.chatView.copySelectionAsMarkdown?.(message, selection);
    }
    
    private extractAndRenderThinkingBlocks(container: HTMLElement, content: string): string {
        // Conservative list of thinking-related tags (only common AI thinking patterns)
        const thinkingTags = [
            'thinking', 'think', 'reasoning', 'analysis', 'reflection', 
            'internal', 'scratchpad', 'planning'
        ];
        
        let processedContent = content;
        
        // Process each thinking tag type
        for (const tag of thinkingTags) {
            // Only support the most common and safe patterns to avoid over-matching
            const patterns = [
                // Standard XML format: <tag>content</tag> (most common)
                new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'gi'),
                // Triangle format: ◁tag▷content◁/tag▷ (some AI models)  
                new RegExp(`◁${tag}▷([\\s\\S]*?)◁/${tag}▷`, 'gi')
            ];
            
            for (const pattern of patterns) {
                let match;
                while ((match = pattern.exec(processedContent)) !== null) {
                    const thinkingContent = match[1];
                    
                    if (!thinkingContent?.trim()) continue;
                    
                    // Create thinking block container
                    const thinkingBlock = container.createEl('div', { cls: 'ai-thinking-block' });
                    
                    // Create header with toggle
                    const header = thinkingBlock.createEl('div', { cls: 'ai-thinking-header' });
                    const toggleIcon = header.createEl('span', { cls: 'ai-thinking-toggle' });
                    
                    setIcon(toggleIcon, 'lightbulb');

                    const label = header.createEl('span', { 
                        cls: 'ai-thinking-label',
                        text: this.getThinkingLabel(tag)
                    });
                    
                    // Create collapsible content
                    const contentEl = thinkingBlock.createEl('div', { cls: 'ai-thinking-content' });
                    
                    // Render thinking content with basic markdown
                    this.renderThinkingContent(contentEl, thinkingContent.trim());
                    
                    // Add toggle functionality
                    let isCollapsed = false;
                    header.addEventListener('click', () => {
                        isCollapsed = !isCollapsed;
                        contentEl.style.display = isCollapsed ? 'none' : 'block';
                        // Toggle between Brain and ChevronDown icons
                        if (isCollapsed) {
                            setIcon(toggleIcon, 'chevron-up');
                        } else {
                            setIcon(toggleIcon, 'lightbulb');
                        }
                        thinkingBlock.classList.toggle('collapsed', isCollapsed);
                    });
                    
                    // Remove the thinking block from the main content
                    processedContent = processedContent.replace(match[0], '');
                    
                    // Reset regex lastIndex to avoid infinite loops
                    pattern.lastIndex = 0;
                }
            }
        }
        
        return processedContent;
    }
    
    private getThinkingLabel(tag: string): string {
        const labels: { [key: string]: string } = {
            'think': 'Thinking',
            'thinking': 'Thinking Process',
            'reasoning': 'Reasoning',
            'plan': 'Planning',
            'analysis': 'Analysis',
            'internal': 'Internal Process',
            'reflection': 'Reflection',
            'decision': 'Decision Making'
        };
        return labels[tag.toLowerCase()] || 'Thought Process';
    }

    private renderThinkingContent(container: HTMLElement, content: string): void {
        // Simple text rendering for thinking content
        const lines = content.split('\n');
        
        for (const line of lines) {
            if (line.trim() === '') {
                container.createEl('br');
            } else {
                const p = container.createEl('p', { cls: 'ai-thinking-text' });
                // Handle basic formatting using DOM methods for security
                const strongRegex = /\*\*(.*?)\*\*/g;
                const emRegex = /\*(.*?)\*/g;
                const codeRegex = /`(.*?)`/g;
                
                let processedText = line;
                
                if (strongRegex.test(processedText) || emRegex.test(processedText) || codeRegex.test(processedText)) {
                    processedText = processedText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
                    processedText = processedText.replace(/\*(.*?)\*/g, '<em>$1</em>');
                    processedText = processedText.replace(/`(.*?)`/g, '<code>$1</code>');
                    p.textContent = processedText;
                } else {
                    p.textContent = processedText;
                }
            }
        }
    }
}