import { Modal, Notice, setIcon, requestUrl } from 'obsidian';
import ImageCapturePlugin from '../main';
import { EditTool, Region, StrokeSize, StrokeSetting, LLM_PROVIDERS } from '../types';
import { t } from '../i18n';
import { getLogger } from '../utils/logger';
import { formatTimestampForFilename } from '../utils/time';

// Simple interface for history state
interface HistoryState {
	edit: ImageData;
	highlighter: ImageData;
}


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
	private history: (ImageData | HistoryState)[] = []; // Support both old and new format
	private historyIndex = -1;
	private originalImageData: string = '';
	
	// UI elements
	private fileNameInput: HTMLInputElement | null = null;
	private fileNameWarning: HTMLElement | null = null;
	private fileNameInvalidWarning: HTMLElement | null = null;
	private saveButtons: HTMLButtonElement[] = []; // Store buttons that require valid filename

	// WeakMap storage for DOM element properties - replaces (element as any) patterns
	private instanceDimensions = {
		modalWidth: 0,
		modalHeight: 0,
		canvasWidth: 0,
		canvasHeight: 0
	};
	
	private toolbarElements = new WeakMap<HTMLElement, {
		colorPicker?: HTMLInputElement;
		strokeSizeContainer?: HTMLElement;
		zoomSlider?: HTMLInputElement;
		zoomDisplay?: HTMLElement;
	}>();
	
	private buttonProperties = new WeakMap<HTMLButtonElement, {
		circle: SVGCircleElement;
		originalRadius: number;
		size: StrokeSize;
	}>();
	
	private containerDimensions = new WeakMap<HTMLElement, {
		displayWidth: number;
		displayHeight: number;
	}>();

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
	
	// Display scaling factor - ratio between canvas logical coordinates and display coordinates
	private displayScale = 1; // How much the canvas is scaled down for display
	private preCalculatedDisplayScale = 1.2; // Pre-calculated display scale from showEditor
	
	// User zoom control (0.25x - 4x)
	private userZoom = 1; // User-controlled zoom level  
	private viewportOffset = { x: 0, y: 0 }; // Viewport pan offset
	
	// Viewport dragging (what the viewport-pan tool moves)
	private isDraggingViewport = false;
	private viewportDragStart = { x: 0, y: 0 };
	private viewportStartOffset = { x: 0, y: 0 };
	
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
		
		// Reset zoom and viewport for each new screenshot
		this.userZoom = 1;
		this.viewportOffset = { x: 0, y: 0 };
		
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
		
		// Calculate modal size based on content
		// displayWidth/displayHeight is the 1.2x extended region size
		const extendedRegionWidth = displayWidth;
		const extendedRegionHeight = displayHeight;
		
		// Calculate required modal size - ensure enough space for all components
		const toolbarHeight = 80;
		const buttonBarHeight = 120; // Increase to accommodate filename section properly
		const headerHeight = 40;
		const margins = 40; // margins around canvas container
		const canvasContainerHeight = displayHeight + 40; // Canvas height plus padding
		
		const requiredModalWidth = displayWidth + margins;
		const requiredModalHeight = toolbarHeight + canvasContainerHeight + buttonBarHeight + headerHeight + margins;
		
		// Apply minimum width constraint
		const minModalWidth = 800;
		const finalModalWidth = Math.max(requiredModalWidth, minModalWidth);
		
		getLogger().log('🔍 Modal size calculation:', {
			originalRegionSize: { width: region.width, height: region.height },
			extendedRegionSize: { width: extendedRegionWidth, height: extendedRegionHeight },
			requiredModalSize: { width: requiredModalWidth, height: requiredModalHeight },
			finalModalSize: { width: finalModalWidth, height: requiredModalHeight }
		});
		
		// Store dimensions for onOpen
		this.instanceDimensions.modalWidth = finalModalWidth;
		this.instanceDimensions.modalHeight = requiredModalHeight;
		this.instanceDimensions.canvasWidth = displayWidth;
		this.instanceDimensions.canvasHeight = displayHeight;
		
		// No display scaling - show at 1:1
		this.preCalculatedDisplayScale = 1.0;
		
		this.open();
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		
		// Create fixed header modal structure for image editor
		contentEl.addClass('modal-with-fixed-header');
		contentEl.addClass('image-editor-container');
		
		// Add tooltip styles
		this.addTooltipStyles();
		
		// Always use calculated modal size
		const modalWidth = this.instanceDimensions.modalWidth || 800;
		const modalHeight = this.instanceDimensions.modalHeight || 600;
		
		this.modalEl.addClass('image-editor-modal-sized');
		this.modalEl.style.setProperty('--modal-width', modalWidth + 'px');
		this.modalEl.style.setProperty('--modal-height', modalHeight + 'px');
		contentEl.addClass('image-editor-content-fullsize');
		
		
		// Create scrollable content area (though image editor shouldn't need scrolling)
		const scrollableContent = contentEl.createEl('div', { cls: 'modal-scrollable-content image-editor-content' });
		
		this.createEditorInterface(scrollableContent);
		this.loadImage();
		
		// Add tooltip styles for image editor
		this.addTooltipStyles();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.removeClass('image-editor-container');
		contentEl.removeClass('image-editor-content-fullsize');
		
		// Reset modal styles to prevent affecting other modals
		this.modalEl.removeClass('image-editor-modal-sized');
		this.modalEl.style.removeProperty('--modal-width');
		this.modalEl.style.removeProperty('--modal-height');
	}

	private createEditorInterface(container: HTMLElement) {
		// Get pre-calculated dimensions
		const canvasDisplayWidth = this.instanceDimensions.canvasWidth || 300;
		const canvasDisplayHeight = this.instanceDimensions.canvasHeight || 200;
		
		// Define fixed UI element heights
		const toolbarHeight = 80; // 恢复toolbar高度以确保双行显示
		const textSectionHeight = 100;
		const buttonBarHeight = 60; // 恢复button bar高度
		
		// Set container to use full modal space with proper flex layout
		container.addClass('image-editor-container-layout');
		container.style.display = 'flex';
		container.style.flexDirection = 'column';
		container.style.height = '100%';
		
		// Store display dimensions
		this.containerDimensions.set(container, {
			displayWidth: canvasDisplayWidth,
			displayHeight: canvasDisplayHeight
		});
		
		// Fixed height toolbar
		const toolbar = container.createDiv({ cls: 'image-editor-toolbar' });
		toolbar.addClass('image-editor-toolbar-fixed');
		toolbar.style.setProperty('--toolbar-height', toolbarHeight + 'px');
		toolbar.style.flexShrink = '0'; // Ensure toolbar is always visible
		this.createMainToolbar(toolbar);
		
		// Canvas container - sized to contain canvas naturally
		const canvasContainer = container.createDiv({ cls: 'image-editor-canvas-container' });
		canvasContainer.addClass('image-editor-canvas-container-flex');
		// Set the exact height needed for the canvas content
		canvasContainer.style.height = `${canvasDisplayHeight + 40}px`; // Add 40px padding
		canvasContainer.style.flexGrow = '0'; // Don't grow
		canvasContainer.style.flexShrink = '0'; // Don't shrink
		
		this.canvas = canvasContainer.createEl('canvas', { cls: 'image-editor-canvas' });
		
		this.ctx = this.canvas.getContext('2d')!;
		this.bindCanvasEvents();
		
		// Fixed height button bar
		const buttonBar = container.createDiv({ cls: 'image-editor-button-bar' });
		buttonBar.addClass('image-editor-button-bar-fixed');
		buttonBar.style.setProperty('--button-bar-height', buttonBarHeight + 'px');
		buttonBar.style.flexShrink = '0'; // Ensure button bar is always visible
		this.createActionButtons(buttonBar);
	}

	private createMainToolbar(toolbar: HTMLElement) {
		toolbar.addClass('image-editor-main-toolbar');
		
		// Drawing tools
		const tools: EditTool[] = [
			{ name: 'pen', icon: 'pen', cursor: 'crosshair' },
			{ name: 'highlighter', icon: 'highlighter', cursor: 'crosshair' },
			{ name: 'line', icon: 'minus', cursor: 'crosshair' },
			{ name: 'wavy-line', icon: 'waves', cursor: 'crosshair' },
			{ name: 'dashed-line', icon: 'flip-vertical', cursor: 'crosshair' },
			{ name: 'dotted-line', icon: 'ellipsis', cursor: 'crosshair' },
			{ name: 'rectangle', icon: 'square', cursor: 'crosshair' },
			{ name: 'ellipse', icon: 'circle', cursor: 'crosshair' },
			{ name: 'arrow', icon: 'move-up-right', cursor: 'crosshair' },
			{ name: 'hand', icon: 'move', cursor: 'crosshair' },
			{ name: 'viewport-pan', icon: 'navigation', cursor: 'grab' }
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
			'hand': t('imageEditor.handTool'),
			'viewport-pan': 'Viewport Pan' // TODO: Add to i18n
		};
		
		tools.forEach(tool => {
			const button = toolbar.createEl('button', { 
				cls: this.currentTool === tool.name ? 'btn-base btn-icon active image-editor-tool-button' : 'btn-base btn-icon image-editor-tool-button'
			});
			button.createEl('span', {}, (span) => {
				setIcon(span, tool.icon);
			});
			button.setAttribute('data-tooltip', toolNames[tool.name]);
			
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
							btn.classList.remove('active');
						}
					});
				button.classList.add('active');
				
				// Update color picker and stroke size buttons when switching modes
				this.updateColorAndStrokeDisplay(toolbar);
				
				// Force update stroke size button colors immediately
				setTimeout(() => {
					this.updateStrokeSizeButtonColors(toolbar);
				}, 0);
			});
		});
		
		// Separator
		const separator1 = toolbar.createEl('div', { cls: 'image-editor-separator' });
		
		// Color picker
		const colorPicker = toolbar.createEl('input', { type: 'color', cls: 'image-editor-color-picker' });
		colorPicker.value = this.currentColor;
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
		this.toolbarElements.set(toolbar, { colorPicker });
		
		// Stroke size buttons with colored circles
		const strokeSizeContainer = toolbar.createDiv({ cls: 'stroke-size-container image-editor-stroke-size-container' });
		
		const strokeSizes: { size: StrokeSize, radius: number }[] = [
			{ size: 'small', radius: 3 },    // 先用较小的半径测试
			{ size: 'medium', radius: 5 },   // 先用较小的半径测试
			{ size: 'large', radius: 7 }     // 先用较小的半径测试
		];
		
		strokeSizes.forEach(({ size, radius }) => {
			const button = strokeSizeContainer.createEl('button', { cls: 'non-tool stroke-size image-editor-stroke-size-button' });
			
			// Create SVG circle icon - make SVG larger to match button size
			const svg = button.createSvg('svg');
			svg.setAttribute('width', '24');
			svg.setAttribute('height', '24');
			svg.setAttribute('viewBox', '0 0 24 24');
			
			const circle = svg.createSvg('circle');
			circle.setAttribute('cx', '12');  // 中心点从10改为12 (24/2)
			circle.setAttribute('cy', '12');  // 中心点从10改为12 (24/2)
			circle.setAttribute('r', radius.toString());
			circle.setAttribute('fill', this.getCurrentColor() || '#000000');
			
			// Store button data for later updates
			this.buttonProperties.set(button, {
				circle: circle,
				originalRadius: radius,
				size: size
			});
			
			if (this.getCurrentStrokeSize() === size) {
				button.addClass('active');
			}
			
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
		const toolbarData = this.toolbarElements.get(toolbar) || {};
		toolbarData.strokeSizeContainer = strokeSizeContainer;
		this.toolbarElements.set(toolbar, toolbarData);
		
		// Separator before zoom controls
		const separatorBeforeZoom = toolbar.createEl('div', { cls: 'image-editor-separator' });
		
		// Zoom control
		this.createZoomControls(toolbar);
		
		// Another separator
		const separator1_5 = toolbar.createEl('div', { cls: 'image-editor-separator' });
		
		// Note: Crop frame is automatically shown for extended regions
		
		// History buttons
		const undoButton = toolbar.createEl('button', { cls: 'btn-base btn-icon non-tool image-editor-history-button' });
		setIcon(undoButton, 'undo');

		undoButton.setAttribute('data-tooltip', t('imageEditor.undoTooltip'));
		undoButton.addEventListener('click', () => this.undo());
		
		const redoButton = toolbar.createEl('button', { cls: 'btn-base btn-icon non-tool image-editor-history-button' });
		setIcon(redoButton, 'redo');
		redoButton.setAttribute('data-tooltip', t('imageEditor.redoTooltip'));
		redoButton.addEventListener('click', () => this.redo());
		
		const clearButton = toolbar.createEl('button', { cls: 'btn-base btn-icon non-tool image-editor-history-button' });
		setIcon(clearButton, 'trash-2');
		clearButton.setAttribute('data-tooltip', t('imageEditor.clearCanvasTooltip'));
		clearButton.addEventListener('click', () => this.clearCanvas());
		
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
		const toolbarData = this.toolbarElements.get(toolbar);
		if (!toolbarData) return;
		
		const colorPicker = toolbarData.colorPicker;
		const strokeSizeContainer = toolbarData.strokeSizeContainer;
		
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
			const buttonData = this.buttonProperties.get(button);
			if (!buttonData) return;
			
			const { size, circle, originalRadius } = buttonData;
			
			if (circle && originalRadius) {
				// Update circle size based on mode
				let displayRadius = originalRadius;
				if (this.isHighlighterMode) {
					// Make highlighter circles larger to show the difference
					displayRadius = Math.min(originalRadius + 2, 12); // 调整最大值从8到12
				}
				circle.setAttribute('r', displayRadius.toString());
				circle.setAttribute('fill', this.getCurrentColor() || '#000000'); // 确保有颜色
			}
			
			this.styleStrokeSizeButton(button, this.getCurrentStrokeSize() === size);
		});
	}

	private styleStrokeSizeButton(button: HTMLButtonElement, active: boolean) {
		// Use original CSS classes - no need for new base classes since they already exist
		if (active) {
			button.addClass('active');
		} else {
			button.removeClass('active');
		}
	}
	
	private updateStrokeSizeButtonColors(toolbar: HTMLElement) {
		const toolbarData = this.toolbarElements.get(toolbar);
		if (!toolbarData || !toolbarData.strokeSizeContainer) return;
		
		const strokeSizeContainer = toolbarData.strokeSizeContainer;
		strokeSizeContainer.querySelectorAll('.stroke-size').forEach((button: HTMLButtonElement) => {
			const buttonData = this.buttonProperties.get(button);
			if (buttonData && buttonData.circle) {
				// Use getCurrentColor() to get the correct color based on current mode
				buttonData.circle.setAttribute('fill', this.getCurrentColor() || '#000000'); // 确保有颜色
			}
		});
	}

	private createActionButtons(buttonBar: HTMLElement) {
		// Use CSS class for base styling
		buttonBar.className = 'image-editor-action-buttons-container';
		
		// File name input section with vertical layout for warnings
		const fileNameSection = buttonBar.createDiv({ cls: 'image-editor-filename-section' });
		
		// Create input row (label + input in same line)
		const inputRow = fileNameSection.createDiv({ cls: 'image-editor-filename-section-layout' });
		
		// File name label
		const fileNameLabel = inputRow.createEl('label', { 
			text: t('imageEditor.fileNameLabel'),
			cls: 'image-editor-filename-label-style'
		});
		
		// Generate default filename
		const timestamp = formatTimestampForFilename();
		const defaultFileName = `screenshot-${timestamp}.png`;
		
		const fileNameInput = inputRow.createEl('input', { 
			type: 'text',
			placeholder: t('imageEditor.fileNamePlaceholder'),
			value: defaultFileName,
			cls: 'input-base image-editor-filename-input-style'
		});
		
		// Store reference to filename input
		this.fileNameInput = fileNameInput;
		
		// Create warning container OUTSIDE inputRow but INSIDE fileNameSection
		const warningsContainer = fileNameSection.createDiv({ cls: 'image-editor-filename-warnings-container' });
		
		// Create warning element for invalid filename
		const invalidWarningElement = warningsContainer.createEl('div', { 
			cls: 'image-editor-filename-warning warning-invalid'
		});
		invalidWarningElement.classList.add('hidden');
		this.fileNameInvalidWarning = invalidWarningElement;
		
		// Create warning element for file conflicts
		const conflictWarningElement = warningsContainer.createEl('div', { 
			cls: 'image-editor-filename-warning warning-conflict'
		});
		conflictWarningElement.classList.add('hidden');
		this.fileNameWarning = conflictWarningElement;
		
		// Add event listener to check file validity and conflicts
		fileNameInput.addEventListener('input', () => {
			getLogger().log('File name input changed, checking validity and conflicts');
			this.validateFileName();
		});
		
		// Initial check
		setTimeout(() => {
			getLogger().log('Running initial file name validation');
			this.validateFileName();
		}, 100);
		
		// Button row
		const buttonRow = buttonBar.createDiv({ cls: 'image-editor-button-row image-editor-button-row-layout' });
		
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

		// 第一组：发送到AI预发送区（临时图片）
		if (aiEnabled) {
			const addToAIQueueButton = buttonRow.createEl('button', { 
				text: t('imageEditor.tempSendToAI'),
				cls: 'btn-base'
			});
			this.saveButtons.push(addToAIQueueButton); // Add to save buttons array for filename validation
			if (!aiButtonEnabled) {
				addToAIQueueButton.disabled = true;
				
				// Add tooltip for disabled state
				let tooltip = '';
				if (visionModels.length === 0) {
					tooltip = t('imageEditor.noVisionModelsTooltip');
				} else if (!hasValidModel) {
					tooltip = t('imageEditor.noDefaultModelTooltip');
				} else if (!hasValidCredentials) {
					tooltip = t('imageEditor.credentialsNotVerifiedTooltip');
				}
				addToAIQueueButton.title = tooltip;
			}
			addToAIQueueButton.addEventListener('click', () => {
				if (aiButtonEnabled) {
					this.addToAIQueueOnly();
				}
			});
		}

		// 第二组：保存到本地
		const saveButton = buttonRow.createEl('button', { 
			text: t('imageEditor.tempCopy'),
			cls: 'btn-base'
		});
		this.saveButtons.push(saveButton); // Add to save buttons array

		saveButton.addEventListener('click', () => {
			if (!saveButton.disabled) {
				this.saveOnly();
			}
		});

		// 第三组：保存并发送到AI预发送区（组合操作）
		if (aiEnabled) {
			const saveAndSendButton = buttonRow.createEl('button', { 
				text: t('imageEditor.aiButton'),
				cls: 'btn-base'
			});
			this.saveButtons.push(saveAndSendButton); // Add to save buttons array
			if (!aiButtonEnabled) {
				saveAndSendButton.disabled = true;
				
				// Add tooltip for disabled state
				let tooltip = '';
				if (visionModels.length === 0) {
					tooltip = t('imageEditor.noVisionModelsTooltip');
				} else if (!hasValidModel) {
					tooltip = t('imageEditor.noDefaultModelTooltip');
				} else if (!hasValidCredentials) {
					tooltip = t('imageEditor.credentialsNotVerifiedTooltip');
				}
				saveAndSendButton.title = tooltip;
			}
			saveAndSendButton.addEventListener('click', () => {
				if (aiButtonEnabled && !saveAndSendButton.disabled) {
					this.saveAndAddToAIQueue();
				}
			});
		}

		// 第四组：复制到剪贴板（独立操作）
		const copyButton = buttonRow.createEl('button', { 
			text: t('imageEditor.saveButton'),
			cls: 'btn-base'
		});

		copyButton.addEventListener('click', () => {
			this.copyToClipboard();
		});
	}


	/**
	 * 第一组：仅发送到AI预发送区（临时图片）
	 */
	private async addToAIQueueOnly() {
		if (!this.canvas) return;
		
		try {
			// Get the final image data without saving
			const dataUrl = this.createFinalImage();
			
			getLogger().log('🔄 Adding image to AI queue only (temp):', {
				dataUrlLength: dataUrl.length
			});
			
			// Show AI panel first (only if not already visible)
			await this.plugin.ensureAIChatPanelVisible();
			
			// Add image to queue as temporary image - 生成合适的文件名
			const fileName = `edited-${Date.now()}.png`;
			await this.plugin.addImageToAIQueue(dataUrl, fileName, null);
			
			getLogger().log('✅ Image successfully added to AI queue (temp)');
			
			// Close the editor
			this.close();
			
			new Notice('临时图片已添加到AI预发送区');
			
		} catch (error: any) {
			getLogger().error('Add to AI queue failed:', error);
			new Notice(`添加到AI队列失败: ${error.message}`);
		}
	}

	/**
	 * 第二组：仅保存到本地
	 */
	private async saveOnly() {
		if (!this.canvas) return;
		
		try {
			// Get the final cropped image
			const dataUrl = this.getFinalCroppedImage();
			
			// Get filename from user input or generate default
			const fileName = this.getFileName();
			
			getLogger().log('💾 Saving image only:', {
				fileName: fileName,
				dataUrlLength: dataUrl.length
			});
			
			// Save image to vault
			const savedPath = await this.saveImageToVault(dataUrl, fileName);
			
			if (savedPath) {
				// Create markdown content with image path
				const markdownContent = `![Screenshot](${savedPath})`;
				
				// Copy markdown text to clipboard
				await navigator.clipboard.writeText(markdownContent);
				
				getLogger().log('✅ Image saved successfully');
				new Notice(`✅ 图片已保存并复制Markdown链接！\n文件: ${fileName}`);
			} else {
				new Notice(`❌ 图片保存失败`);
			}
			
			this.close();
			
		} catch (error: any) {
			getLogger().error('Save only failed:', error);
			new Notice(t('imageEditor.saveFailed', { message: error.message }));
		}
	}

	/**
	 * 第三组：保存并发送到AI预发送区（组合操作）
	 */
	private async saveAndAddToAIQueue() {
		if (!this.canvas) return;
		
		try {
			// Get the final cropped image
			const dataUrl = this.getFinalCroppedImage();
			
			// Get filename from user input or generate default
			const fileName = this.getFileName();
			
			getLogger().log('🔄 Saving image and adding to AI queue:', {
				fileName: fileName,
				dataUrlLength: dataUrl.length
			});
			
			// Show progress notice
			const notice = new Notice(t('imageEditor.savingAndAddingToQueue'), 2000);
			
			try {
				// Step 1: Save the image to vault first
				const savedPath = await this.saveImageToVault(dataUrl, fileName);
				getLogger().log('💾 Image saved to vault:', savedPath);
				
				// Step 2: Show AI panel
				await this.plugin.ensureAIChatPanelVisible();
				
				// Step 3: Add saved image to AI queue (use saved path, not temp)
				await this.plugin.addImageToAIQueue(dataUrl, fileName, savedPath);
				
				getLogger().log('✅ Image successfully saved and added to AI queue');
				
				// Close the editor
				this.close();
				
				notice.hide();
				new Notice(t('imageEditor.imageSavedAndAddedToQueue'));
				
			} catch (error: any) {
				notice.hide();
				getLogger().error('Save and add to AI queue failed:', error);
				new Notice(t('imageEditor.saveAndAddToQueueFailed', { message: error.message }));
			}
			
		} catch (error: any) {
			getLogger().error('Save and add to AI queue operation failed:', error);
			new Notice(t('imageEditor.operationFailed', { message: error.message }));
		}
	}

	/**
	 * 第四组：复制到剪贴板（独立操作）
	 */
	private async copyToClipboard() {
		if (!this.canvas) return;
		
		try {
			// Get the final image data
			const dataUrl = this.createFinalImage();
			
			getLogger().log('📋 Copying image to clipboard:', {
				dataUrlLength: dataUrl.length
			});
			
			// Convert data URL to blob
			const response = await requestUrl(dataUrl);
			const blob = new Blob([response.arrayBuffer], { type: response.headers['content-type'] || 'image/png' });
			
			// Copy to clipboard using ClipboardItem
			if (navigator.clipboard && (window as any).ClipboardItem) {
				const item = new (window as any).ClipboardItem({
					'image/png': blob
				});
				await navigator.clipboard.write([item]);
				new Notice(t('notice.imageCopiedToClipboard'));
			} else {
				// Fallback: create a temporary canvas for copying
				const tempCanvas = document.createElement('canvas');
				const tempCtx = tempCanvas.getContext('2d')!;
				const img = new Image();
				
				img.onload = () => {
					tempCanvas.width = img.width;
					tempCanvas.height = img.height;
					tempCtx.drawImage(img, 0, 0);
					
					// Copy canvas content (browser specific)
					tempCanvas.toBlob(async (blob) => {
						if (blob && navigator.clipboard) {
							try {
								const item = new (window as any).ClipboardItem({
									'image/png': blob
								});
								await navigator.clipboard.write([item]);
								new Notice(t('notice.imageCopiedToClipboard'));
							} catch (fallbackError) {
								getLogger().warn('Clipboard copy failed:', fallbackError);
								new Notice(t('notice.copyFailedUseSave'));
							}
						}
					}, 'image/png');
				};
				
				img.src = dataUrl;
			}
			
			getLogger().log('✅ Image copied to clipboard successfully');
			
			// Close the editor
			this.close();
			
		} catch (error: any) {
			getLogger().error('Copy to clipboard failed:', error);
			new Notice(t('imageEditor.copyFailed', { message: error.message }));
		}
	}
	
	
	private createFinalImage(): string {
		return this.getFinalCroppedImage();
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
				const displayWidth = this.instanceDimensions.canvasWidth || displayImg.width;
				const displayHeight = this.instanceDimensions.canvasHeight || displayImg.height;
				
				// Simple 1:1 display scaling
				const finalScale = this.preCalculatedDisplayScale;
				const finalDisplayWidth = Math.floor(displayWidth * finalScale);
				const finalDisplayHeight = Math.floor(displayHeight * finalScale);
				
				// Store the display scale for coordinate conversion
				this.displayScale = finalScale;
				
				// Set canvas logical size (always extended region size)
				this.canvas.width = displayWidth;
				this.canvas.height = displayHeight;
				
				// Set canvas CSS display size (usually 1:1 for auto-sizing)
				this.canvas.style.width = finalDisplayWidth + 'px';
				this.canvas.style.height = finalDisplayHeight + 'px';
				
				getLogger().log('🔍 Canvas auto-sizing:', {
					extendedRegionSize: { width: displayWidth, height: displayHeight },
					displayScale: finalScale,
					canvasCSSSize: { width: this.canvas.style.width, height: this.canvas.style.height }
				});
				
				// Initial render of all four layers
				this.renderAllLayers();
				
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
		
		// Save canvas state before applying zoom transformations
		this.ctx.save();
		
		// 正确的视觉中心计算：
		// viewportOffset表示画面移动的方向和距离
		// 如果画面向右移动，那么视觉中心也向右移动
		const canvasCenterX = this.canvas.width / 2;
		const canvasCenterY = this.canvas.height / 2;
		
		const visualCenterX = canvasCenterX + this.viewportOffset.x;  // 修正：应该是加号
		const visualCenterY = canvasCenterY + this.viewportOffset.y;
		
		// Apply transformations:
		// 1. First apply viewport offset
		this.ctx.translate(this.viewportOffset.x, this.viewportOffset.y);
		
		// 2. Then zoom around the visual center
		this.ctx.translate(visualCenterX, visualCenterY);
		this.ctx.scale(this.userZoom, this.userZoom);
		this.ctx.translate(-visualCenterX, -visualCenterY);
		
		// Layer 4: Full screenshot background (with offset)
		this.renderBackgroundLayer();
		
		// Layer 3.5: Highlighter layer (with transparency, same offset as background)
		this.renderHighlighterLayer();
		
		// Layer 3: Edit layer (with same offset as background)
		this.renderEditLayer();
		
		// Restore state to undo zoom transformations before drawing mask
		this.ctx.restore();
		
		// Layer 2: Semi-transparent mask with transparent crop area (drawn with zoom)
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
		
		// 首先计算出正确的截取框显示位置（和边缘检测一致的位置）
		const canvasCenterX = this.canvas.width / 2;
		const canvasCenterY = this.canvas.height / 2;
		const visualCenterX = canvasCenterX + this.viewportOffset.x;
		const visualCenterY = canvasCenterY + this.viewportOffset.y;
		
		// 临时应用变换计算正确位置
		this.ctx.translate(this.viewportOffset.x, this.viewportOffset.y);
		this.ctx.translate(visualCenterX, visualCenterY);
		this.ctx.scale(this.userZoom, this.userZoom);
		this.ctx.translate(-visualCenterX, -visualCenterY);
		
		const correctTopLeft = this.ctx.getTransform().transformPoint(new DOMPoint(this.cropRect.x, this.cropRect.y));
		const correctBottomRight = this.ctx.getTransform().transformPoint(new DOMPoint(this.cropRect.x + this.cropRect.width, this.cropRect.y + this.cropRect.height));
		
		// 恢复状态，准备正常绘制
		this.ctx.restore();
		this.ctx.save();
		
		// 现在使用计算出的正确位置绘制
		const correctX = correctTopLeft.x;
		const correctY = correctTopLeft.y;
		const correctWidth = correctBottomRight.x - correctTopLeft.x;
		const correctHeight = correctBottomRight.y - correctTopLeft.y;
		
		// Set global composite operation to draw semi-transparent overlay
		this.ctx.globalCompositeOperation = 'source-over';
		
		// Draw semi-transparent overlay outside the crop area
		this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
		
		// Calculate much larger bounds to ensure full coverage
		const largeBounds = Math.max(this.canvas.width, this.canvas.height) * 2;
		const maskLeft = -largeBounds;
		const maskTop = -largeBounds;
		const maskRight = this.canvas.width + largeBounds;
		const maskBottom = this.canvas.height + largeBounds;
		
		// Draw overlay in 4 large rectangles around the CORRECT crop area
		// Top rectangle
		this.ctx.fillRect(maskLeft, maskTop, maskRight - maskLeft, Math.max(0, correctY - maskTop));
		
		// Bottom rectangle
		this.ctx.fillRect(maskLeft, correctY + correctHeight, 
			maskRight - maskLeft, maskBottom - (correctY + correctHeight));
		
		// Left rectangle 
		this.ctx.fillRect(maskLeft, correctY, 
			Math.max(0, correctX - maskLeft), correctHeight);
		
		// Right rectangle
		this.ctx.fillRect(correctX + correctWidth, correctY, 
			maskRight - (correctX + correctWidth), correctHeight);
		
		// Draw crop frame border (白色) - 使用正确计算的位置
		this.ctx.strokeStyle = '#ffffff';
		this.ctx.lineWidth = 2;
		this.ctx.setLineDash([]);
		this.ctx.strokeRect(correctX, correctY, correctWidth, correctHeight);
		
		// Restore canvas state
		this.ctx.restore();
	}

	private bindCanvasEvents() {
		if (!this.canvas) return;
		
		this.canvas.addEventListener('mousedown', (e) => this.handleCanvasMouseDown(e));
		this.canvas.addEventListener('mousemove', (e) => this.handleCanvasMouseMove(e));
		this.canvas.addEventListener('mouseup', (e) => this.handleCanvasMouseUp(e));
		this.canvas.addEventListener('mouseout', (e) => this.handleCanvasMouseOut(e));
		
		// Add mouse wheel event for zoom control
		this.canvas.addEventListener('wheel', (e) => this.handleCanvasWheel(e));
		
		// Add global mouse event listeners for layer dragging
		document.addEventListener('mousemove', (e) => this.handleGlobalMouseMove(e));
		document.addEventListener('mouseup', (e) => this.handleGlobalMouseUp(e));
	}

	private handleCanvasMouseDown(e: MouseEvent) {
		if (!this.canvas) return;
		
		// Get screen to canvas coordinates (same as used for rendering)
		const canvasCoords = this.screenToCanvasCoords(e.clientX, e.clientY);
		
		// Priority 1: Check for crop frame resizing (only in crop mode)
		// Use the same coordinate system as crop frame rendering
		if (this.cropModeActive) {
			const resizeHandle = this.getCropResizeHandle(canvasCoords.x, canvasCoords.y);
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
		
		// Priority 2.5: Viewport pan tool for viewport dragging
		if (this.currentTool === 'viewport-pan') {
			this.isDraggingViewport = true;
			this.viewportDragStart = { x: e.clientX, y: e.clientY };
			this.viewportStartOffset = { ...this.viewportOffset };
			return;
		}
		
		// Priority 3: Drawing tools - need proper coordinate transformation for accuracy
		const zoomedCoords = this.canvasToZoomedCoords(canvasCoords.x, canvasCoords.y);
		const fullScreenshotX = zoomedCoords.x - this.layersOffset.x;
		const fullScreenshotY = zoomedCoords.y - this.layersOffset.y;
		
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
		
		// Get screen to canvas coordinates (same as used for rendering)
		const canvasCoords = this.screenToCanvasCoords(e.clientX, e.clientY);
		
		// Handle crop frame resizing
		if (this.isResizingCrop && this.resizeHandle) {
			const deltaX = e.clientX - this.cropResizeStart.x;
			const deltaY = e.clientY - this.cropResizeStart.y;
			
			// Convert screen delta to canvas delta
			const canvasDeltaX = deltaX / this.displayScale;
			const canvasDeltaY = deltaY / this.displayScale;
			
			// Since the crop frame is transformed by zoom, we need to inverse the delta
			// to get the equivalent change in original crop frame coordinates
			// If visual movement = original movement * zoom, then original movement = visual movement / zoom
			const originalDeltaX = canvasDeltaX / this.userZoom;
			const originalDeltaY = canvasDeltaY / this.userZoom;
			
			// Apply resize based on handle
			switch (this.resizeHandle) {
				case 'left':
					this.cropRect.x = this.originalCropRect.x + originalDeltaX;
					this.cropRect.width = this.originalCropRect.width - originalDeltaX;
					break;
				case 'right':
					this.cropRect.width = this.originalCropRect.width + originalDeltaX;
					break;
				case 'top':
					this.cropRect.y = this.originalCropRect.y + originalDeltaY;
					this.cropRect.height = this.originalCropRect.height - originalDeltaY;
					break;
				case 'bottom':
					this.cropRect.height = this.originalCropRect.height + originalDeltaY;
					break;
			}
			
			// Ensure minimum size
			this.cropRect.width = Math.max(50, this.cropRect.width);
			this.cropRect.height = Math.max(50, this.cropRect.height);
			
			// Re-render all layers
			this.renderAllLayers();
			return;
		}
		
		// Update cursor based on hover state - use same coordinate system as crop frame rendering
		if (this.cropModeActive && this.canvas) {
			const resizeHandle = this.getCropResizeHandle(canvasCoords.x, canvasCoords.y);
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
			} else if (this.currentTool === 'viewport-pan') {
				this.canvas.style.cursor = 'grab';
			} else {
				this.canvas.style.cursor = 'crosshair';
			}
		}
		
		// Handle drawing and other actions - need proper coordinate transformation
		const zoomedCoords = this.canvasToZoomedCoords(canvasCoords.x, canvasCoords.y);
		
		// Handle layer dragging with hand tool
		if (this.isDraggingLayers) {
			const deltaX = e.clientX - this.layersDragStart.x;
			const deltaY = e.clientY - this.layersDragStart.y;
			
			// Convert screen pixel deltas to canvas logical coordinates, accounting for zoom
			const scaledDeltaX = deltaX / (this.displayScale * this.userZoom);
			const scaledDeltaY = deltaY / (this.displayScale * this.userZoom);
			
			this.layersOffset.x = this.layersStartOffset.x + scaledDeltaX;
			this.layersOffset.y = this.layersStartOffset.y + scaledDeltaY;
			
			// Re-render all layers with new offset
			this.renderAllLayers();
			return;
		}
		
		// Handle viewport dragging with viewport-pan tool
		if (this.isDraggingViewport) {
			const deltaX = e.clientX - this.viewportDragStart.x;
			const deltaY = e.clientY - this.viewportDragStart.y;
			
			// Since the transformation order changed, viewport offset calculation also changes
			// The viewport offset is now applied BEFORE zoom, so screen movement maps directly
			const scaledDeltaX = deltaX / this.displayScale;
			const scaledDeltaY = deltaY / this.displayScale;
			
			this.viewportOffset.x = this.viewportStartOffset.x + scaledDeltaX;
			this.viewportOffset.y = this.viewportStartOffset.y + scaledDeltaY;
			
			// Re-render all layers with new viewport offset
			this.renderAllLayers();
			return;
		}
		
		// Handle drawing - use zoomed coordinates for accurate drawing
		if (this.isDrawing && this.editLayerCtx) {
			const fullScreenshotX = zoomedCoords.x - this.layersOffset.x;
			const fullScreenshotY = zoomedCoords.y - this.layersOffset.y;
			
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
		
		const canvasCenterX = (this.canvas?.width || 0) / 2;
		const canvasCenterY = (this.canvas?.height || 0) / 2;
		
		const rect = this.cropRect;
		const visualCenterX = canvasCenterX + this.viewportOffset.x;
		const visualCenterY = canvasCenterY + this.viewportOffset.y;
		
		// 用Canvas API获取实际的变换后位置
		if (!this.ctx) return null;
		
		this.ctx.save();
		this.ctx.translate(this.viewportOffset.x, this.viewportOffset.y);
		this.ctx.translate(visualCenterX, visualCenterY);
		this.ctx.scale(this.userZoom, this.userZoom);
		this.ctx.translate(-visualCenterX, -visualCenterY);
		
		const actualTopLeft = this.ctx.getTransform().transformPoint(new DOMPoint(rect.x, rect.y));
		const actualTopRight = this.ctx.getTransform().transformPoint(new DOMPoint(rect.x + rect.width, rect.y));
		const actualBottomLeft = this.ctx.getTransform().transformPoint(new DOMPoint(rect.x, rect.y + rect.height));
		const actualBottomRight = this.ctx.getTransform().transformPoint(new DOMPoint(rect.x + rect.width, rect.y + rect.height));
		
		this.ctx.restore();
		
		const threshold = 10;
		
		// 边缘检测 - 使用黑色框的正确坐标
		if (Math.abs(x - actualTopLeft.x) < threshold && y >= actualTopLeft.y - threshold && y <= actualBottomLeft.y + threshold) {
			return 'left';
		}
		if (Math.abs(x - actualTopRight.x) < threshold && y >= actualTopRight.y - threshold && y <= actualBottomRight.y + threshold) {
			return 'right';
		}
		if (Math.abs(y - actualTopLeft.y) < threshold && x >= actualTopLeft.x - threshold && x <= actualTopRight.x + threshold) {
			return 'top';
		}
		if (Math.abs(y - actualBottomLeft.y) < threshold && x >= actualBottomLeft.x - threshold && x <= actualBottomRight.x + threshold) {
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
		
		// Handle viewport dragging completion  
		if (this.isDraggingViewport) {
			this.isDraggingViewport = false;
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
		if (this.isDraggingViewport) {
			this.isDraggingViewport = false;
		}
	}
	
	private handleGlobalMouseMove(e: MouseEvent) {
		// Handle layer dragging globally
		if (this.isDraggingLayers) {
			const deltaX = e.clientX - this.layersDragStart.x;
			const deltaY = e.clientY - this.layersDragStart.y;
			
			// Convert screen pixel deltas to canvas logical coordinates, accounting for zoom
			const scaledDeltaX = deltaX / (this.displayScale * this.userZoom);
			const scaledDeltaY = deltaY / (this.displayScale * this.userZoom);
			
			this.layersOffset.x = this.layersStartOffset.x + scaledDeltaX;
			this.layersOffset.y = this.layersStartOffset.y + scaledDeltaY;
			
			// Re-render all layers with new offset
			this.renderAllLayers();
		}
	}
	
	private handleGlobalMouseUp(e: MouseEvent) {
		// Handle layer dragging completion globally
		if (this.isDraggingLayers) {
			this.isDraggingLayers = false;
		}
		if (this.isDraggingViewport) {
			this.isDraggingViewport = false;
		}
	}

	private handleCanvasWheel(e: WheelEvent) {
		// Only enable wheel zoom in crop mode when mouse is over the mask area (not crop area)
		if (!this.cropModeActive || !this.canvas) return;
		
		const canvasCoords = this.screenToCanvasCoords(e.clientX, e.clientY);
		
		// Check if mouse is in the mask area (outside the crop area)
		if (this.isMouseInMaskArea(canvasCoords.x, canvasCoords.y)) {
			e.preventDefault(); // Prevent page scroll
			
			// Calculate zoom delta (negative deltaY means scroll up = zoom in)
			const zoomFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
			const newZoom = Math.max(0.25, Math.min(4, this.userZoom * zoomFactor));
			
			this.setUserZoom(newZoom);
			
			getLogger().log('🔍 Mouse wheel zoom:', this.userZoom);
		}
	}

	private isMouseInMaskArea(canvasX: number, canvasY: number): boolean {
		if (!this.cropModeActive) return false;
		
		// Mouse is in mask area if in crop mode (including both semi-transparent area and crop area)
		return true;
	}

	private isMouseInCropArea(canvasX: number, canvasY: number): boolean {
		if (!this.cropModeActive) return false;
		
		// Calculate the correct crop area position using the same logic as rendering
		const canvasCenterX = (this.canvas?.width || 0) / 2;
		const canvasCenterY = (this.canvas?.height || 0) / 2;
		const visualCenterX = canvasCenterX + this.viewportOffset.x;
		const visualCenterY = canvasCenterY + this.viewportOffset.y;
		
		// Apply the same transformation as in renderSemiTransparentMask to get correct crop area
		if (!this.ctx) return false;
		
		this.ctx.save();
		this.ctx.translate(this.viewportOffset.x, this.viewportOffset.y);
		this.ctx.translate(visualCenterX, visualCenterY);
		this.ctx.scale(this.userZoom, this.userZoom);
		this.ctx.translate(-visualCenterX, -visualCenterY);
		
		const correctTopLeft = this.ctx.getTransform().transformPoint(new DOMPoint(this.cropRect.x, this.cropRect.y));
		const correctBottomRight = this.ctx.getTransform().transformPoint(new DOMPoint(this.cropRect.x + this.cropRect.width, this.cropRect.y + this.cropRect.height));
		
		this.ctx.restore();
		
		// Check if mouse is inside the transformed crop area
		return canvasX >= correctTopLeft.x && 
			   canvasX <= correctBottomRight.x && 
			   canvasY >= correctTopLeft.y && 
			   canvasY <= correctBottomRight.y;
	}



	private saveToHistory() {
		if (!this.editLayerCtx || !this.editLayerCanvas || !this.highlighterLayerCtx || !this.highlighterLayerCanvas) return;
		
		// Save both edit layer and highlighter layer states
		const editImageData = this.editLayerCtx.getImageData(0, 0, this.editLayerCanvas.width, this.editLayerCanvas.height);
		const highlighterImageData = this.highlighterLayerCtx.getImageData(0, 0, this.highlighterLayerCanvas.width, this.highlighterLayerCanvas.height);
		
		// Store as a combined state object
		const combinedState = { edit: editImageData, highlighter: highlighterImageData };
		
		this.history = this.history.slice(0, this.historyIndex + 1);
		this.history.push(combinedState); // No more type assertion needed
		this.historyIndex = this.history.length - 1;
		
		if (this.history.length > 20) {
			this.history.shift();
			this.historyIndex--;
		}
	}

	private restoreFromHistory() {
		if (!this.editLayerCtx || !this.highlighterLayerCtx || this.historyIndex < 0 || this.historyIndex >= this.history.length) return;
		
		const state = this.history[this.historyIndex];
		
		// Check if this is the new HistoryState format
		if (state && typeof state === 'object' && 'edit' in state && 'highlighter' in state) {
			// New format with both layers
			const historyState = state as HistoryState;
			this.editLayerCtx.putImageData(historyState.edit, 0, 0);
			this.highlighterLayerCtx.putImageData(historyState.highlighter, 0, 0);
		} else {
			// Backward compatibility with old single-layer history
			const imageData = state as ImageData;
			this.editLayerCtx.putImageData(imageData, 0, 0);
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

	private getFileName(): string {
		// Get user input or generate default filename
		if (this.fileNameInput && this.fileNameInput.value.trim()) {
			let fileName = this.fileNameInput.value.trim();
			// Ensure it has .png extension
			if (!fileName.toLowerCase().endsWith('.png')) {
				fileName += '.png';
			}
			return fileName;
		}
		
		// Fallback to timestamp-based filename
		const timestamp = formatTimestampForFilename();
		return `screenshot-${timestamp}.png`;
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
			getLogger().error('Failed to save image to vault:', error);
			// Return null on error
			return null;
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

	/**
	 * Validate filename for legality and check for conflicts
	 */
	private async validateFileName(): Promise<void> {
		getLogger().log('validateFileName called');
		if (!this.fileNameInput || !this.fileNameWarning || !this.fileNameInvalidWarning) {
			getLogger().log('Missing filename validation elements');
			return;
		}
		
		const fileName = this.getFileName();
		getLogger().log('Validating file name:', fileName);
		
		// Check file name validity first
		const isValidName = this.isValidFileName(fileName);
		if (!isValidName) {
			this.updateInvalidFileNameWarning(true);
			this.updateFileNameWarning(false);
			this.updateSaveButtons(false);
			return;
		} else {
			this.updateInvalidFileNameWarning(false);
			this.updateSaveButtons(true);
		}
		
		// Then check for conflicts
		await this.checkFileNameConflict();
	}

	/**
	 * Check if filename contains invalid characters
	 */
	private isValidFileName(fileName: string): boolean {
		if (!fileName || fileName.trim() === '') {
			return false;
		}
		
		// Check for invalid characters: \ / : * ? " < > |
		const invalidChars = /[\\/:*?"<>|]/;
		if (invalidChars.test(fileName)) {
			return false;
		}
		
		// Check for reserved names on Windows
		const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;
		if (reservedNames.test(fileName)) {
			return false;
		}
		
		// Check for names that start or end with space/period
		if (fileName.startsWith(' ') || fileName.endsWith(' ') || 
		    fileName.startsWith('.') || fileName.endsWith('.')) {
			return false;
		}
		
		// Check for extremely long filenames
		if (fileName.length > 255) {
			return false;
		}
		
		return true;
	}

	/**
	 * Update save buttons state
	 */
	private updateSaveButtons(enabled: boolean): void {
		this.saveButtons.forEach(button => {
			button.disabled = !enabled;
		});
	}

	/**
	 * Update invalid filename warning
	 */
	private updateInvalidFileNameWarning(show: boolean): void {
		if (!this.fileNameInvalidWarning) return;
		
		this.fileNameInvalidWarning.toggleClass('hidden', !show);
		if (show) {
			this.fileNameInvalidWarning.textContent = t('imageEditor.fileNameInvalidWarning');
			this.fileNameInvalidWarning.title = t('imageEditor.fileNameInvalidTooltip');
		} else {
			this.fileNameInvalidWarning.textContent = '';
			this.fileNameInvalidWarning.title = '';
		}
	}
	private async checkFileNameConflict(): Promise<void> {
		getLogger().log('checkFileNameConflict called');
		if (!this.fileNameInput || !this.fileNameWarning) {
			getLogger().log('Missing fileNameInput or fileNameWarning elements');
			return;
		}
		
		const fileName = this.getFileName();
		getLogger().log('Checking file name:', fileName);
		if (!fileName) {
			this.updateFileNameWarning(false);
			return;
		}
		
		try {
			// Determine the target save path
			let targetPath = fileName;
			const saveLocation = this.plugin.settings.defaultSaveLocation;
			if (saveLocation && saveLocation.trim() !== '') {
				targetPath = `${saveLocation}/${fileName}`;
			}
			getLogger().log('Checking target path:', targetPath);
			
			// Check if file exists in vault
			const vault = this.plugin.app.vault;
			const fileExists = await vault.adapter.exists(targetPath);
			getLogger().log('File exists:', fileExists);
			
			if (fileExists) {
				this.updateFileNameWarning(true);
			} else {
				this.updateFileNameWarning(false);
			}
			
		} catch (error) {
			// On error, hide warning to avoid false positives
			getLogger().warn('Failed to check file existence:', error);
			this.updateFileNameWarning(false);
		}
	}
	
	/**
	 * Update file name conflict warning
	 */
	private updateFileNameWarning(show: boolean): void {
		if (!this.fileNameWarning) return;
		
		this.fileNameWarning.toggleClass('hidden', !show);
		if (show) {
			this.fileNameWarning.textContent = t('imageEditor.fileNameConflictWarning');
			this.fileNameWarning.title = t('imageEditor.fileNameConflictTooltip');
		} else {
			this.fileNameWarning.textContent = '';
			this.fileNameWarning.title = '';
		}
	}

	private createZoomControls(toolbar: HTMLElement) {
		// Create zoom control container with horizontal layout
		const zoomContainer = toolbar.createDiv({ cls: 'zoom-controls-container' });
		zoomContainer.style.display = 'flex';
		zoomContainer.style.alignItems = 'center';
		zoomContainer.style.gap = '4px';
		
		// Zoom slider (拉长到240px，原来是80px的3倍) - 移到最左边
		const zoomSlider = zoomContainer.createEl('input', { 
			type: 'range',
			cls: 'zoom-slider',
		});
		zoomSlider.style.width = '240px';  // 从80px增加到240px (3倍长)
		zoomSlider.style.margin = '0 8px';  // 增加一点边距
		zoomSlider.min = Math.log(0.25).toString();
		zoomSlider.max = Math.log(4).toString();
		zoomSlider.step = '0.01';
		zoomSlider.value = Math.log(this.userZoom).toString();
		
		// Zoom level display - 放在滑块右边
		const zoomDisplay = zoomContainer.createEl('span', { 
			cls: 'zoom-display',
			text: Math.round(this.userZoom * 100) + '%'
		});
		zoomDisplay.style.minWidth = '40px';
		zoomDisplay.style.textAlign = 'center';
		zoomDisplay.style.fontSize = '12px';
		
		// Zoom out button (移到右侧)
		const zoomOutBtn = zoomContainer.createEl('button', { cls: 'btn-base btn-icon zoom-btn' });
		setIcon(zoomOutBtn, 'zoom-out');
		zoomOutBtn.setAttribute('data-tooltip', 'Zoom Out');
		zoomOutBtn.addEventListener('click', () => {
			this.setUserZoom(Math.max(0.25, this.userZoom / 1.25));
		});
		
		// Zoom in button (移到右侧)
		const zoomInBtn = zoomContainer.createEl('button', { cls: 'btn-base btn-icon zoom-btn' });
		setIcon(zoomInBtn, 'zoom-in');
		zoomInBtn.setAttribute('data-tooltip', 'Zoom In');
		zoomInBtn.addEventListener('click', () => {
			this.setUserZoom(Math.min(4, this.userZoom * 1.25));
		});
		
		// Reset zoom button (1:1) - 移到最右侧
		const resetZoomBtn = zoomContainer.createEl('button', { cls: 'btn-base zoom-reset-btn' });
		resetZoomBtn.textContent = '1:1';
		resetZoomBtn.style.fontSize = '10px';
		resetZoomBtn.style.minWidth = '24px';
		resetZoomBtn.setAttribute('data-tooltip', 'Reset Zoom (100%)');
		resetZoomBtn.addEventListener('click', () => {
			this.setUserZoom(1.0);
		});
		
		// Slider change handler
		zoomSlider.addEventListener('input', (e) => {
			const logValue = parseFloat((e.target as HTMLInputElement).value);
			const zoomValue = Math.exp(logValue);
			
			// Update zoom without updating slider (to avoid circular updates)
			this.userZoom = Math.max(0.25, Math.min(4, zoomValue));
			
			// Update only the display text, not the slider
			zoomDisplay.textContent = Math.round(this.userZoom * 100) + '%';
			
			// Re-render with new zoom
			this.renderAllLayers();
			
			getLogger().log('🔍 User zoom changed to:', this.userZoom);
		});
		
		// Store references for later updates
		const existingData = this.toolbarElements.get(toolbar) || {};
		this.toolbarElements.set(toolbar, {
			...existingData,
			zoomSlider,
			zoomDisplay
		});
		
		getLogger().log('🔍 Created zoom controls with initial zoom:', this.userZoom);
	}
	
	private setUserZoom(zoom: number) {
		// Clamp zoom to valid range
		this.userZoom = Math.max(0.25, Math.min(4, zoom));
		
		// Update UI
		this.updateZoomDisplay();
		
		// Re-render with new zoom
		this.renderAllLayers();
		
		getLogger().log('🔍 User zoom changed to:', this.userZoom);
	}
	
	private updateZoomDisplay() {
		// Update zoom display for the current toolbar
		const toolbar = document.querySelector('.image-editor-toolbar');
		if (toolbar) {
			const toolbarData = this.toolbarElements.get(toolbar as HTMLElement);
			if (toolbarData?.zoomSlider && toolbarData?.zoomDisplay) {
				toolbarData.zoomSlider.value = Math.log(this.userZoom).toString();
				toolbarData.zoomDisplay.textContent = Math.round(this.userZoom * 100) + '%';
				getLogger().log('🔍 Updated zoom display to:', Math.round(this.userZoom * 100) + '%');
			} else {
				getLogger().warn('🔍 Could not find zoom UI elements to update');
			}
		} else {
			getLogger().warn('🔍 Could not find image editor toolbar');
		}
	}

	// Coordinate transformation helpers
	private screenToCanvasCoords(screenX: number, screenY: number): { x: number, y: number } {
		if (!this.canvas) return { x: screenX, y: screenY };
		
		const rect = this.canvas.getBoundingClientRect();
		
		// Convert screen coordinates to canvas logical coordinates
		const canvasX = (screenX - rect.left) * (this.canvas.width / rect.width);
		const canvasY = (screenY - rect.top) * (this.canvas.height / rect.height);
		
		return { x: canvasX, y: canvasY };
	}
	
	private canvasToZoomedCoords(canvasX: number, canvasY: number): { x: number, y: number } {
		// Use the same method as crop frame detection - apply the exact transform and invert
		if (!this.ctx) return { x: canvasX, y: canvasY };
		
		const canvasCenterX = (this.canvas?.width || 0) / 2;
		const canvasCenterY = (this.canvas?.height || 0) / 2;
		const visualCenterX = canvasCenterX + this.viewportOffset.x;
		const visualCenterY = canvasCenterY + this.viewportOffset.y;
		
		// Apply the same transform as in rendering
		this.ctx.save();
		this.ctx.translate(this.viewportOffset.x, this.viewportOffset.y);
		this.ctx.translate(visualCenterX, visualCenterY);
		this.ctx.scale(this.userZoom, this.userZoom);
		this.ctx.translate(-visualCenterX, -visualCenterY);
		
		// Get the inverse transform matrix
		const transform = this.ctx.getTransform();
		const inverse = transform.inverse();
		
		// Apply inverse transform to get the logical coordinates
		const logicalPoint = inverse.transformPoint(new DOMPoint(canvasX, canvasY));
		
		this.ctx.restore();
		
		return { x: logicalPoint.x, y: logicalPoint.y };
	}
	
	// Special coordinate transformation for crop frame detection (ignores viewport offset)
	private canvasToCropCoords(canvasX: number, canvasY: number): { x: number, y: number } {
		// Apply only zoom inverse transformation, not viewport offset
		const zoomCenterX = (this.canvas?.width || 0) / 2;
		const zoomCenterY = (this.canvas?.height || 0) / 2;
		
		// Apply only zoom inverse transformation
		let x = canvasX - zoomCenterX;
		let y = canvasY - zoomCenterY;
		x = x / this.userZoom;
		y = y / this.userZoom;
		x = x + zoomCenterX;
		y = y + zoomCenterY;
		
		return { x, y };
	}
	
	private screenToZoomedCoords(screenX: number, screenY: number): { x: number, y: number } {
		const canvasCoords = this.screenToCanvasCoords(screenX, screenY);
		return this.canvasToZoomedCoords(canvasCoords.x, canvasCoords.y);
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