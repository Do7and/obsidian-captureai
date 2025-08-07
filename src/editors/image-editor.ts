import { Modal, Notice } from 'obsidian';
import ImageCapturePlugin from '../main';
import { EditTool, Region, StrokeSize, StrokeSetting, LLM_PROVIDERS } from '../types';
import { t } from '../i18n';
import { getLogger } from '../utils/logger';


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
	
	// Layer 3.5: Highlighter layer - stores highlighter strokes with transparency
	private highlighterLayerCanvas: HTMLCanvasElement | null = null;
	private highlighterLayerCtx: CanvasRenderingContext2D | null = null;
	// Backup for highlighter layer
	private highlighterLayerBackup: ImageData | null = null;
	
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
		const buttonBarHeight = 60;
		
		const minModalWidth = 500;
		const minModalHeight = 400;
		
		const maxModalWidth = window.innerWidth * 0.9;
		const maxModalHeight = window.innerHeight * 0.9;
		
		const preferredModalWidth = displayWidth + 140;
		const preferredModalHeight = displayHeight + toolbarHeight + buttonBarHeight + 80;
		
		const modalWidth = Math.max(Math.min(preferredModalWidth, maxModalWidth), minModalWidth);
		const modalHeight = Math.max(Math.min(preferredModalHeight, maxModalHeight), minModalHeight);
		
		getLogger().log('Four-layer system setup:', {
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
		
		// Add tooltip styles
		this.addTooltipStyles();
		
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
		
		// Add tooltip styles for image editor
		this.addTooltipStyles();
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
			{ name: 'pen', icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>`, cursor: 'crosshair' },
			{ name: 'highlighter', icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 9 4 4l-1.5 1.5L7 10"/><path d="M10 10 3 17l-2 2h4l7-7"/><path d="M11 11 20 2l2 2-9 9"/><path d="m7 17 5 5"/><path d="m12 6 5 5"/></svg>`, cursor: 'crosshair' },
			{ name: 'line', icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>`, cursor: 'crosshair' },
			{ name: 'wavy-line', icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0"/></svg>`, cursor: 'crosshair' },
			{ name: 'dashed-line', icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="4 4"><line x1="5" y1="12" x2="19" y2="12"/></svg>`, cursor: 'crosshair' },
			{ name: 'dotted-line', icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1 3"><line x1="5" y1="12" x2="19" y2="12"/></svg>`, cursor: 'crosshair' },
			{ name: 'rectangle', icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>`, cursor: 'crosshair' },
			{ name: 'ellipse', icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="12" rx="10" ry="6"/></svg>`, cursor: 'crosshair' },
			{ name: 'arrow', icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7,7 17,7 17,17"/></svg>`, cursor: 'crosshair' },
			{ name: 'hand', icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>`, cursor: 'crosshair' }
		];
		
		// Tool names for tooltips
		const toolNames: Record<string, string> = {
			'pen': t('imageEditor.penTool'),
			'highlighter': t('imageEditor.highlighterTool'),
			'line': t('imageEditor.lineTool'),
			'wavy-line': t('imageEditor.wavyLineTool'),
			'dashed-line': t('imageEditor.dashedLineTool'),
			'dotted-line': t('imageEditor.dottedLineTool'),
			'rectangle': t('imageEditor.rectangleTool'),
			'ellipse': t('imageEditor.circleTool'),
			'arrow': t('imageEditor.arrowTool'),
			'hand': t('imageEditor.handTool')
		};
		
		tools.forEach(tool => {
			const button = toolbar.createEl('button', { 
				cls: this.currentTool === tool.name ? 'active' : ''
			});
			button.innerHTML = tool.icon;
			button.setAttribute('data-tooltip', toolNames[tool.name]); // Use data-tooltip instead of title
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
		const undoButton = toolbar.createEl('button');
		undoButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>`;
		undoButton.classList.add('non-tool');
		undoButton.setAttribute('data-tooltip', '撤销');
		this.styleToolButton(undoButton, false);
		undoButton.addEventListener('click', () => this.undo());
		
		const redoButton = toolbar.createEl('button');
		redoButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/></svg>`;
		redoButton.classList.add('non-tool');
		redoButton.setAttribute('data-tooltip', '重做');
		this.styleToolButton(redoButton, false);
		redoButton.addEventListener('click', () => this.redo());
		
		const clearButton = toolbar.createEl('button');
		clearButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
		clearButton.classList.add('non-tool');
		clearButton.setAttribute('data-tooltip', '清空画布');
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
			position: relative;
		`;
		
		// Add tooltip CSS class
		button.classList.add('tool-button');
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
			const aiButton = buttonBar.createEl('button', { text: t('imageEditor.aiButton') });
			if (aiButtonEnabled) {
				this.styleActionButton(aiButton, 'var(--interactive-accent)', 'var(--text-on-accent)');
			} else {
				this.styleActionButton(aiButton, 'var(--background-modifier-border)', 'var(--text-muted)');
				aiButton.disabled = true;
				
				// Add tooltip for disabled state
				let tooltip = '';
				if (visionModels.length === 0) {
					tooltip = t('imageEditor.noVisionModelsTooltip');
				} else if (!hasValidModel) {
					tooltip = t('imageEditor.noDefaultModelTooltip');
				} else if (!hasValidCredentials) {
					tooltip = t('imageEditor.credentialsNotVerifiedTooltip');
				}
				aiButton.title = tooltip;
			}
			aiButton.addEventListener('click', () => {
				if (aiButtonEnabled) {
					this.saveAndAddToAIQueue();
				}
			});
		}
		
		const saveButton = buttonBar.createEl('button', { text: t('imageEditor.saveButton') });
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
			
			getLogger().log('🔍 Full screenshot size set from original:', this.fullScreenshotSize);
			getLogger().log('🔍 Region:', this.region);
			getLogger().log('🔍 Extended region:', this.extendedRegion);
			getLogger().log('🔍 Initial layers offset:', this.layersOffset);
			
			// Create edit layer canvas (same size as full screenshot)
			this.editLayerCanvas = document.createElement('canvas');
			this.editLayerCtx = this.editLayerCanvas.getContext('2d')!;
			this.editLayerCanvas.width = this.fullScreenshotSize.width;
			this.editLayerCanvas.height = this.fullScreenshotSize.height;
			
			// Create highlighter layer canvas (Layer 3.5, same size as full screenshot)
			this.highlighterLayerCanvas = document.createElement('canvas');
			this.highlighterLayerCtx = this.highlighterLayerCanvas.getContext('2d')!;
			this.highlighterLayerCanvas.width = this.fullScreenshotSize.width;
			this.highlighterLayerCanvas.height = this.fullScreenshotSize.height;
			
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
					
					getLogger().log('Four-layer display calculation:', {
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

	// Four-layer rendering system (now with 3.5 layer for highlighter)
	private renderAllLayers() {
		if (!this.canvas || !this.ctx) return;
		
		// Clear the main canvas (viewport)
		this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
		
		// Layer 4: Full screenshot background (with offset)
		this.renderBackgroundLayer();
		
		// Layer 3.5: Highlighter layer (with transparency, same offset as background)
		this.renderHighlighterLayer();
		
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
	
	private renderHighlighterLayer() {
		if (!this.canvas || !this.ctx || !this.highlighterLayerCanvas) return;
		
		// Save current state
		this.ctx.save();
		
		// Set transparency for highlighter effect
		this.ctx.globalAlpha = 0.4;
		this.ctx.globalCompositeOperation = 'multiply'; // or 'overlay' for different effect
		
		// Draw the highlighter layer with the same offset as background
		this.ctx.drawImage(
			this.highlighterLayerCanvas,
			this.layersOffset.x, this.layersOffset.y,
			this.fullScreenshotSize.width, this.fullScreenshotSize.height
		);
		
		// Restore state
		this.ctx.restore();
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
			
			// For shape tools, create a backup of current edit layers
			if (['line', 'wavy-line', 'dashed-line', 'dotted-line', 'rectangle', 'ellipse', 'arrow'].includes(this.currentTool)) {
				if (this.editLayerCtx && this.editLayerCanvas) {
					this.editLayerBackup = this.editLayerCtx.getImageData(0, 0, this.editLayerCanvas.width, this.editLayerCanvas.height);
				}
				if (this.highlighterLayerCtx && this.highlighterLayerCanvas) {
					this.highlighterLayerBackup = this.highlighterLayerCtx.getImageData(0, 0, this.highlighterLayerCanvas.width, this.highlighterLayerCanvas.height);
				}
			}
			
			this.lastX = fullScreenshotX;
			this.lastY = fullScreenshotY;
			this.isDrawing = true;
			// Don't save to history here - wait until drawing is complete
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
				
				if (this.currentTool === 'pen' || this.currentTool === 'highlighter') {
					// Free drawing tools - draw stroke from last position to current
					this.drawOnEditLayer(fullScreenshotX, fullScreenshotY);
					this.lastX = fullScreenshotX;
					this.lastY = fullScreenshotY;
				} else if (['line', 'wavy-line', 'dashed-line', 'dotted-line', 'rectangle', 'ellipse', 'arrow'].includes(this.currentTool)) {
					// Shape tools - preview drawing
					this.handleShapeDrawing(fullScreenshotX, fullScreenshotY);
				}
				
				// Re-render all layers to show the drawing
				this.renderAllLayers();
			}
		}
	}
	
	private drawOnEditLayer(x: number, y: number) {
		if (!this.editLayerCtx) return;
		
		// For highlighter tool, draw on layer 3.5 instead
		if (this.currentTool === 'highlighter') {
			this.drawHighlighterStroke(x, y);
			return;
		}
		
		// Set drawing properties for regular tools
		this.editLayerCtx.lineWidth = this.getCurrentStrokeWidth();
		this.editLayerCtx.lineCap = 'round';
		this.editLayerCtx.lineJoin = 'round';
		this.editLayerCtx.strokeStyle = this.getCurrentColor();
		
		if (this.currentTool === 'pen') {
			// Regular pen drawing on layer 3
			this.editLayerCtx.globalCompositeOperation = 'source-over';
			this.editLayerCtx.globalAlpha = 1;
			this.editLayerCtx.beginPath();
			this.editLayerCtx.moveTo(this.lastX, this.lastY);
			this.editLayerCtx.lineTo(x, y);
			this.editLayerCtx.stroke();
		}
	}
	
	// Highlighter stroke method - drawing on Layer 3.5 with full opacity
	private drawHighlighterStroke(x: number, y: number) {
		if (!this.highlighterLayerCtx) return;
		
		// Set drawing properties for highlighter on layer 3.5
		this.highlighterLayerCtx.lineWidth = this.getCurrentStrokeWidth();
		this.highlighterLayerCtx.lineCap = 'round';
		this.highlighterLayerCtx.lineJoin = 'round';
		this.highlighterLayerCtx.strokeStyle = this.getCurrentColor();
		this.highlighterLayerCtx.globalCompositeOperation = 'source-over';
		this.highlighterLayerCtx.globalAlpha = 1; // Full opacity on layer 3.5
		
		// Draw on highlighter layer
		this.highlighterLayerCtx.beginPath();
		this.highlighterLayerCtx.moveTo(this.lastX, this.lastY);
		this.highlighterLayerCtx.lineTo(x, y);
		this.highlighterLayerCtx.stroke();
	}
	
	// Handle shape drawing (preview mode)
	private handleShapeDrawing(x: number, y: number) {
		if (!this.editLayerCtx || !this.editLayerCanvas) return;
		
		// Restore from backup for preview
		if (this.editLayerBackup) {
			this.editLayerCtx.putImageData(this.editLayerBackup, 0, 0);
		}
		
		// Set drawing properties
		this.editLayerCtx.lineWidth = this.getCurrentStrokeWidth();
		this.editLayerCtx.lineCap = 'round';
		this.editLayerCtx.lineJoin = 'round';
		this.editLayerCtx.strokeStyle = this.getCurrentColor();
		this.editLayerCtx.globalCompositeOperation = 'source-over';
		this.editLayerCtx.globalAlpha = 1;
		
		// Draw shape based on current tool
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
			case 'ellipse':
				this.drawEllipseOnEditLayer(this.lastX, this.lastY, x, y);
				break;
			case 'arrow':
				this.drawArrowOnEditLayer(this.lastX, this.lastY, x, y);
				break;
		}
	}
	
	// Edit layer versions of drawing methods
	private drawWavyLineOnEditLayer(x1: number, y1: number, x2: number, y2: number) {
		// Calculate wave parameters
		const distance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
		const amplitude = Math.max(3, this.getCurrentStrokeWidth() * 1.2); // Reduced amplitude
		const frequency = distance / 50; // Reduced frequency for smaller waves
		
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
	
	private drawEllipseOnEditLayer(x1: number, y1: number, x2: number, y2: number) {
		// Calculate ellipse parameters
		const centerX = (x1 + x2) / 2;
		const centerY = (y1 + y2) / 2;
		const radiusX = Math.abs(x2 - x1) / 2;
		const radiusY = Math.abs(y2 - y1) / 2;
		
		this.editLayerCtx!.beginPath();
		this.editLayerCtx!.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
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
			if (['line', 'wavy-line', 'dashed-line', 'dotted-line', 'rectangle', 'ellipse', 'arrow'].includes(this.currentTool)) {
				this.editLayerBackup = null;
				this.highlighterLayerBackup = null;
			}
			
			// Save to history after drawing is complete
			this.saveToHistory();
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



	private saveToHistory() {
		if (!this.editLayerCtx || !this.editLayerCanvas || !this.highlighterLayerCtx || !this.highlighterLayerCanvas) return;
		
		// Save both edit layer and highlighter layer states
		const editImageData = this.editLayerCtx.getImageData(0, 0, this.editLayerCanvas.width, this.editLayerCanvas.height);
		const highlighterImageData = this.highlighterLayerCtx.getImageData(0, 0, this.highlighterLayerCanvas.width, this.highlighterLayerCanvas.height);
		
		// Store as a combined state object
		const combinedState = { edit: editImageData, highlighter: highlighterImageData };
		
		this.history = this.history.slice(0, this.historyIndex + 1);
		this.history.push(combinedState as any); // Type assertion for now
		this.historyIndex = this.history.length - 1;
		
		if (this.history.length > 20) {
			this.history.shift();
			this.historyIndex--;
		}
	}

	private restoreFromHistory() {
		if (!this.editLayerCtx || !this.highlighterLayerCtx || this.historyIndex < 0 || this.historyIndex >= this.history.length) return;
		
		const state = this.history[this.historyIndex] as any;
		
		// Restore both layers if the state contains them
		if (state.edit && state.highlighter) {
			this.editLayerCtx.putImageData(state.edit, 0, 0);
			this.highlighterLayerCtx.putImageData(state.highlighter, 0, 0);
		} else {
			// Backward compatibility with old single-layer history
			this.editLayerCtx.putImageData(state, 0, 0);
		}
		
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
		
		// Clear the highlighter layer (layer 3.5)
		if (this.highlighterLayerCtx && this.highlighterLayerCanvas) {
			this.highlighterLayerCtx.clearRect(0, 0, this.highlighterLayerCanvas.width, this.highlighterLayerCanvas.height);
		}
		
		// Re-render all layers to show the cleared layers
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
			
			// Save image to vault and get the path
			const savedPath = await this.saveImageToVault(dataUrl, fileName);
			
			// Create markdown content with image path (or fallback to filename if save failed)
			const imagePath = savedPath || fileName;
			const markdownContent = `![Screenshot](${imagePath})`;
			
			// Copy markdown text to clipboard
			await navigator.clipboard.writeText(markdownContent);
			
			// Show success message
			new Notice(`✅ 图片Markdown已复制！\n文件: ${fileName}`);
			
			this.close();
			
		} catch (error: any) {
			new Notice(t('imageEditor.copyFailed', { message: error.message }));
			console.error('Save and copy markdown failed:', error);
		}
	}
	
	private async saveImageToVault(dataUrl: string, fileName: string): Promise<string | null> {
		try {
			// Convert dataUrl to binary data
			const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
			const binaryData = atob(base64Data);
			const bytes = new Uint8Array(binaryData.length);
			for (let i = 0; i < binaryData.length; i++) {
				bytes[i] = binaryData.charCodeAt(i);
			}
			
			// Save to plugin's configured save location
			const vault = this.plugin.app.vault;
			const adapter = vault.adapter;
			
			// Use plugin's default save location or fallback to root
			let savePath = fileName;
			const saveLocation = this.plugin.settings.defaultSaveLocation;
			if (saveLocation && saveLocation.trim() !== '') {
				// Ensure save directory exists
				if (!await adapter.exists(saveLocation)) {
					await vault.createFolder(saveLocation);
				}
				savePath = `${saveLocation}/${fileName}`;
			}
			
			// Write file to vault
			await vault.adapter.writeBinary(savePath, bytes.buffer);
			
			getLogger().log('Image saved to vault:', savePath);
			
			// Return the path for use in markdown links
			return savePath;
			
		} catch (error: any) {
			console.error('Failed to save image to vault:', error);
			// Return null on error
			return null;
		}
	}

	private async saveAndAddToAIQueue() {
		if (!this.canvas) return;
		
		try {
			// Get the final cropped image
			const dataUrl = this.getFinalCroppedImage();
			
			// Generate filename
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
			const fileName = `screenshot-${timestamp}.png`;
			
			// Show progress notice
			const notice = new Notice(t('imageEditor.savingAndAddingToQueue'), 2000);
			
			try {
				// Save the image to vault first and get the path
				const savedPath = await this.saveImageToVault(dataUrl, fileName);
				getLogger().log('Image saved to vault:', savedPath);
				
				// Show AI panel first (only if not already visible)
				await this.plugin.ensureAIChatPanelVisible();
				
				// Add image to queue with both local path and dataUrl
				await this.plugin.addImageToAIQueue(dataUrl, fileName, savedPath);
				
				// Close the editor
				this.close();
				
				notice.hide();
				new Notice(t('imageEditor.imageAddedToQueue'));
				
			} catch (error: any) {
				notice.hide();
				console.error('Add to AI queue failed:', error);
				new Notice(t('imageEditor.addToQueueFailed', { message: error.message }));
			}
			
		} catch (error: any) {
			console.error('Save and add to AI queue failed:', error);
			new Notice(t('imageEditor.operationFailed', { message: error.message }));
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
			
			// Then, draw the highlighter layer (layer 3.5) with transparency
			if (this.highlighterLayerCanvas) {
				const sourceX = this.cropRect.x - this.layersOffset.x;
				const sourceY = this.cropRect.y - this.layersOffset.y;
				
				// Apply transparency for highlighter effect
				croppedCtx.save();
				croppedCtx.globalAlpha = 0.4;
				croppedCtx.globalCompositeOperation = 'multiply';
				
				croppedCtx.drawImage(
					this.highlighterLayerCanvas,
					sourceX, sourceY, this.cropRect.width, this.cropRect.height,
					0, 0, this.cropRect.width, this.cropRect.height
				);
				
				croppedCtx.restore();
			}
			
			// Finally, draw the edit layer (layer 3) in the crop area
			if (this.editLayerCanvas) {
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

	private addTooltipStyles(): void {
		// Add CSS styles for tooltips in image editor
		if (!document.getElementById('image-editor-tooltip-styles')) {
			const style = document.createElement('style');
			style.id = 'image-editor-tooltip-styles';
			style.textContent = `
				/* Image editor tooltip styles */
				.image-editor-toolbar button[data-tooltip] {
					position: relative;
				}

				.image-editor-toolbar button[data-tooltip]::after {
					content: attr(data-tooltip);
					position: absolute;
					top: 100%;
					left: 50%;
					transform: translateX(-50%);
					background: #374151;
					color: white;
					padding: 6px 8px;
					border-radius: 4px;
					font-size: 12px;
					white-space: nowrap;
					opacity: 0;
					pointer-events: none;
					transition: opacity 0.2s ease;
					margin-top: 8px;
					z-index: 1000;
				}

				.image-editor-toolbar button[data-tooltip]:hover::after {
					opacity: 1;
				}

				/* Also add tooltip styles for stroke size buttons */
				.stroke-size-container button[data-tooltip] {
					position: relative;
				}

				.stroke-size-container button[data-tooltip]::after {
					content: attr(data-tooltip);
					position: absolute;
					top: 100%;
					left: 50%;
					transform: translateX(-50%);
					background: #374151;
					color: white;
					padding: 6px 8px;
					border-radius: 4px;
					font-size: 12px;
					white-space: nowrap;
					opacity: 0;
					pointer-events: none;
					transition: opacity 0.2s ease;
					margin-top: 8px;
					z-index: 1000;
				}

				.stroke-size-container button[data-tooltip]:hover::after {
					opacity: 1;
				}
			`;
			document.head.appendChild(style);
		}
	}
}