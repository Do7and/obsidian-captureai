import { Modal, Notice } from 'obsidian';
import ImageCapturePlugin from '../main';
import { EditTool, Region, StrokeSize, StrokeSetting, LLM_PROVIDERS } from '../types';

export class ImageEditor extends Modal {
	private plugin: ImageCapturePlugin;
	private imageUrl: string = '';
	private region: Region = {x: 0, y: 0, width: 0, height: 0};
	private extendedRegion: Region | null = null;
	private originalFullScreenshot: string = ''; // Complete original screenshot
	private canvas: HTMLCanvasElement | null = null;
	private ctx: CanvasRenderingContext2D | null = null;
	private currentTool: string = 'pen';
	private currentColor: string = '#2563eb'; // 蓝色
	private currentStrokeSize: StrokeSize = 'medium';
	private highlighterColor: string = '#ffff00'; // 黄色
	private highlighterStrokeSize: StrokeSize = 'large';
	private isHighlighterMode: boolean = false;
	private isDrawing = false;
	private lastX = 0;
	private lastY = 0;
	private history: ImageData[] = [];
	private historyIndex = -1;
	private originalImageData: string = '';
	private textInput: HTMLTextAreaElement | null = null;
	
	// Four-layer system simulation properties
	// Layer 1: Preview page with center hole (handled by UI)
	// Layer 2: Semi-transparent mask with transparent crop area
	// Layer 3: Edit layer - all drawings, same size as full screenshot
	// Layer 4: Full screenshot background
	
	// Crop functionality properties - FIXED crop frame
	private cropModeActive = false;
	private cropRect = { x: 0, y: 0, width: 0, height: 0 }; // Fixed position crop frame
	
	// Background and edit layers offset (what the hand tool moves)
	private layersOffset = { x: 0, y: 0 }; // Offset for both background and edit layer
	private isDraggingLayers = false;
	private layersDragStart = { x: 0, y: 0 };
	private layersStartOffset = { x: 0, y: 0 };
	
	// Crop frame resizing
	private isResizingCrop = false;
	private resizeHandle: string | null = null; // 'top', 'bottom', 'left', 'right'
	private cropResizeStart = { x: 0, y: 0 };
	private originalCropRect = { x: 0, y: 0, width: 0, height: 0 };
	
	// Full screenshot dimensions and image
	private fullScreenshotSize = { width: 0, height: 0 };
	private fullScreenshotImage: HTMLImageElement | null = null;
	
	// Edit layer - stores all drawing operations in full screenshot coordinates
	private editLayerCanvas: HTMLCanvasElement | null = null;
	private editLayerCtx: CanvasRenderingContext2D | null = null;
	// Backup for temporary preview operations
	private editLayerBackup: ImageData | null = null;
	
	private strokeSettings: Record<StrokeSize, number> = {
		small: 1,
		medium: 3,
		large: 6
	};

	private highlighterStrokeSettings: Record<StrokeSize, number> = {
		small: 8,
		medium: 15,
		large: 25
	};

	constructor(plugin: ImageCapturePlugin) {
		super(plugin.app);
		this.plugin = plugin;
		this.modalEl.addClass('image-editor-modal');
	}

	showEditor(imageUrl: string, region: Region, extendedRegion?: Region, originalFullScreenshot?: string) {
		this.imageUrl = imageUrl;
		this.originalImageData = imageUrl;
		this.region = region;
		this.extendedRegion = extendedRegion || null;
		
		// Store original full screenshot for four-layer architecture
		this.originalFullScreenshot = originalFullScreenshot || imageUrl;
		
		// Calculate display dimensions based on extended region (1.2x area)
		let displayWidth, displayHeight;
		// For fullScreenshotSize, we need to get the actual full screen size from the image
		const tempImg = new Image();
		tempImg.src = imageUrl;
		
		if (extendedRegion) {
			// Use extended region for display
			displayWidth = extendedRegion.width;
			displayHeight = extendedRegion.height;
			
			// IMPORTANT: imageUrl contains the full screenshot, so use its dimensions
			// We'll set this after the image loads
			this.fullScreenshotSize = {
				width: 0, // Will be set in loadImage
				height: 0 // Will be set in loadImage
			};
		} else {
			// Fallback to original region
			displayWidth = region.width;
			displayHeight = region.height;
			
			this.fullScreenshotSize = {
				width: 0, // Will be set in loadImage
				height: 0 // Will be set in loadImage
			};
		}
		
		// Initialize FIXED crop rectangle (this never moves)
		if (extendedRegion) {
			// Calculate where the crop frame should be positioned (center of canvas)
			this.cropRect = {
				x: (displayWidth - region.width) / 2,
				y: (displayHeight - region.height) / 2,
				width: region.width,
				height: region.height
			};
			
			// IMPORTANT: Now we need to calculate offset for the FULL screenshot
			// The original region coordinates are relative to the full screenshot
			// We want the original selection to appear in the crop frame
			this.layersOffset = {
				x: this.cropRect.x - region.x,
				y: this.cropRect.y - region.y
			};
		} else {
			// No extended region, crop rect covers entire image, no offset needed
			this.cropRect = {
				x: 0,
				y: 0,
				width: region.width,
				height: region.height
			};
			
			this.layersOffset = { x: 0, y: 0 };
		}
		
		// Enable crop frame by default for extended regions
		this.cropModeActive = !!extendedRegion;
		
		// Calculate modal size (same as before)
		const toolbarHeight = 60;
		const textSectionHeight = 100;
		const buttonBarHeight = 60;
		
		const minModalWidth = 500;
		const minModalHeight = 400;
		
		const maxModalWidth = window.innerWidth * 0.9;
		const maxModalHeight = window.innerHeight * 0.9;
		
		const preferredModalWidth = displayWidth + 140;
		const preferredModalHeight = displayHeight + toolbarHeight + textSectionHeight + buttonBarHeight + 80;
		
		const modalWidth = Math.max(Math.min(preferredModalWidth, maxModalWidth), minModalWidth);
		const modalHeight = Math.max(Math.min(preferredModalHeight, maxModalHeight), minModalHeight);
		
		console.log('Four-layer system setup:', {
			region: { width: region.width, height: region.height },
			extendedRegion: extendedRegion,
			fullScreenshotSize: this.fullScreenshotSize,
			fixedCropRect: this.cropRect,
			initialLayersOffset: this.layersOffset
		});
		
		// Store dimensions for use in onOpen
		(this as any).calculatedModalWidth = modalWidth;
		(this as any).calculatedModalHeight = modalHeight;
		(this as any).calculatedCanvasWidth = displayWidth;
		(this as any).calculatedCanvasHeight = displayHeight;
		
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
			{ name: 'highlighter', icon: '🖍️', cursor: 'crosshair' },
			{ name: 'line', icon: '📏', cursor: 'crosshair' },
			{ name: 'wavy-line', icon: '〰️', cursor: 'crosshair' },
			{ name: 'dashed-line', icon: '┅', cursor: 'crosshair' },
			{ name: 'dotted-line', icon: '┈', cursor: 'crosshair' },
			{ name: 'rectangle', icon: '⬜', cursor: 'crosshair' },
			{ name: 'circle', icon: '⭕', cursor: 'crosshair' },
			{ name: 'arrow', icon: '➡️', cursor: 'crosshair' },
			{ name: 'hand', icon: '👋', cursor: 'crosshair' }
		];
		
		tools.forEach(tool => {
			const button = toolbar.createEl('button', { 
				text: tool.icon,
				cls: this.currentTool === tool.name ? 'active' : ''
			});
			this.styleToolButton(button, this.currentTool === tool.name);
			
				button.addEventListener('click', () => {
					this.currentTool = tool.name;
					
					// Switch between normal and highlighter mode
					if (tool.name === 'highlighter') {
						this.isHighlighterMode = true;
					} else {
						this.isHighlighterMode = false;
					}
					
					// Update cursor based on tool
					if (this.canvas) {
						if (tool.name === 'hand' && this.cropModeActive) {
							this.canvas.style.cursor = 'move';
						} else {
							this.canvas.style.cursor = tool.cursor;
						}
					}
					
					// Update active state
					toolbar.querySelectorAll('button').forEach(btn => {
						if (btn !== button && !btn.classList.contains('non-tool')) {
							this.styleToolButton(btn as HTMLButtonElement, false);
						}
					});
				this.styleToolButton(button, true);
				
				// Update color picker and stroke size buttons when switching modes
				this.updateColorAndStrokeDisplay(toolbar);
				
				// Force update stroke size button colors immediately
				setTimeout(() => {
					this.updateStrokeSizeButtonColors(toolbar);
				}, 0);
			});
		});
		
		// Separator
		const separator1 = toolbar.createEl('div');
		separator1.style.cssText = 'width: 1px; height: 24px; background: var(--background-modifier-border); margin: 0 4px;';
		
		// Note: Crop frame is automatically shown for extended regions
		
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
			const newColor = (e.target as HTMLInputElement).value;
			if (this.isHighlighterMode) {
				this.highlighterColor = newColor;
			} else {
				this.currentColor = newColor;
			}
			// Update stroke size button colors in real-time
			this.updateStrokeSizeButtonColors(toolbar);
		});
		
		colorPicker.addEventListener('change', (e) => {
			const newColor = (e.target as HTMLInputElement).value;
			if (this.isHighlighterMode) {
				this.highlighterColor = newColor;
			} else {
				this.currentColor = newColor;
			}
			// Update stroke size button colors when selection is finalized
			this.updateStrokeSizeButtonColors(toolbar);
		});
		
		// Store reference for updating when switching modes
		(toolbar as any)._colorPicker = colorPicker;
		
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
			circle.setAttribute('fill', this.getCurrentColor());
			
			// Store circle element and original radius for updates
			(button as any)._circle = circle;
			(button as any)._originalRadius = radius;
			(button as any)._size = size;
			
			this.styleStrokeSizeButton(button, this.getCurrentStrokeSize() === size);
			
			button.addEventListener('click', () => {
				if (this.isHighlighterMode) {
					this.highlighterStrokeSize = size;
				} else {
					this.currentStrokeSize = size;
				}
				// Update all stroke size buttons
				this.updateStrokeSizeButtons(strokeSizeContainer);
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

	private getCurrentColor(): string {
		return this.isHighlighterMode ? this.highlighterColor : this.currentColor;
	}

	private getCurrentStrokeSize(): StrokeSize {
		return this.isHighlighterMode ? this.highlighterStrokeSize : this.currentStrokeSize;
	}

	private getCurrentStrokeWidth(): number {
		const size = this.getCurrentStrokeSize();
		return this.isHighlighterMode ? this.highlighterStrokeSettings[size] : this.strokeSettings[size];
	}

	private updateColorAndStrokeDisplay(toolbar: HTMLElement): void {
		const colorPicker = (toolbar as any)._colorPicker as HTMLInputElement;
		const strokeSizeContainer = (toolbar as any)._strokeSizeContainer as HTMLElement;
		
		if (colorPicker) {
			colorPicker.value = this.getCurrentColor();
		}
		
		if (strokeSizeContainer) {
			this.updateStrokeSizeButtons(strokeSizeContainer);
			// Force immediate color update
			this.updateStrokeSizeButtonColors(toolbar);
		}
	}

	private updateStrokeSizeButtons(container: HTMLElement): void {
		container.querySelectorAll('.stroke-size').forEach((button: HTMLButtonElement) => {
			const size = (button as any)._size as StrokeSize;
			const circle = (button as any)._circle;
			const originalRadius = (button as any)._originalRadius;
			
			if (circle && originalRadius) {
				// Update circle size based on mode
				let displayRadius = originalRadius;
				if (this.isHighlighterMode) {
					// Make highlighter circles larger to show the difference
					displayRadius = Math.min(originalRadius + 3, 8);
				}
				circle.setAttribute('r', displayRadius.toString());
				circle.setAttribute('fill', this.getCurrentColor());
			}
			
			this.styleStrokeSizeButton(button, this.getCurrentStrokeSize() === size);
		});
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
					// Use getCurrentColor() to get the correct color based on current mode
					circle.setAttribute('fill', this.getCurrentColor());
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
		
		const label = section.createEl('label', { text: '图片描述:' });
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
		
		// Check if AI is enabled and if we have any vision-capable models
		const aiEnabled = this.plugin.settings.enableAIAnalysis;
		const visionModels = this.plugin.settings.modelConfigs.filter(mc => mc.isVisionCapable);
		const defaultModel = this.plugin.settings.modelConfigs.find(mc => mc.id === this.plugin.settings.defaultModelConfigId);
		const hasValidModel = defaultModel && defaultModel.isVisionCapable;
		
		// Check if the default model's provider has valid credentials
		let hasValidCredentials = false;
		if (hasValidModel) {
			const credentials = this.plugin.settings.providerCredentials[defaultModel.providerId];
			hasValidCredentials = credentials && credentials.verified && credentials.apiKey.trim() !== '';
		}
		
		const aiButtonEnabled = aiEnabled && hasValidModel && hasValidCredentials;

		// Save and Send to AI button
		if (aiEnabled) {
			const aiButton = buttonBar.createEl('button', { text: '保存并发给AI' });
			if (aiButtonEnabled) {
				this.styleActionButton(aiButton, 'var(--interactive-accent-hover)', 'var(--text-on-accent)');
			} else {
				this.styleActionButton(aiButton, 'var(--background-modifier-border)', 'var(--text-muted)');
				aiButton.disabled = true;
				
				// Add tooltip for disabled state
				let tooltip = '';
				if (visionModels.length === 0) {
					tooltip = 'No vision-capable models configured. Use Settings > Set Keys to add models.';
				} else if (!hasValidModel) {
					tooltip = 'No default model selected or model does not support vision';
				} else if (!hasValidCredentials) {
					tooltip = 'API credentials not verified. Use Settings > Set Keys to verify.';
				}
				aiButton.title = tooltip;
			}
			aiButton.addEventListener('click', () => {
				if (aiButtonEnabled) {
					this.saveAndSendToAI();
				}
			});
		}
		
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
		
		// First load the original full screenshot to get correct dimensions
		const fullImg = new Image();
		fullImg.onload = () => {
			// Set the correct full screenshot size from the original complete screenshot
			this.fullScreenshotSize = {
				width: fullImg.width,
				height: fullImg.height
			};
			
			console.log('🔍 Full screenshot size set from original:', this.fullScreenshotSize);
			console.log('🔍 Region:', this.region);
			console.log('🔍 Extended region:', this.extendedRegion);
			console.log('🔍 Initial layers offset:', this.layersOffset);
			
			// Create edit layer canvas (same size as full screenshot)
			this.editLayerCanvas = document.createElement('canvas');
			this.editLayerCtx = this.editLayerCanvas.getContext('2d')!;
			this.editLayerCanvas.width = this.fullScreenshotSize.width;
			this.editLayerCanvas.height = this.fullScreenshotSize.height;
			
			// Store full screenshot image for layer 4
			this.fullScreenshotImage = fullImg;
			
			// Now load the display image (extended region)
			const displayImg = new Image();
			displayImg.onload = () => {
				if (!this.canvas || !this.ctx) return;
				
				// Get display dimensions
				const displayWidth = (this as any).calculatedCanvasWidth || displayImg.width;
				const displayHeight = (this as any).calculatedCanvasHeight || displayImg.height;
				
				// Set main canvas size to display dimensions (viewport)
				this.canvas.width = displayWidth;
				this.canvas.height = displayHeight;
				
				// Initial render of all four layers
				this.renderAllLayers();
				
				// Calculate and apply display scaling
				const container = this.canvas.parentElement;
				if (container) {
					const containerRect = container.getBoundingClientRect();
					const availableWidth = containerRect.width - 40;
					const availableHeight = containerRect.height - 40;
					
					let finalDisplayWidth = displayWidth;
					let finalDisplayHeight = displayHeight;
					
					// Only scale down if the image is larger than available space
					if (displayWidth > availableWidth || displayHeight > availableHeight) {
						const scaleX = availableWidth / displayWidth;
						const scaleY = availableHeight / displayHeight;
						const scale = Math.min(scaleX, scaleY);
						
						finalDisplayWidth = Math.floor(displayWidth * scale);
						finalDisplayHeight = Math.floor(displayHeight * scale);
					}
					
					console.log('Four-layer display calculation:', {
						canvasSize: { width: displayWidth, height: displayHeight },
						fullScreenshotSize: this.fullScreenshotSize,
						availableSpace: { width: availableWidth, height: availableHeight },
						finalDisplaySize: { width: finalDisplayWidth, height: finalDisplayHeight }
					});
					
					// Apply the calculated dimensions to canvas CSS
					this.canvas.style.width = finalDisplayWidth + 'px';
					this.canvas.style.height = finalDisplayHeight + 'px';
				}
				
				this.saveToHistory();
			};
			displayImg.src = this.imageUrl; // Extended region image for display
		};
		fullImg.src = this.originalFullScreenshot; // Complete original screenshot
	}

	// Four-layer rendering system
	private renderAllLayers() {
		if (!this.canvas || !this.ctx) return;
		
		// Clear the main canvas (viewport)
		this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
		
		// Layer 4: Full screenshot background (with offset)
		this.renderBackgroundLayer();
		
		// Layer 3: Edit layer (with same offset as background)
		this.renderEditLayer();
		
		// Layer 2: Semi-transparent mask with transparent crop area
		this.renderSemiTransparentMask();
		
		// Layer 1: Preview page hole is handled by the UI structure
	}
	
	private renderBackgroundLayer() {
		if (!this.canvas || !this.ctx || !this.fullScreenshotImage) return;
		
		// Draw the full screenshot with current layers offset
		this.ctx.drawImage(
			this.fullScreenshotImage,
			this.layersOffset.x, this.layersOffset.y,
			this.fullScreenshotSize.width, this.fullScreenshotSize.height
		);
	}
	
	private renderEditLayer() {
		if (!this.canvas || !this.ctx || !this.editLayerCanvas) return;
		
		// Draw the edit layer with the same offset as background
		// This ensures drawings move with the background
		this.ctx.drawImage(
			this.editLayerCanvas,
			this.layersOffset.x, this.layersOffset.y,
			this.fullScreenshotSize.width, this.fullScreenshotSize.height
		);
	}
	
	private renderSemiTransparentMask() {
		if (!this.canvas || !this.ctx || !this.cropModeActive) return;
		
		// Save current state
		this.ctx.save();
		
		// Set global composite operation to draw semi-transparent overlay
		this.ctx.globalCompositeOperation = 'source-over';
		
		// Draw semi-transparent overlay outside the crop area
		this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
		
		// Draw overlay in 4 rectangles around the crop area
		// Top rectangle
		this.ctx.fillRect(0, 0, this.canvas.width, this.cropRect.y);
		// Bottom rectangle  
		this.ctx.fillRect(0, this.cropRect.y + this.cropRect.height, this.canvas.width, this.canvas.height - (this.cropRect.y + this.cropRect.height));
		// Left rectangle
		this.ctx.fillRect(0, this.cropRect.y, this.cropRect.x, this.cropRect.height);
		// Right rectangle
		this.ctx.fillRect(this.cropRect.x + this.cropRect.width, this.cropRect.y, this.canvas.width - (this.cropRect.x + this.cropRect.width), this.cropRect.height);
		
		// Draw crop frame border
		this.ctx.strokeStyle = '#ffffff';
		this.ctx.lineWidth = 2;
		this.ctx.setLineDash([]);
		this.ctx.strokeRect(this.cropRect.x, this.cropRect.y, this.cropRect.width, this.cropRect.height);
		
		// Draw inner border for better visibility
		this.ctx.strokeStyle = '#000000';
		this.ctx.lineWidth = 1;
		this.ctx.strokeRect(this.cropRect.x + 1, this.cropRect.y + 1, this.cropRect.width - 2, this.cropRect.height - 2);
		
		// Restore state
		this.ctx.restore();
	}

	private bindCanvasEvents() {
		if (!this.canvas) return;
		
		this.canvas.addEventListener('mousedown', (e) => this.handleCanvasMouseDown(e));
		this.canvas.addEventListener('mousemove', (e) => this.handleCanvasMouseMove(e));
		this.canvas.addEventListener('mouseup', (e) => this.handleCanvasMouseUp(e));
		this.canvas.addEventListener('mouseout', (e) => this.handleCanvasMouseOut(e));
		
		// Add global mouse event listeners for layer dragging
		document.addEventListener('mousemove', (e) => this.handleGlobalMouseMove(e));
		document.addEventListener('mouseup', (e) => this.handleGlobalMouseUp(e));
	}

	private handleCanvasMouseDown(e: MouseEvent) {
		if (!this.canvas) return;
		
		const rect = this.canvas.getBoundingClientRect();
		const canvasX = (e.clientX - rect.left) * (this.canvas.width / rect.width);
		const canvasY = (e.clientY - rect.top) * (this.canvas.height / rect.height);
		
		// Priority 1: Check for crop frame resizing (only in crop mode)
		if (this.cropModeActive) {
			const resizeHandle = this.getCropResizeHandle(canvasX, canvasY);
			if (resizeHandle) {
				this.isResizingCrop = true;
				this.resizeHandle = resizeHandle;
				this.cropResizeStart = { x: e.clientX, y: e.clientY };
				this.originalCropRect = { ...this.cropRect };
				return;
			}
		}
		
		// Priority 2: Hand tool for layer dragging
		if (this.currentTool === 'hand' && this.cropModeActive) {
			this.isDraggingLayers = true;
			this.layersDragStart = { x: e.clientX, y: e.clientY };
			this.layersStartOffset = { ...this.layersOffset };
			return;
		}
		
		// Priority 3: Drawing tools - convert to full screenshot coordinates
		const fullScreenshotX = canvasX - this.layersOffset.x;
		const fullScreenshotY = canvasY - this.layersOffset.y;
		
		// Check if drawing within full screenshot bounds
		if (fullScreenshotX >= 0 && fullScreenshotX <= this.fullScreenshotSize.width &&
			fullScreenshotY >= 0 && fullScreenshotY <= this.fullScreenshotSize.height) {
			
			// For shape tools, create a backup of current edit layer
			if (['line', 'wavy-line', 'dashed-line', 'dotted-line', 'rectangle', 'circle', 'arrow'].includes(this.currentTool) && this.editLayerCtx && this.editLayerCanvas) {
				this.editLayerBackup = this.editLayerCtx.getImageData(0, 0, this.editLayerCanvas.width, this.editLayerCanvas.height);
			}
			
			this.lastX = fullScreenshotX;
			this.lastY = fullScreenshotY;
			this.isDrawing = true;
			this.saveToHistory();
		}
	}

	private handleCanvasMouseMove(e: MouseEvent) {
		if (!this.canvas) return;
		
		const rect = this.canvas.getBoundingClientRect();
		const canvasX = (e.clientX - rect.left) * (this.canvas.width / rect.width);
		const canvasY = (e.clientY - rect.top) * (this.canvas.height / rect.height);
		
		// Handle crop frame resizing
		if (this.isResizingCrop && this.resizeHandle) {
			const deltaX = e.clientX - this.cropResizeStart.x;
			const deltaY = e.clientY - this.cropResizeStart.y;
			
			// Apply resize based on handle
			switch (this.resizeHandle) {
				case 'left':
					this.cropRect.x = this.originalCropRect.x + deltaX;
					this.cropRect.width = this.originalCropRect.width - deltaX;
					break;
				case 'right':
					this.cropRect.width = this.originalCropRect.width + deltaX;
					break;
				case 'top':
					this.cropRect.y = this.originalCropRect.y + deltaY;
					this.cropRect.height = this.originalCropRect.height - deltaY;
					break;
				case 'bottom':
					this.cropRect.height = this.originalCropRect.height + deltaY;
					break;
			}
			
			// Ensure minimum size
			this.cropRect.width = Math.max(50, this.cropRect.width);
			this.cropRect.height = Math.max(50, this.cropRect.height);
			
			// Re-render all layers
			this.renderAllLayers();
			return;
		}
		
		// Update cursor based on hover state
		if (this.cropModeActive && this.canvas) {
			const resizeHandle = this.getCropResizeHandle(canvasX, canvasY);
			if (resizeHandle) {
				switch (resizeHandle) {
					case 'left':
					case 'right':
						this.canvas.style.cursor = 'ew-resize';
						break;
					case 'top':
					case 'bottom':
						this.canvas.style.cursor = 'ns-resize';
						break;
				}
			} else if (this.currentTool === 'hand') {
				this.canvas.style.cursor = 'move';
			} else {
				this.canvas.style.cursor = 'crosshair';
			}
		}
		
		// Handle layer dragging with hand tool
		if (this.isDraggingLayers) {
			const deltaX = e.clientX - this.layersDragStart.x;
			const deltaY = e.clientY - this.layersDragStart.y;
			
			this.layersOffset.x = this.layersStartOffset.x + deltaX;
			this.layersOffset.y = this.layersStartOffset.y + deltaY;
			
			// Re-render all layers with new offset
			this.renderAllLayers();
			return;
		}
		
		// Handle drawing - convert to full screenshot coordinates
		if (this.isDrawing && this.editLayerCtx) {
			const fullScreenshotX = canvasX - this.layersOffset.x;
			const fullScreenshotY = canvasY - this.layersOffset.y;
			
			// Check if still within full screenshot bounds
			if (fullScreenshotX >= 0 && fullScreenshotX <= this.fullScreenshotSize.width &&
				fullScreenshotY >= 0 && fullScreenshotY <= this.fullScreenshotSize.height) {
				
				// Draw on edit layer (layer 3)
				this.drawOnEditLayer(fullScreenshotX, fullScreenshotY);
				
				// Update last position
				if (this.currentTool === 'pen' || this.currentTool === 'highlighter') {
					this.lastX = fullScreenshotX;
					this.lastY = fullScreenshotY;
				}
				
				// Re-render all layers to show the drawing
				this.renderAllLayers();
			}
		}
	}
	
	private drawOnEditLayer(x: number, y: number) {
		if (!this.editLayerCtx) return;
		
		// Set drawing properties
		this.editLayerCtx.lineWidth = this.getCurrentStrokeWidth();
		this.editLayerCtx.lineCap = 'round';
		this.editLayerCtx.strokeStyle = this.getCurrentColor();
		
		// Special handling for highlighter
		if (this.currentTool === 'highlighter') {
			this.editLayerCtx.globalCompositeOperation = 'multiply';
			this.editLayerCtx.globalAlpha = 0.3; // Lower alpha for multiply mode to achieve transparency
		} else {
			this.editLayerCtx.globalCompositeOperation = 'source-over';
			this.editLayerCtx.globalAlpha = 1;
		}
		
		switch (this.currentTool) {
			case 'pen':
			case 'highlighter':
				this.editLayerCtx.beginPath();
				this.editLayerCtx.moveTo(this.lastX, this.lastY);
				this.editLayerCtx.lineTo(x, y);
				this.editLayerCtx.stroke();
				break;
				
			case 'line':
			case 'wavy-line':
			case 'dashed-line':
			case 'dotted-line':
			case 'rectangle':
			case 'circle':
			case 'arrow':
				// For all shape tools, restore backup and draw preview
				if (this.editLayerBackup) {
					this.editLayerCtx.putImageData(this.editLayerBackup, 0, 0);
				}
				
				// Call the appropriate drawing method based on tool
				switch (this.currentTool) {
					case 'line':
						this.editLayerCtx.beginPath();
						this.editLayerCtx.moveTo(this.lastX, this.lastY);
						this.editLayerCtx.lineTo(x, y);
						this.editLayerCtx.stroke();
						break;
					case 'wavy-line':
						this.drawWavyLineOnEditLayer(this.lastX, this.lastY, x, y);
						break;
					case 'dashed-line':
						this.drawDashedLineOnEditLayer(this.lastX, this.lastY, x, y);
						break;
					case 'dotted-line':
						this.drawDottedLineOnEditLayer(this.lastX, this.lastY, x, y);
						break;
					case 'rectangle':
						this.drawRectangleOnEditLayer(this.lastX, this.lastY, x, y);
						break;
					case 'circle':
						this.drawCircleOnEditLayer(this.lastX, this.lastY, x, y);
						break;
					case 'arrow':
						this.drawArrowOnEditLayer(this.lastX, this.lastY, x, y);
						break;
				}
				break;
		}
		
		// Reset composition mode
		this.editLayerCtx.globalCompositeOperation = 'source-over';
		this.editLayerCtx.globalAlpha = 1;
	}
	
	// Edit layer versions of drawing methods
	private drawWavyLineOnEditLayer(x1: number, y1: number, x2: number, y2: number) {
		// Calculate wave parameters
		const distance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
		const amplitude = Math.max(5, this.getCurrentStrokeWidth() * 2);
		const frequency = distance / 40; // Number of waves
		
		this.editLayerCtx!.beginPath();
		this.editLayerCtx!.moveTo(x1, y1);
		
		// Draw wavy line
		for (let i = 0; i <= 100; i++) {
			const t = i / 100;
			const x = x1 + (x2 - x1) * t;
			const y = y1 + (y2 - y1) * t;
			
			// Calculate perpendicular offset for wave
			const angle = Math.atan2(y2 - y1, x2 - x1) + Math.PI / 2;
			const waveOffset = Math.sin(t * frequency * Math.PI * 2) * amplitude;
			
			const waveX = x + Math.cos(angle) * waveOffset;
			const waveY = y + Math.sin(angle) * waveOffset;
			
			this.editLayerCtx!.lineTo(waveX, waveY);
		}
		
		this.editLayerCtx!.stroke();
	}
	
	private drawDashedLineOnEditLayer(x1: number, y1: number, x2: number, y2: number) {
		// Set dash pattern
		const dashLength = Math.max(8, this.getCurrentStrokeWidth() * 3);
		this.editLayerCtx!.setLineDash([dashLength, dashLength / 2]);
		
		this.editLayerCtx!.beginPath();
		this.editLayerCtx!.moveTo(x1, y1);
		this.editLayerCtx!.lineTo(x2, y2);
		this.editLayerCtx!.stroke();
		
		// Reset dash pattern
		this.editLayerCtx!.setLineDash([]);
	}
	
	private drawDottedLineOnEditLayer(x1: number, y1: number, x2: number, y2: number) {
		// Set dot pattern
		const dotSize = Math.max(2, this.getCurrentStrokeWidth());
		const spacing = dotSize * 3;
		this.editLayerCtx!.setLineDash([dotSize, spacing]);
		
		this.editLayerCtx!.beginPath();
		this.editLayerCtx!.moveTo(x1, y1);
		this.editLayerCtx!.lineTo(x2, y2);
		this.editLayerCtx!.stroke();
		
		// Reset dash pattern
		this.editLayerCtx!.setLineDash([]);
	}
	
	private drawRectangleOnEditLayer(x1: number, y1: number, x2: number, y2: number) {
		const width = x2 - x1;
		const height = y2 - y1;
		
		this.editLayerCtx!.strokeRect(x1, y1, width, height);
	}
	
	private drawCircleOnEditLayer(x1: number, y1: number, x2: number, y2: number) {
		const radius = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
		
		this.editLayerCtx!.beginPath();
		this.editLayerCtx!.arc(x1, y1, radius, 0, 2 * Math.PI);
		this.editLayerCtx!.stroke();
	}
	
	private drawArrowOnEditLayer(x1: number, y1: number, x2: number, y2: number) {
		// Calculate arrow properties
		const angle = Math.atan2(y2 - y1, x2 - x1);
		const arrowLength = Math.max(15, this.getCurrentStrokeWidth() * 4);
		const arrowAngle = Math.PI / 6; // 30 degrees
		
		this.editLayerCtx!.beginPath();
		// Main line
		this.editLayerCtx!.moveTo(x1, y1);
		this.editLayerCtx!.lineTo(x2, y2);
		
		// Arrow head - left side
		this.editLayerCtx!.moveTo(x2, y2);
		this.editLayerCtx!.lineTo(
			x2 - arrowLength * Math.cos(angle - arrowAngle),
			y2 - arrowLength * Math.sin(angle - arrowAngle)
		);
		
		// Arrow head - right side
		this.editLayerCtx!.moveTo(x2, y2);
		this.editLayerCtx!.lineTo(
			x2 - arrowLength * Math.cos(angle + arrowAngle),
			y2 - arrowLength * Math.sin(angle + arrowAngle)
		);
		
		this.editLayerCtx!.stroke();
	}
	
	// Helper method to detect crop resize handles
	private getCropResizeHandle(x: number, y: number): string | null {
		if (!this.cropModeActive) return null;
		
		const threshold = 10; // Pixels
		const rect = this.cropRect;
		
		// Check edges
		if (Math.abs(x - rect.x) < threshold && y >= rect.y - threshold && y <= rect.y + rect.height + threshold) {
			return 'left';
		}
		if (Math.abs(x - (rect.x + rect.width)) < threshold && y >= rect.y - threshold && y <= rect.y + rect.height + threshold) {
			return 'right';
		}
		if (Math.abs(y - rect.y) < threshold && x >= rect.x - threshold && x <= rect.x + rect.width + threshold) {
			return 'top';
		}
		if (Math.abs(y - (rect.y + rect.height)) < threshold && x >= rect.x - threshold && x <= rect.x + rect.width + threshold) {
			return 'bottom';
		}
		
		return null;
	}

	private handleCanvasMouseUp(e: MouseEvent) {
		// Handle crop resizing completion
		if (this.isResizingCrop) {
			this.isResizingCrop = false;
			this.resizeHandle = null;
			return;
		}
		
		// Handle layer dragging completion
		if (this.isDraggingLayers) {
			this.isDraggingLayers = false;
			return;
		}
		
		// Handle drawing completion
		if (this.isDrawing) {
			this.isDrawing = false;
			
			// For shape tools, clear the backup as drawing is complete
			if (['line', 'wavy-line', 'dashed-line', 'dotted-line', 'rectangle', 'circle', 'arrow'].includes(this.currentTool)) {
				this.editLayerBackup = null;
			}
			
			// Drawing content is already on edit layer, no need to redraw
		}
	}

	private handleCanvasMouseOut(e: MouseEvent) {
		this.isDrawing = false;
		// Also stop layer dragging if mouse leaves canvas
		if (this.isDraggingLayers) {
			this.isDraggingLayers = false;
		}
	}
	
	private handleGlobalMouseMove(e: MouseEvent) {
		// Handle layer dragging globally
		if (this.isDraggingLayers) {
			const deltaX = e.clientX - this.layersDragStart.x;
			const deltaY = e.clientY - this.layersDragStart.y;
			
			this.layersOffset.x = this.layersStartOffset.x + deltaX;
			this.layersOffset.y = this.layersStartOffset.y + deltaY;
			
			// Re-render all layers with new offset
			this.renderAllLayers();
		}
	}
	
	private handleGlobalMouseUp(e: MouseEvent) {
		// Handle layer dragging completion globally
		if (this.isDraggingLayers) {
			this.isDraggingLayers = false;
		}
	}


	private drawLine(x1: number, y1: number, x2: number, y2: number) {
		if (!this.ctx) return;
		
		this.restoreFromHistory();
		
		this.ctx.lineWidth = this.getCurrentStrokeWidth();
		this.ctx.strokeStyle = this.getCurrentColor();
		this.ctx.lineCap = 'round';
		
		this.ctx.beginPath();
		this.ctx.moveTo(x1, y1);
		this.ctx.lineTo(x2, y2);
		this.ctx.stroke();
	}

	private drawWavyLine(x1: number, y1: number, x2: number, y2: number) {
		if (!this.ctx) return;
		
		this.restoreFromHistory();
		
		this.ctx.lineWidth = this.getCurrentStrokeWidth();
		this.ctx.strokeStyle = this.getCurrentColor();
		this.ctx.lineCap = 'round';
		
		// Calculate wave parameters
		const distance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
		const amplitude = Math.max(5, this.getCurrentStrokeWidth() * 2);
		const frequency = distance / 40; // Number of waves
		
		this.ctx.beginPath();
		this.ctx.moveTo(x1, y1);
		
		// Draw wavy line
		for (let i = 0; i <= 100; i++) {
			const t = i / 100;
			const x = x1 + (x2 - x1) * t;
			const y = y1 + (y2 - y1) * t;
			
			// Calculate perpendicular offset for wave
			const angle = Math.atan2(y2 - y1, x2 - x1) + Math.PI / 2;
			const waveOffset = Math.sin(t * frequency * Math.PI * 2) * amplitude;
			
			const waveX = x + Math.cos(angle) * waveOffset;
			const waveY = y + Math.sin(angle) * waveOffset;
			
			this.ctx.lineTo(waveX, waveY);
		}
		
		this.ctx.stroke();
	}

	private drawDashedLine(x1: number, y1: number, x2: number, y2: number) {
		if (!this.ctx) return;
		
		this.restoreFromHistory();
		
		this.ctx.lineWidth = this.getCurrentStrokeWidth();
		this.ctx.strokeStyle = this.getCurrentColor();
		this.ctx.lineCap = 'round';
		
		// Set dash pattern
		const dashLength = Math.max(8, this.getCurrentStrokeWidth() * 3);
		this.ctx.setLineDash([dashLength, dashLength / 2]);
		
		this.ctx.beginPath();
		this.ctx.moveTo(x1, y1);
		this.ctx.lineTo(x2, y2);
		this.ctx.stroke();
		
		// Reset dash pattern
		this.ctx.setLineDash([]);
	}

	private drawDottedLine(x1: number, y1: number, x2: number, y2: number) {
		if (!this.ctx) return;
		
		this.restoreFromHistory();
		
		this.ctx.lineWidth = this.getCurrentStrokeWidth();
		this.ctx.strokeStyle = this.getCurrentColor();
		this.ctx.lineCap = 'round';
		
		// Set dot pattern
		const dotSize = Math.max(2, this.getCurrentStrokeWidth());
		const spacing = dotSize * 3;
		this.ctx.setLineDash([dotSize, spacing]);
		
		this.ctx.beginPath();
		this.ctx.moveTo(x1, y1);
		this.ctx.lineTo(x2, y2);
		this.ctx.stroke();
		
		// Reset dash pattern
		this.ctx.setLineDash([]);
	}

	private drawRectangle(x1: number, y1: number, x2: number, y2: number) {
		if (!this.ctx) return;
		
		this.restoreFromHistory();
		
		this.ctx.lineWidth = this.getCurrentStrokeWidth();
		this.ctx.strokeStyle = this.getCurrentColor();
		
		const width = x2 - x1;
		const height = y2 - y1;
		
		this.ctx.strokeRect(x1, y1, width, height);
	}

	private drawCircle(x1: number, y1: number, x2: number, y2: number) {
		if (!this.ctx) return;
		
		this.restoreFromHistory();
		
		this.ctx.lineWidth = this.getCurrentStrokeWidth();
		this.ctx.strokeStyle = this.getCurrentColor();
		
		const radius = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
		
		this.ctx.beginPath();
		this.ctx.arc(x1, y1, radius, 0, 2 * Math.PI);
		this.ctx.stroke();
	}

	private drawArrow(x1: number, y1: number, x2: number, y2: number) {
		if (!this.ctx) return;
		
		this.restoreFromHistory();
		
		this.ctx.lineWidth = this.getCurrentStrokeWidth();
		this.ctx.strokeStyle = this.getCurrentColor();
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
		if (!this.editLayerCtx || !this.editLayerCanvas) return;
		
		// Save the edit layer state (this is what contains all drawings)
		const imageData = this.editLayerCtx.getImageData(0, 0, this.editLayerCanvas.width, this.editLayerCanvas.height);
		this.history = this.history.slice(0, this.historyIndex + 1);
		this.history.push(imageData);
		this.historyIndex = this.history.length - 1;
		
		if (this.history.length > 20) {
			this.history.shift();
			this.historyIndex--;
		}
	}

	private restoreFromHistory() {
		if (!this.editLayerCtx || this.historyIndex < 0 || this.historyIndex >= this.history.length) return;
		
		// Restore the edit layer state and re-render all layers
		this.editLayerCtx.putImageData(this.history[this.historyIndex], 0, 0);
		this.renderAllLayers();
	}

	private undo() {
		if (this.historyIndex > 0) {
			this.historyIndex--;
			this.restoreFromHistory();
			
			// Re-render all layers after undo is already done in restoreFromHistory
		}
	}

	private redo() {
		if (this.historyIndex < this.history.length - 1) {
			this.historyIndex++;
			this.restoreFromHistory();
			
			// Re-render all layers after redo is already done in restoreFromHistory
		}
	}

	private clearCanvas() {
		if (!this.ctx || !this.canvas) return;
		
		// Clear the edit layer (layer 3)
		if (this.editLayerCtx && this.editLayerCanvas) {
			this.editLayerCtx.clearRect(0, 0, this.editLayerCanvas.width, this.editLayerCanvas.height);
		}
		
		// Re-render all layers to show the cleared edit layer
		this.renderAllLayers();
		
		this.saveToHistory();
	}

	private async saveAndCopyMarkdown() {
		if (!this.canvas) return;
		
		try {
			// Get the final cropped image
			const dataUrl = this.getFinalCroppedImage();
			
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
			const attachmentFolderPath = (this.plugin.app.vault as any).getConfig?.('attachmentFolderPath');
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

	private async saveAndSendToAI() {
		if (!this.canvas) return;
		
		try {
			// Get the final cropped image
			const dataUrl = this.getFinalCroppedImage();
			
			// Generate filename
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
			const fileName = `screenshot-${timestamp}.png`;
			
			// Get text content
			const textContent = this.textInput?.value?.trim() || '';
			
			// Show progress notice immediately
			const notice = new Notice('正在保存并发送图片给AI分析...', 0);
			
			// Close the editor modal immediately to give user feedback
			this.close();
			
			try {
				// Save the image to vault first
				await this.saveImageToVault(dataUrl, fileName);
				console.log('Image saved to vault:', fileName);
				
				// Send to AI for analysis
				await this.plugin.sendImageToAI(dataUrl, textContent, fileName);
				
				notice.hide();
				new Notice('✅ 图片已发送给AI分析，请查看右侧面板');
				
			} catch (aiError: any) {
				notice.hide();
				console.error('AI analysis failed:', aiError);
				new Notice(`❌ AI分析失败: ${aiError.message}`);
			}
			
		} catch (error: any) {
			console.error('Save and send to AI failed:', error);
			new Notice(`❌ 操作失败: ${error.message}`);
			
			// Close the editor if it's still open
			this.close();
		}
	}






	private setupCropOverlay() {
		// The crop overlay will be drawn on the canvas itself
		this.redrawCanvas();
	}

	private redrawCanvas() {
		if (!this.canvas || !this.ctx) return;
		
		// Redraw the base image
		const img = new Image();
		img.onload = () => {
			if (!this.canvas || !this.ctx) return;
			
			// Clear and redraw base image
			this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
			this.ctx.drawImage(img, 0, 0);
			
			// Redraw any previous edits from history
			if (this.history.length > 0 && this.historyIndex >= 0) {
				const currentState = this.history[this.historyIndex];
				this.ctx.putImageData(currentState, 0, 0);
			}
			
			// Draw crop overlay if in crop mode
			if (this.cropModeActive) {
				this.drawCropOverlay();
			}
		};
		img.src = this.imageUrl;
	}

	private drawCropOverlay() {
		if (!this.ctx || !this.canvas) return;
		
		// First, redraw the base image to clear any previous overlay
		const img = new Image();
		img.onload = () => {
			if (!this.canvas || !this.ctx) return;
			
			// Clear and redraw base image
			this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
			
			// If we have an extended region, draw the extended area
			if (this.extendedRegion) {
				this.ctx.drawImage(
					img,
					0, 0, img.width, img.height,  // Source: entire captured image
					0, 0, this.canvas.width, this.canvas.height  // Destination: canvas size
				);
			} else {
				this.ctx.drawImage(img, 0, 0);
			}
			
			// Redraw any previous edits from history (but don't include the overlay)
			if (this.history.length > 0 && this.historyIndex >= 0) {
				// We need to be careful here - only restore drawing edits, not overlay
				const currentState = this.history[this.historyIndex];
				// Create a temporary canvas to extract just the drawings
				const tempCanvas = document.createElement('canvas');
				const tempCtx = tempCanvas.getContext('2d')!;
				tempCanvas.width = this.canvas.width;
				tempCanvas.height = this.canvas.height;
				tempCtx.putImageData(currentState, 0, 0);
				
				// Now we need to extract just the drawing parts, not the overlay
				// For now, let's skip this to avoid complexity
			}
			
			// Now draw the crop overlay
			this.drawCropMask();
		};
		img.src = this.imageUrl;
	}
	
	private drawCropMask() {
		if (!this.ctx || !this.canvas) return;
		
		// Save current state
		this.ctx.save();
		
		// Set global composite operation to draw overlay
		this.ctx.globalCompositeOperation = 'source-over';
		
		// Draw semi-transparent overlay outside the crop area only
		this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
		
		// Draw overlay in 4 rectangles around the crop area
		// Top rectangle
		this.ctx.fillRect(0, 0, this.canvas.width, this.cropRect.y);
		// Bottom rectangle  
		this.ctx.fillRect(0, this.cropRect.y + this.cropRect.height, this.canvas.width, this.canvas.height - (this.cropRect.y + this.cropRect.height));
		// Left rectangle
		this.ctx.fillRect(0, this.cropRect.y, this.cropRect.x, this.cropRect.height);
		// Right rectangle
		this.ctx.fillRect(this.cropRect.x + this.cropRect.width, this.cropRect.y, this.canvas.width - (this.cropRect.x + this.cropRect.width), this.cropRect.height);
		
		// Draw crop border (visible border around the crop area)
		this.ctx.strokeStyle = '#ffffff';
		this.ctx.lineWidth = 2;
		this.ctx.setLineDash([]);
		this.ctx.strokeRect(this.cropRect.x, this.cropRect.y, this.cropRect.width, this.cropRect.height);
		
		// Draw inner border for better visibility
		this.ctx.strokeStyle = '#000000';
		this.ctx.lineWidth = 1;
		this.ctx.strokeRect(this.cropRect.x + 1, this.cropRect.y + 1, this.cropRect.width - 2, this.cropRect.height - 2);
		
		// Draw edge indicators for the new edge-only resizing system
		this.drawCropFrameEdges();
		
		// Restore state
		this.ctx.restore();
	}
	
	private redrawCanvasWithoutCrop() {
		if (!this.canvas || !this.ctx) return;
		
		const img = new Image();
		img.onload = () => {
			if (!this.canvas || !this.ctx) return;
			
			// Clear and redraw base image
			this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
			
			// If we have an extended region, draw the extended area
			if (this.extendedRegion) {
				this.ctx.drawImage(
					img,
					0, 0, img.width, img.height,  // Source: entire captured image
					0, 0, this.canvas.width, this.canvas.height  // Destination: canvas size
				);
			} else {
				this.ctx.drawImage(img, 0, 0);
			}
			
			// Redraw any previous edits from history
			if (this.history.length > 0 && this.historyIndex >= 0) {
				const currentState = this.history[this.historyIndex];
				// We need to carefully restore only the drawing parts, not overlays
				// For now, just restore the full state since we're not in crop mode
				this.ctx.putImageData(currentState, 0, 0);
			}
		};
		img.src = this.imageUrl;
	}

	// New fixed crop system - no resize handles, only edge detection
	private drawCropFrameEdges() {
		if (!this.ctx) return;
		
		// Draw edge indicators for resizing
		const edgeLength = 20;
		const edgeWidth = 3;
		
		this.ctx.strokeStyle = '#007ACC';
		this.ctx.lineWidth = edgeWidth;
		this.ctx.setLineDash([]);
		
		// Top edge indicator
		this.ctx.beginPath();
		this.ctx.moveTo(this.cropRect.x + this.cropRect.width / 2 - edgeLength / 2, this.cropRect.y);
		this.ctx.lineTo(this.cropRect.x + this.cropRect.width / 2 + edgeLength / 2, this.cropRect.y);
		this.ctx.stroke();
		
		// Bottom edge indicator
		this.ctx.beginPath();
		this.ctx.moveTo(this.cropRect.x + this.cropRect.width / 2 - edgeLength / 2, this.cropRect.y + this.cropRect.height);
		this.ctx.lineTo(this.cropRect.x + this.cropRect.width / 2 + edgeLength / 2, this.cropRect.y + this.cropRect.height);
		this.ctx.stroke();
		
		// Left edge indicator
		this.ctx.beginPath();
		this.ctx.moveTo(this.cropRect.x, this.cropRect.y + this.cropRect.height / 2 - edgeLength / 2);
		this.ctx.lineTo(this.cropRect.x, this.cropRect.y + this.cropRect.height / 2 + edgeLength / 2);
		this.ctx.stroke();
		
		// Right edge indicator
		this.ctx.beginPath();
		this.ctx.moveTo(this.cropRect.x + this.cropRect.width, this.cropRect.y + this.cropRect.height / 2 - edgeLength / 2);
		this.ctx.lineTo(this.cropRect.x + this.cropRect.width, this.cropRect.y + this.cropRect.height / 2 + edgeLength / 2);
		this.ctx.stroke();
	}


	private updateCanvasDisplaySize() {
		if (!this.canvas) return;
		
		// Recalculate display size based on new canvas dimensions
		const container = this.canvas.parentElement;
		if (container) {
			const containerRect = container.getBoundingClientRect();
			const availableWidth = containerRect.width - 40;
			const availableHeight = containerRect.height - 40;
			
			const scaleX = availableWidth / this.canvas.width;
			const scaleY = availableHeight / this.canvas.height;
			const scale = Math.min(scaleX, scaleY, 1);
			
			const displayWidth = Math.floor(this.canvas.width * scale);
			const displayHeight = Math.floor(this.canvas.height * scale);
			
			this.canvas.style.width = displayWidth + 'px';
			this.canvas.style.height = displayHeight + 'px';
		}
	}
	
	
	
	
	
	

	private getFinalCroppedImage(): string {
		if (!this.canvas || !this.ctx) {
			return this.canvas?.toDataURL('image/png') || '';
		}
		
		// If crop mode is active, return cropped area combining all layers
		if (this.cropModeActive && this.extendedRegion) {
			// Create a new canvas with the dimensions of the crop rectangle
			const croppedCanvas = document.createElement('canvas');
			const croppedCtx = croppedCanvas.getContext('2d')!;
			
			croppedCanvas.width = this.cropRect.width;
			croppedCanvas.height = this.cropRect.height;
			
			// First, draw the background layer (layer 4) in the crop area
			if (this.fullScreenshotImage) {
				// Calculate source rectangle from the full screenshot
				const sourceX = this.cropRect.x - this.layersOffset.x;
				const sourceY = this.cropRect.y - this.layersOffset.y;
				
				croppedCtx.drawImage(
					this.fullScreenshotImage,
					sourceX, sourceY, this.cropRect.width, this.cropRect.height,
					0, 0, this.cropRect.width, this.cropRect.height
				);
			}
			
			// Then, draw the edit layer (layer 3) in the crop area
			if (this.editLayerCanvas) {
				// Calculate source rectangle from the edit layer
				const sourceX = this.cropRect.x - this.layersOffset.x;
				const sourceY = this.cropRect.y - this.layersOffset.y;
				
				croppedCtx.drawImage(
					this.editLayerCanvas,
					sourceX, sourceY, this.cropRect.width, this.cropRect.height,
					0, 0, this.cropRect.width, this.cropRect.height
				);
			}
			
			return croppedCanvas.toDataURL('image/png');
		}
		
		// If no crop mode, return full canvas
		return this.canvas.toDataURL('image/png');
	}

	
	cleanup() {
		this.close();
	}
}