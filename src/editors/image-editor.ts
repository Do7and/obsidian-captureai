import { Modal, Notice } from 'obsidian';
import ImageCapturePlugin from '../main';
import { EditTool, Region, StrokeSize, StrokeSetting } from '../types';

export class ImageEditor extends Modal {
	private plugin: ImageCapturePlugin;
	private imageUrl: string = '';
	private region: Region = {x: 0, y: 0, width: 0, height: 0};
	private canvas: HTMLCanvasElement | null = null;
	private ctx: CanvasRenderingContext2D | null = null;
	private currentTool: string = 'pen';
	private currentColor: string = '#2563eb'; // 蓝色
	private currentStrokeSize: StrokeSize = 'medium';
	private isDrawing = false;
	private lastX = 0;
	private lastY = 0;
	private history: ImageData[] = [];
	private historyIndex = -1;
	private originalImageData: string = '';
	private textInput: HTMLTextAreaElement | null = null;
	
	private strokeSettings: Record<StrokeSize, number> = {
		small: 1,
		medium: 3,
		large: 6
	};

	constructor(plugin: ImageCapturePlugin) {
		super(plugin.app);
		this.plugin = plugin;
		this.modalEl.addClass('image-editor-modal');
	}

	showEditor(imageUrl: string, region: Region) {
		this.imageUrl = imageUrl;
		this.originalImageData = imageUrl;
		this.region = region;
		
		// Simplified approach: just calculate modal size based on reasonable bounds
		const toolbarHeight = 60;
		const textSectionHeight = 100;
		const buttonBarHeight = 60;
		const verticalPadding = 30;
		
		const minModalWidth = 500;
		const minModalHeight = 400;
		
		const maxModalWidth = window.innerWidth * 0.9;
		const maxModalHeight = window.innerHeight * 0.9;
		
		// Calculate modal size with reasonable defaults
		const modalWidth = Math.max(Math.min(region.width + 100, maxModalWidth), minModalWidth);
		const modalHeight = Math.max(Math.min(region.height + toolbarHeight + textSectionHeight + buttonBarHeight + 60, maxModalHeight), minModalHeight);
		
		console.log('Modal size calculation:', {
			region: { width: region.width, height: region.height },
			modalSize: { width: modalWidth, height: modalHeight }
		});
		
		// Store dimensions for use in onOpen
		(this as any).calculatedModalWidth = modalWidth;
		(this as any).calculatedModalHeight = modalHeight;
		// Don't need to pre-calculate canvas size, let CSS handle it
		(this as any).calculatedCanvasWidth = region.width;
		(this as any).calculatedCanvasHeight = region.height;
		
		this.open();
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('image-editor-container');
		
		// Set modal size directly on modalEl to prevent scrollbars
		const modalWidth = (this as any).calculatedModalWidth || 500;
		const modalHeight = (this as any).calculatedModalHeight || 400;
		
		this.modalEl.style.cssText = `
			width: ${modalWidth}px !important;
			height: ${modalHeight}px !important;
			max-width: ${modalWidth}px !important;
			max-height: ${modalHeight}px !important;
			min-width: ${modalWidth}px !important;
			min-height: ${modalHeight}px !important;
			overflow: hidden !important;
			resize: none !important;
		`;
		
		// Also set contentEl to fill the modal without overflow
		contentEl.style.cssText = `
			width: 100%;
			height: 100%;
			overflow: hidden;
			box-sizing: border-box;
		`;
		
		this.createEditorInterface(contentEl);
		this.loadImage();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.removeClass('image-editor-container');
		
		// Reset modal styles to prevent affecting other modals
		this.modalEl.style.cssText = '';
	}

	private createEditorInterface(container: HTMLElement) {
		// Get pre-calculated dimensions
		const canvasDisplayWidth = (this as any).calculatedCanvasWidth || 300;
		const canvasDisplayHeight = (this as any).calculatedCanvasHeight || 200;
		
		// Define fixed UI element heights
		const toolbarHeight = 60;
		const textSectionHeight = 100;
		const buttonBarHeight = 60;
		
		// Set container to use full modal space
		container.style.cssText = `
			display: flex;
			flex-direction: column;
			width: 100%;
			height: 100%;
			overflow: hidden;
			box-sizing: border-box;
		`;
		
		// Store display dimensions
		(this as any).canvasDisplayWidth = canvasDisplayWidth;
		(this as any).canvasDisplayHeight = canvasDisplayHeight;
		
		// Fixed height toolbar
		const toolbar = container.createDiv({ cls: 'image-editor-toolbar' });
		toolbar.style.cssText = `
			height: ${toolbarHeight}px;
			flex-shrink: 0;
		`;
		this.createMainToolbar(toolbar);
		
		// Canvas container with exact size, no forced width
		const canvasContainer = container.createDiv({ cls: 'image-editor-canvas-container' });
		canvasContainer.style.cssText = `
			display: flex;
			justify-content: center;
			align-items: center;
			background: var(--background-primary);
			border: 1px solid var(--background-modifier-border);
			margin: 10px 20px;
			height: ${canvasDisplayHeight}px;
			flex-shrink: 0;
			overflow: hidden;
		`;
		
		this.canvas = canvasContainer.createEl('canvas');
		this.canvas.style.cssText = `
			box-shadow: 0 0 10px rgba(0,0,0,0.3);
			cursor: crosshair;
			display: block;
		`;
		
		this.ctx = this.canvas.getContext('2d')!;
		this.bindCanvasEvents();
		
		// Fixed height text input area
		const textSection = container.createDiv({ cls: 'text-input-section' });
		textSection.style.cssText = `
			height: ${textSectionHeight}px;
			flex-shrink: 0;
		`;
		this.createTextInputSection(textSection);
		
		// Fixed height button bar
		const buttonBar = container.createDiv({ cls: 'image-editor-button-bar' });
		buttonBar.style.cssText = `
			height: ${buttonBarHeight}px;
			flex-shrink: 0;
		`;
		this.createActionButtons(buttonBar);
	}

	private createMainToolbar(toolbar: HTMLElement) {
		toolbar.style.cssText = `
			display: flex;
			align-items: center;
			padding: 12px;
			background: var(--background-secondary);
			border-bottom: 1px solid var(--background-modifier-border);
			gap: 8px;
			flex-wrap: wrap;
		`;
		
		// Drawing tools
		const tools: EditTool[] = [
			{ name: 'pen', icon: '✏️', cursor: 'crosshair' },
			{ name: 'rectangle', icon: '⬜', cursor: 'crosshair' },
			{ name: 'circle', icon: '⭕', cursor: 'crosshair' },
			{ name: 'arrow', icon: '➡️', cursor: 'crosshair' }
		];
		
		tools.forEach(tool => {
			const button = toolbar.createEl('button', { 
				text: tool.icon,
				cls: this.currentTool === tool.name ? 'active' : ''
			});
			this.styleToolButton(button, this.currentTool === tool.name);
			
			button.addEventListener('click', () => {
				this.currentTool = tool.name;
				if (this.canvas) {
					this.canvas.style.cursor = tool.cursor;
				}
				
				// Update active state
				toolbar.querySelectorAll('button').forEach(btn => {
					if (btn !== button && !btn.classList.contains('non-tool')) {
						this.styleToolButton(btn as HTMLButtonElement, false);
					}
				});
				this.styleToolButton(button, true);
			});
		});
		
		// Separator
		const separator1 = toolbar.createEl('div');
		separator1.style.cssText = 'width: 1px; height: 24px; background: var(--background-modifier-border); margin: 0 4px;';
		
		// History buttons
		const undoButton = toolbar.createEl('button', { text: '↶' });
		undoButton.classList.add('non-tool');
		this.styleToolButton(undoButton, false);
		undoButton.addEventListener('click', () => this.undo());
		
		const redoButton = toolbar.createEl('button', { text: '↷' });
		redoButton.classList.add('non-tool');
		this.styleToolButton(redoButton, false);
		redoButton.addEventListener('click', () => this.redo());
		
		const clearButton = toolbar.createEl('button', { text: '🗑️' });
		clearButton.classList.add('non-tool');
		this.styleToolButton(clearButton, false);
		clearButton.addEventListener('click', () => this.clearCanvas());
		
		// Separator
		const separator2 = toolbar.createEl('div');
		separator2.style.cssText = 'width: 1px; height: 24px; background: var(--background-modifier-border); margin: 0 4px;';
		
		// Color picker
		const colorPicker = toolbar.createEl('input', { type: 'color' });
		colorPicker.value = this.currentColor;
		colorPicker.style.cssText = `
			width: 32px;
			height: 32px;
			border: none;
			border-radius: 4px;
			cursor: pointer;
			background: none;
		`;
		// Add both input (real-time) and change (final) event listeners for color picker
		colorPicker.addEventListener('input', (e) => {
			this.currentColor = (e.target as HTMLInputElement).value;
			// Update stroke size button colors in real-time
			this.updateStrokeSizeButtonColors(toolbar);
		});
		
		colorPicker.addEventListener('change', (e) => {
			this.currentColor = (e.target as HTMLInputElement).value;
			// Update stroke size button colors when selection is finalized
			this.updateStrokeSizeButtonColors(toolbar);
		});
		
		// Stroke size buttons with colored circles
		const strokeSizeContainer = toolbar.createDiv({ cls: 'stroke-size-container' });
		strokeSizeContainer.style.cssText = `
			display: flex;
			align-items: center;
			gap: 4px;
			padding: 4px;
			border: 1px solid var(--background-modifier-border);
			border-radius: 4px;
			background: var(--background-primary);
		`;
		
		const strokeSizes: { size: StrokeSize, radius: number }[] = [
			{ size: 'small', radius: 2 },
			{ size: 'medium', radius: 4 },
			{ size: 'large', radius: 6 }
		];
		
		strokeSizes.forEach(({ size, radius }) => {
			const button = strokeSizeContainer.createEl('button');
			button.classList.add('non-tool', 'stroke-size');
			
			// Create SVG circle icon
			const svg = button.createSvg('svg');
			svg.setAttribute('width', '20');
			svg.setAttribute('height', '20');
			svg.setAttribute('viewBox', '0 0 20 20');
			
			const circle = svg.createSvg('circle');
			circle.setAttribute('cx', '10');
			circle.setAttribute('cy', '10');
			circle.setAttribute('r', radius.toString());
			circle.setAttribute('fill', this.currentColor);
			
			// Store circle element for color updates
			(button as any)._circle = circle;
			
			this.styleStrokeSizeButton(button, this.currentStrokeSize === size);
			
			button.addEventListener('click', () => {
				this.currentStrokeSize = size;
				// Update all stroke size buttons
				strokeSizeContainer.querySelectorAll('.stroke-size').forEach(btn => {
					this.styleStrokeSizeButton(btn as HTMLButtonElement, false);
				});
				this.styleStrokeSizeButton(button, true);
			});
		});
		
		// Store reference to update colors when color changes
		(toolbar as any)._strokeSizeContainer = strokeSizeContainer;
	}

	private styleToolButton(button: HTMLButtonElement, active: boolean) {
		button.style.cssText = `
			padding: 8px 12px;
			border: 1px solid var(--background-modifier-border);
			background: ${active ? 'var(--interactive-accent)' : 'var(--background-primary)'};
			color: ${active ? 'var(--text-on-accent)' : 'var(--text-normal)'};
			cursor: pointer;
			border-radius: 4px;
			font-size: 16px;
			min-width: 40px;
		`;
	}

	private styleStrokeSizeButton(button: HTMLButtonElement, active: boolean) {
		button.style.cssText = `
			padding: 4px;
			border: 2px solid ${active ? 'var(--interactive-accent)' : 'transparent'};
			background: var(--background-primary);
			cursor: pointer;
			border-radius: 4px;
			width: 28px;
			height: 28px;
			display: flex;
			align-items: center;
			justify-content: center;
		`;
	}
	
	private updateStrokeSizeButtonColors(toolbar: HTMLElement) {
		const strokeSizeContainer = (toolbar as any)._strokeSizeContainer;
		if (strokeSizeContainer) {
			strokeSizeContainer.querySelectorAll('.stroke-size').forEach((button: HTMLButtonElement) => {
				const circle = (button as any)._circle;
				if (circle) {
					circle.setAttribute('fill', this.currentColor);
				}
			});
		}
	}

	private createTextInputSection(section: HTMLElement) {
		section.style.cssText = `
			padding: 12px;
			background: var(--background-secondary);
			border-top: 1px solid var(--background-modifier-border);
			display: flex;
			flex-direction: column;
			gap: 6px;
		`;
		
		const label = section.createEl('label', { text: '图片描述（用于AI分析）:' });
		label.style.cssText = `
			font-size: 13px;
			font-weight: 500;
			color: var(--text-normal);
			flex-shrink: 0;
		`;
		
		this.textInput = section.createEl('textarea');
		this.textInput.placeholder = '输入图片描述、标注说明或相关信息...';
		this.textInput.style.cssText = `
			width: 100%;
			height: 50px;
			padding: 8px;
			border: 1px solid var(--background-modifier-border);
			background: var(--background-primary);
			color: var(--text-normal);
			border-radius: 4px;
			resize: none;
			font-family: inherit;
			font-size: 13px;
			box-sizing: border-box;
			flex: 1;
			min-width: 200px;
		`;
	}

	private createActionButtons(buttonBar: HTMLElement) {
		buttonBar.style.cssText = `
			display: flex;
			justify-content: flex-end;
			padding: 12px;
			background: var(--background-secondary);
			border-top: 1px solid var(--background-modifier-border);
			gap: 10px;
		`;
		
		const saveButton = buttonBar.createEl('button', { text: '保存并复制' });
		this.styleActionButton(saveButton, 'var(--interactive-accent)', 'var(--text-on-accent)');
		saveButton.addEventListener('click', () => this.saveAndCopyMarkdown());
	}

	private styleActionButton(button: HTMLButtonElement, bgColor: string, textColor: string) {
		button.style.cssText = `
			padding: 10px 20px;
			border: 1px solid var(--background-modifier-border);
			background: ${bgColor};
			color: ${textColor};
			cursor: pointer;
			border-radius: 4px;
			font-weight: 500;
			font-size: 14px;
		`;
	}

	private loadImage() {
		if (!this.canvas || !this.ctx) return;
		
		const img = new Image();
		img.onload = () => {
			if (!this.canvas || !this.ctx) return;
			
			// Get original image dimensions
			const originalWidth = img.width;
			const originalHeight = img.height;
			
			// Set canvas actual size to original image dimensions (for quality)
			this.canvas.width = originalWidth;
			this.canvas.height = originalHeight;
			
			// Draw image at full resolution  
			this.ctx.drawImage(img, 0, 0);
			
			// Get the container dimensions (available space for preview)
			const container = this.canvas.parentElement;
			if (container) {
				const containerRect = container.getBoundingClientRect();
				const availableWidth = containerRect.width - 40; // Leave some padding
				const availableHeight = containerRect.height - 40; // Leave some padding
				
				console.log('Container available space:', { width: availableWidth, height: availableHeight });
				console.log('Original image size:', { width: originalWidth, height: originalHeight });
				
				// Calculate scale ratios
				const scaleX = availableWidth / originalWidth;
				const scaleY = availableHeight / originalHeight;
				
				// Use the smaller scale to maintain aspect ratio
				const scale = Math.min(scaleX, scaleY, 1); // Don't scale up, only down
				
				// Calculate final display dimensions
				const displayWidth = Math.floor(originalWidth * scale);
				const displayHeight = Math.floor(originalHeight * scale);
				
				console.log('Scale calculation:', {
					scaleX,
					scaleY,
					finalScale: scale,
					displaySize: { width: displayWidth, height: displayHeight }
				});
				
				// Apply the calculated dimensions to canvas CSS
				this.canvas.style.width = displayWidth + 'px';
				this.canvas.style.height = displayHeight + 'px';
			}
			
			this.saveToHistory();
		};
		img.src = this.imageUrl;
	}

	private bindCanvasEvents() {
		if (!this.canvas) return;
		
		this.canvas.addEventListener('mousedown', (e) => this.handleCanvasMouseDown(e));
		this.canvas.addEventListener('mousemove', (e) => this.handleCanvasMouseMove(e));
		this.canvas.addEventListener('mouseup', (e) => this.handleCanvasMouseUp(e));
		this.canvas.addEventListener('mouseout', (e) => this.handleCanvasMouseOut(e));
	}

	private handleCanvasMouseDown(e: MouseEvent) {
		if (!this.canvas) return;
		
		const rect = this.canvas.getBoundingClientRect();
		this.lastX = (e.clientX - rect.left) * (this.canvas.width / rect.width);
		this.lastY = (e.clientY - rect.top) * (this.canvas.height / rect.height);
		this.isDrawing = true;
		
		this.saveToHistory();
	}

	private handleCanvasMouseMove(e: MouseEvent) {
		if (!this.isDrawing || !this.canvas || !this.ctx) return;
		
		const rect = this.canvas.getBoundingClientRect();
		const currentX = (e.clientX - rect.left) * (this.canvas.width / rect.width);
		const currentY = (e.clientY - rect.top) * (this.canvas.height / rect.height);
		
		switch (this.currentTool) {
			case 'pen':
				this.drawPen(currentX, currentY);
				break;
			case 'rectangle':
				this.drawRectangle(this.lastX, this.lastY, currentX, currentY);
				break;
			case 'circle':
				this.drawCircle(this.lastX, this.lastY, currentX, currentY);
				break;
			case 'arrow':
				this.drawArrow(this.lastX, this.lastY, currentX, currentY);
				break;
		}
		
		if (this.currentTool === 'pen') {
			this.lastX = currentX;
			this.lastY = currentY;
		}
	}

	private handleCanvasMouseUp(e: MouseEvent) {
		this.isDrawing = false;
	}

	private handleCanvasMouseOut(e: MouseEvent) {
		this.isDrawing = false;
	}

	private drawPen(x: number, y: number) {
		if (!this.ctx) return;
		
		this.ctx.lineWidth = this.strokeSettings[this.currentStrokeSize];
		this.ctx.lineCap = 'round';
		this.ctx.strokeStyle = this.currentColor;
		
		this.ctx.beginPath();
		this.ctx.moveTo(this.lastX, this.lastY);
		this.ctx.lineTo(x, y);
		this.ctx.stroke();
	}

	private drawRectangle(x1: number, y1: number, x2: number, y2: number) {
		if (!this.ctx) return;
		
		this.restoreFromHistory();
		
		this.ctx.lineWidth = this.strokeSettings[this.currentStrokeSize];
		this.ctx.strokeStyle = this.currentColor;
		
		const width = x2 - x1;
		const height = y2 - y1;
		
		this.ctx.strokeRect(x1, y1, width, height);
	}

	private drawCircle(x1: number, y1: number, x2: number, y2: number) {
		if (!this.ctx) return;
		
		this.restoreFromHistory();
		
		this.ctx.lineWidth = this.strokeSettings[this.currentStrokeSize];
		this.ctx.strokeStyle = this.currentColor;
		
		const radius = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
		
		this.ctx.beginPath();
		this.ctx.arc(x1, y1, radius, 0, 2 * Math.PI);
		this.ctx.stroke();
	}

	private drawArrow(x1: number, y1: number, x2: number, y2: number) {
		if (!this.ctx) return;
		
		this.restoreFromHistory();
		
		this.ctx.lineWidth = this.strokeSettings[this.currentStrokeSize];
		this.ctx.strokeStyle = this.currentColor;
		this.ctx.lineCap = 'round';
		this.ctx.lineJoin = 'round';
		
		// Calculate arrow properties
		const angle = Math.atan2(y2 - y1, x2 - x1);
		const arrowLength = Math.max(15, this.strokeSettings[this.currentStrokeSize] * 4);
		const arrowAngle = Math.PI / 6; // 30 degrees
		
		this.ctx.beginPath();
		// Main line
		this.ctx.moveTo(x1, y1);
		this.ctx.lineTo(x2, y2);
		
		// Arrow head - left side
		this.ctx.moveTo(x2, y2);
		this.ctx.lineTo(
			x2 - arrowLength * Math.cos(angle - arrowAngle),
			y2 - arrowLength * Math.sin(angle - arrowAngle)
		);
		
		// Arrow head - right side
		this.ctx.moveTo(x2, y2);
		this.ctx.lineTo(
			x2 - arrowLength * Math.cos(angle + arrowAngle),
			y2 - arrowLength * Math.sin(angle + arrowAngle)
		);
		
		this.ctx.stroke();
	}

	private saveToHistory() {
		if (!this.ctx || !this.canvas) return;
		
		const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
		this.history = this.history.slice(0, this.historyIndex + 1);
		this.history.push(imageData);
		this.historyIndex = this.history.length - 1;
		
		if (this.history.length > 20) {
			this.history.shift();
			this.historyIndex--;
		}
	}

	private restoreFromHistory() {
		if (!this.ctx || this.historyIndex < 0 || this.historyIndex >= this.history.length) return;
		
		this.ctx.putImageData(this.history[this.historyIndex], 0, 0);
	}

	private undo() {
		if (this.historyIndex > 0) {
			this.historyIndex--;
			this.restoreFromHistory();
		}
	}

	private redo() {
		if (this.historyIndex < this.history.length - 1) {
			this.historyIndex++;
			this.restoreFromHistory();
		}
	}

	private clearCanvas() {
		if (!this.ctx || !this.canvas) return;
		
		const img = new Image();
		img.onload = () => {
			if (!this.canvas || !this.ctx) return;
			
			this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
			this.ctx.drawImage(img, 0, 0);
			this.saveToHistory();
		};
		img.src = this.originalImageData;
	}

	private async saveAndCopyMarkdown() {
		if (!this.canvas) return;
		
		try {
			// Get the canvas data
			const dataUrl = this.canvas.toDataURL('image/png');
			
			// Generate filename
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
			const fileName = `screenshot-${timestamp}.png`;
			
			// Get text content
			const textContent = this.textInput?.value?.trim() || '';
			
			// Create markdown content with image and text
			let markdownContent = '';
			
			if (textContent) {
				// Image with alt text + description below
				markdownContent = `![${textContent}](${fileName})\n\n${textContent}`;
			} else {
				// Just image without description
				markdownContent = `![Screenshot](${fileName})`;
			}
			
			// Copy markdown text to clipboard
			await navigator.clipboard.writeText(markdownContent);
			
			// Show success message
			if (textContent) {
				new Notice(`✅ Markdown内容已复制！\n图片: ${fileName}\n描述: ${textContent.slice(0, 30)}${textContent.length > 30 ? '...' : ''}`);
			} else {
				new Notice(`✅ 图片Markdown已复制！\n文件: ${fileName}`);
			}
			
			// Also save the image to vault for the markdown to work
			await this.saveImageToVault(dataUrl, fileName);
			
			this.close();
			
		} catch (error: any) {
			new Notice(`❌ 复制失败: ${error.message}`);
			console.error('Save and copy markdown failed:', error);
		}
	}
	
	private async saveImageToVault(dataUrl: string, fileName: string) {
		try {
			// Convert dataUrl to binary data
			const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
			const binaryData = atob(base64Data);
			const bytes = new Uint8Array(binaryData.length);
			for (let i = 0; i < binaryData.length; i++) {
				bytes[i] = binaryData.charCodeAt(i);
			}
			
			// Save to vault's attachments folder or root
			const vault = this.plugin.app.vault;
			const adapter = vault.adapter;
			
			// Try to get the attachments folder, fallback to root
			let savePath = fileName;
			const attachmentFolderPath = this.plugin.app.vault.getConfig('attachmentFolderPath');
			if (attachmentFolderPath && attachmentFolderPath !== '/') {
				// Ensure attachment folder exists
				if (!await vault.adapter.exists(attachmentFolderPath)) {
					await vault.createFolder(attachmentFolderPath);
				}
				savePath = `${attachmentFolderPath}/${fileName}`;
			}
			
			// Write file to vault
			await vault.adapter.writeBinary(savePath, bytes.buffer);
			
			console.log('Image saved to vault:', savePath);
			
		} catch (error: any) {
			console.error('Failed to save image to vault:', error);
			// Don't throw error, just log it since the main copy function should still work
		}
	}

	cleanup() {
		this.close();
	}
}