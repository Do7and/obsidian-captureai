import { Notice } from 'obsidian';
import ImageCapturePlugin from '../main';
import { Region } from '../types';

export class ScreenshotManager {
	private plugin: ImageCapturePlugin;
	private overlay: HTMLElement | null = null;
	private selectionBox: HTMLElement | null = null;
	private isSelecting = false;
	private startX = 0;
	private startY = 0;
	private selectionCompleteCallback: ((region: Region | null) => void) | null = null;

	constructor(plugin: ImageCapturePlugin) {
		this.plugin = plugin;
	}

	async startRegionCapture() {
		try {
			console.log('🚀 Starting region capture process...');
			new Notice('Starting region capture...');
			
			console.log('🔍 Creating overlay for region selection...');
			this.createOverlay();
			
			console.log('🔍 Waiting for region selection...');
			const region = await this.waitForRegionSelection();
			if (!region) {
				console.log('❌ Region selection cancelled by user');
				new Notice('Region selection cancelled');
				return;
			}
			
			console.log('✅ Region selected:', region);
			
			console.log('🔍 Starting screen capture...');
			const screenshot = await this.captureScreen();
			if (!screenshot) {
				console.error('❌ Failed to capture screen');
				new Notice('Failed to capture screen');
				return;
			}
			
			console.log('✅ Screen captured successfully');
			console.log('🔍 Cropping image to selected region...');
			const croppedImage = await this.cropImage(screenshot, region);
			
			console.log('✅ Image cropped successfully');
			console.log('🔍 Opening image editor...');
			this.plugin.imageEditor.showEditor(croppedImage, region);
			
		} catch (error: any) {
			console.error('❌ Region capture failed:', error);
			console.error('Error details:', {
				name: error.name,
				message: error.message,
				stack: error.stack
			});
			new Notice(`Region capture failed: ${error.message}`);
		}
	}

	async captureFullScreen() {
		try {
			new Notice('Capturing full screen...');
			
			const screenshot = await this.captureScreen();
			if (!screenshot) {
				new Notice('Failed to capture screen');
				return;
			}
			
			this.plugin.imageEditor.showEditor(screenshot, {x: 0, y: 0, width: 0, height: 0});
			
		} catch (error: any) {
			new Notice(`Full screen capture failed: ${error.message}`);
			console.error('Full screen capture failed:', error);
		}
	}

	private createOverlay() {
		this.overlay = document.createElement('div');
		this.overlay.className = 'screenshot-overlay';
		this.overlay.style.cssText = `
			position: fixed;
			top: 0;
			left: 0;
			width: 100vw;
			height: 100vh;
			background: rgba(0, 0, 0, 0.3);
			z-index: 2147483647;
			cursor: crosshair;
		`;
		
		// Add instructions for user
		const instructionEl = document.createElement('div');
		instructionEl.style.cssText = `
			position: fixed;
			top: 20px;
			left: 50%;
			transform: translateX(-50%);
			background: rgba(0, 0, 0, 0.8);
			color: white;
			padding: 10px 20px;
			border-radius: 5px;
			font-size: 14px;
			font-family: system-ui, -apple-system, sans-serif;
			z-index: 2147483648;
			pointer-events: none;
			text-align: center;
		`;
		instructionEl.innerHTML = `
			🖱️ 拖拽选择截图区域<br>
			<small>灰色区域仅在当前窗口内，但可以截取整个屏幕的任何区域<br>
			按 ESC 取消</small>
		`;
		
		// Create selection indicator that shows current mouse position
		const mouseIndicator = document.createElement('div');
		mouseIndicator.className = 'mouse-indicator';
		mouseIndicator.style.cssText = `
			position: fixed;
			width: 1px;
			height: 100vh;
			background: rgba(255, 0, 0, 0.8);
			display: none;
			pointer-events: none;
			z-index: 2147483646;
		`;
		
		this.selectionBox = document.createElement('div');
		this.selectionBox.className = 'screenshot-selection';
		this.selectionBox.style.cssText = `
			position: absolute;
			border: 2px solid #00ff00;
			background: rgba(0, 255, 0, 0.1);
			display: none;
			pointer-events: none;
		`;
		
		// Add coordinate display
		const coordDisplay = document.createElement('div');
		coordDisplay.className = 'coord-display';
		coordDisplay.style.cssText = `
			position: fixed;
			background: rgba(0, 0, 0, 0.8);
			color: white;
			padding: 4px 8px;
			border-radius: 3px;
			font-size: 11px;
			font-family: monospace;
			z-index: 2147483649;
			pointer-events: none;
			display: none;
		`;
		
		this.overlay.appendChild(this.selectionBox);
		document.body.appendChild(this.overlay);
		document.body.appendChild(instructionEl);
		document.body.appendChild(mouseIndicator);
		document.body.appendChild(coordDisplay);
		
		// Store references for cleanup
		(this.overlay as any)._instructionEl = instructionEl;
		(this.overlay as any)._mouseIndicator = mouseIndicator;
		(this.overlay as any)._coordDisplay = coordDisplay;
		
		this.bindOverlayEvents();
	}

	private bindOverlayEvents() {
		if (!this.overlay || !this.selectionBox) return;
		
		const mouseIndicator = (this.overlay as any)._mouseIndicator;
		const coordDisplay = (this.overlay as any)._coordDisplay;
		
		const mouseDownHandler = (e: MouseEvent) => this.handleMouseDown(e, mouseIndicator, coordDisplay);
		const mouseMoveHandler = (e: MouseEvent) => this.handleMouseMove(e, mouseIndicator, coordDisplay);
		const mouseUpHandler = (e: MouseEvent) => this.handleMouseUp(e, mouseIndicator, coordDisplay);
		const keyDownHandler = (e: KeyboardEvent) => this.handleKeyDown(e);
		
		// Show crosshair when mouse enters overlay
		const mouseEnterHandler = (e: MouseEvent) => {
			if (mouseIndicator) {
				mouseIndicator.style.display = 'block';
				coordDisplay.style.display = 'block';
			}
		};
		
		// Hide crosshair when mouse leaves overlay
		const mouseLeaveHandler = (e: MouseEvent) => {
			if (!this.isSelecting && mouseIndicator) {
				mouseIndicator.style.display = 'none';
				coordDisplay.style.display = 'none';
			}
		};
		
		this.overlay.addEventListener('mousedown', mouseDownHandler);
		this.overlay.addEventListener('mouseenter', mouseEnterHandler);
		this.overlay.addEventListener('mouseleave', mouseLeaveHandler);
		document.addEventListener('mousemove', mouseMoveHandler);
		document.addEventListener('mouseup', mouseUpHandler);
		document.addEventListener('keydown', keyDownHandler);
		
		const cleanup = () => {
			this.overlay?.removeEventListener('mousedown', mouseDownHandler);
			this.overlay?.removeEventListener('mouseenter', mouseEnterHandler);
			this.overlay?.removeEventListener('mouseleave', mouseLeaveHandler);
			document.removeEventListener('mousemove', mouseMoveHandler);
			document.removeEventListener('mouseup', mouseUpHandler);
			document.removeEventListener('keydown', keyDownHandler);
		};
		
		(this.overlay as any)._cleanup = cleanup;
	}

	private handleMouseDown(e: MouseEvent, mouseIndicator?: HTMLElement, coordDisplay?: HTMLElement) {
		this.isSelecting = true;
		this.startX = e.clientX;
		this.startY = e.clientY;
		
		if (this.selectionBox) {
			this.selectionBox.style.display = 'block';
			this.selectionBox.style.left = this.startX + 'px';
			this.selectionBox.style.top = this.startY + 'px';
			this.selectionBox.style.width = '0px';
			this.selectionBox.style.height = '0px';
		}
		
		// Hide crosshair indicators during selection
		if (mouseIndicator) {
			mouseIndicator.style.display = 'none';
		}
	}

	private handleMouseMove(e: MouseEvent, mouseIndicator?: HTMLElement, coordDisplay?: HTMLElement) {
		// Update crosshair position if not selecting
		if (!this.isSelecting && mouseIndicator) {
			mouseIndicator.style.left = e.clientX + 'px';
			
			if (coordDisplay) {
				coordDisplay.style.left = (e.clientX + 10) + 'px';
				coordDisplay.style.top = (e.clientY - 30) + 'px';
				coordDisplay.textContent = `${e.clientX}, ${e.clientY}`;
			}
		}
		
		// Handle selection box during dragging
		if (!this.isSelecting || !this.selectionBox) return;
		
		const width = e.clientX - this.startX;
		const height = e.clientY - this.startY;
		
		this.selectionBox.style.left = (width < 0 ? e.clientX : this.startX) + 'px';
		this.selectionBox.style.top = (height < 0 ? e.clientY : this.startY) + 'px';
		this.selectionBox.style.width = Math.abs(width) + 'px';
		this.selectionBox.style.height = Math.abs(height) + 'px';
		
		// Update coordinate display during selection
		if (coordDisplay) {
			const left = parseInt(this.selectionBox.style.left);
			const top = parseInt(this.selectionBox.style.top);
			const w = parseInt(this.selectionBox.style.width);
			const h = parseInt(this.selectionBox.style.height);
			coordDisplay.style.left = (e.clientX + 10) + 'px';
			coordDisplay.style.top = (e.clientY - 30) + 'px';
			coordDisplay.textContent = `${left},${top} ${w}×${h}`;
		}
	}

	private handleMouseUp(e: MouseEvent, mouseIndicator?: HTMLElement, coordDisplay?: HTMLElement) {
		if (!this.isSelecting) return;
		this.isSelecting = false;
		
		if (this.selectionBox && this.selectionCompleteCallback) {
			const rect: Region = {
				x: parseInt(this.selectionBox.style.left),
				y: parseInt(this.selectionBox.style.top),
				width: parseInt(this.selectionBox.style.width),
				height: parseInt(this.selectionBox.style.height)
			};
			
			if (rect.width > 10 && rect.height > 10) {
				this.selectionCompleteCallback(rect);
			} else {
				this.selectionCompleteCallback(null);
			}
		}
		
		this.removeOverlay();
	}

	private handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (this.selectionCompleteCallback) {
				this.selectionCompleteCallback(null);
			}
			this.removeOverlay();
		}
	}

	private waitForRegionSelection(): Promise<Region | null> {
		return new Promise((resolve) => {
			this.selectionCompleteCallback = resolve;
		});
	}

	private removeOverlay() {
		if (this.overlay) {
			if ((this.overlay as any)._cleanup) {
				(this.overlay as any)._cleanup();
			}
			if (this.overlay.parentNode) {
				this.overlay.parentNode.removeChild(this.overlay);
			}
			
			// Clean up additional elements
			const instructionEl = (this.overlay as any)._instructionEl;
			const mouseIndicator = (this.overlay as any)._mouseIndicator;
			const coordDisplay = (this.overlay as any)._coordDisplay;
			
			[instructionEl, mouseIndicator, coordDisplay].forEach(el => {
				if (el && el.parentNode) {
					el.parentNode.removeChild(el);
				}
			});
		}
		this.overlay = null;
		this.selectionBox = null;
		this.selectionCompleteCallback = null;
	}

	private async captureScreen(): Promise<string | null> {
		try {
			console.log('🔍 Starting screen capture...');
			
			const electron = this.plugin.getElectronAPI();
			console.log('🔍 Electron API:', electron ? 'Available' : 'Not available');
			
			if (!electron) {
				console.error('❌ Electron API not available');
				new Notice('Electron API not available - make sure you are running on desktop');
				return null;
			}
			
			if (!electron.remote) {
				console.error('❌ Electron remote not available');
				new Notice('Electron remote not available - try restarting Obsidian');
				return null;
			}
			
			console.log('🔍 Getting electron modules...');
			const remoteElectron = electron.remote.require('electron');
			const desktopCapturer = remoteElectron.desktopCapturer;
			
			if (!desktopCapturer) {
				console.error('❌ desktopCapturer not available');
				new Notice('desktopCapturer not available');
				return null;
			}
			
			// First, try to get screen sources with a small thumbnail to check availability
			console.log('🔍 Checking screen access permissions...');
			try {
				const testSources = await desktopCapturer.getSources({
					types: ['screen'],
					thumbnailSize: { width: 150, height: 150 }
				});
				
				console.log(`🔍 Permission check: Found ${testSources.length} screen sources`);
				if (testSources.length === 0) {
					console.error('❌ No screen sources available - permission denied');
					new Notice('Screen recording permission denied. Please grant screen recording permission to Obsidian in System Preferences.');
					return null;
				}
			} catch (permError: any) {
				console.error('❌ Permission check failed:', permError);
				new Notice('Screen recording permission check failed. Please check system permissions.');
				return null;
			}
			
			// Now get the actual screen capture with higher resolution
			console.log('🔍 Getting full screen capture...');
			const sources = await desktopCapturer.getSources({
				types: ['screen'],
				thumbnailSize: { 
					width: screen.width,
					height: screen.height
				}
			});
			
			console.log(`🔍 Found ${sources.length} screen sources for capture`);
			
			if (sources.length === 0) {
				console.error('❌ No screen sources found for capture');
				new Notice('No screen sources found - check screen recording permissions');
				return null;
			}
			
			const primarySource = sources[0];
			console.log('🔍 Primary source:', primarySource.name);
			
			const primaryThumbnail = primarySource.thumbnail;
			if (!primaryThumbnail) {
				console.error('❌ No thumbnail in source');
				new Notice('No thumbnail available');
				return null;
			}
			
			if (primaryThumbnail.isEmpty()) {
				console.error('❌ Thumbnail is empty');
				new Notice('Thumbnail is empty - check screen recording permissions in System Preferences');
				return null;
			}
			
			const screenSize = primaryThumbnail.getSize();
			console.log('🔍 Captured screen size:', screenSize);
			
			if (screenSize.width === 0 || screenSize.height === 0) {
				console.error('❌ Invalid screen size, trying alternative method...');
				
				// Try with different thumbnail sizes
				const alternativeSizes = [
					{ width: 1280, height: 720 },
					{ width: 800, height: 600 },
					{ width: 640, height: 480 }
				];
				
				for (const size of alternativeSizes) {
					console.log(`🔍 Trying alternative size: ${size.width}x${size.height}`);
					const altSources = await desktopCapturer.getSources({
						types: ['screen'],
						thumbnailSize: size
					});
					
					if (altSources.length > 0) {
						const altThumbnail = altSources[0].thumbnail;
						if (altThumbnail && !altThumbnail.isEmpty()) {
							const altSize = altThumbnail.getSize();
							console.log(`🔍 Alternative capture size: ${altSize.width}x${altSize.height}`);
							
							if (altSize.width > 0 && altSize.height > 0) {
								console.log('✅ Alternative capture successful!');
								const dataURL = altThumbnail.toDataURL();
								console.log('✅ DataURL length:', dataURL.length);
								return dataURL;
							}
						}
					}
				}
				
				console.error('❌ All capture attempts failed');
				new Notice('Failed to capture screen with any resolution - check system permissions');
				return null;
			}
			
			console.log('✅ Successfully captured screen, thumbnail size:', screenSize);
			const dataURL = primaryThumbnail.toDataURL();
			console.log('✅ DataURL length:', dataURL.length);
			return dataURL;
			
		} catch (error: any) {
			console.error('❌ Screen capture failed with error:', error);
			console.error('Error details:', {
				name: error.name,
				message: error.message,
				stack: error.stack
			});
			
			// Provide more specific error messages
			if (error.message.includes('denied')) {
				new Notice('Screen recording permission denied. Please check System Preferences > Security & Privacy > Privacy > Screen Recording');
			} else if (error.message.includes('not available')) {
				new Notice('Screen capture API not available. Please restart Obsidian.');
			} else {
				new Notice(`Screen capture error: ${error.message}`);
			}
			return null;
		}
	}

	private async cropImage(imageData: string, region: Region): Promise<string> {
		return new Promise((resolve) => {
			const img = new Image();
			img.onload = () => {
				console.log('🔍 Starting image crop process...');
				console.log('🔍 Original region (browser coordinates):', region);
				console.log('🔍 Screenshot dimensions:', { width: img.width, height: img.height });
				
				// Get window position and dimensions
				const windowX = window.screenX || window.screenLeft || 0;
				const windowY = window.screenY || window.screenTop || 0;
				
				console.log('🔍 Browser window position:', { x: windowX, y: windowY });
				console.log('🔍 Browser window inner size:', { 
					width: window.innerWidth, 
					height: window.innerHeight 
				});
				console.log('🔍 Browser window outer size:', { 
					width: window.outerWidth, 
					height: window.outerHeight 
				});
				console.log('🔍 Screen dimensions:', { 
					width: screen.width, 
					height: screen.height 
				});
				
				// Check if we're in fullscreen mode - improved detection
				const isFullscreen = window.outerWidth >= screen.width * 0.95 && 
								   window.outerHeight >= screen.height * 0.95;
				const isMaximized = window.outerWidth === screen.width && 
								  (window.outerHeight === screen.height || window.outerHeight === screen.height - 48); // Account for taskbar
				
				console.log('🔍 Window state detection:', {
					isFullscreen,
					isMaximized,
					windowSize: { w: window.outerWidth, h: window.outerHeight },
					screenSize: { w: screen.width, h: screen.height },
					coverage: { 
						w: (window.outerWidth / screen.width * 100).toFixed(1) + '%',
						h: (window.outerHeight / screen.height * 100).toFixed(1) + '%'
					}
				});
				
				let screenX, screenY;
				
				if (isFullscreen || isMaximized) {
					// In fullscreen or maximized, coordinates need minimal adjustment
					// Check if there are any browser UI elements affecting the coordinate system
					const hasVisibleUI = window.innerHeight < window.outerHeight - 10; // More than 10px difference suggests UI
					
					if (hasVisibleUI) {
						// Account for any visible browser UI
						const uiOffset = window.outerHeight - window.innerHeight;
						screenX = region.x + windowX;
						screenY = region.y + windowY + uiOffset;
						console.log('🔍 Fullscreen/Maximized with UI offset:', uiOffset);
					} else {
						// True fullscreen - direct mapping
						screenX = region.x + windowX;
						screenY = region.y + windowY;
						console.log('🔍 True fullscreen: direct coordinate mapping');
					}
				} else {
					// In windowed mode, calculate browser chrome offsets
					const titleBarHeight = window.outerHeight - window.innerHeight;
					const sidebarWidth = (window.outerWidth - window.innerWidth) / 2;
					
					console.log('🔍 Window chrome offsets:', { 
						titleBarHeight, 
						sidebarWidth 
					});
					
					// Convert browser coordinates to screen coordinates
					screenX = windowX + sidebarWidth + region.x;
					screenY = windowY + titleBarHeight + region.y;
				}
				
				console.log('🔍 Converted to screen coordinates:', { 
					x: screenX, 
					y: screenY, 
					width: region.width, 
					height: region.height 
				});
				
				// Calculate scale factors (screenshot should match screen resolution now)
				const scaleX = img.width / screen.width;
				const scaleY = img.height / screen.height;
				
				console.log('🔍 Scale factors:', { scaleX, scaleY });
				
				// Apply scaling to get final crop coordinates
				const finalX = screenX * scaleX;
				const finalY = screenY * scaleY;
				const finalWidth = region.width * scaleX;
				const finalHeight = region.height * scaleY;
				
				console.log('🔍 Final crop coordinates:', { 
					x: finalX, 
					y: finalY, 
					width: finalWidth, 
					height: finalHeight 
				});
				
				// Ensure coordinates are within image bounds
				const clampedX = Math.max(0, Math.min(finalX, img.width - 1));
				const clampedY = Math.max(0, Math.min(finalY, img.height - 1));
				const clampedWidth = Math.max(1, Math.min(finalWidth, img.width - clampedX));
				const clampedHeight = Math.max(1, Math.min(finalHeight, img.height - clampedY));
				
				console.log('🔍 Clamped coordinates:', { 
					x: clampedX, 
					y: clampedY, 
					width: clampedWidth, 
					height: clampedHeight 
				});
				
				// Create high-resolution canvas to maintain quality
				const canvas = document.createElement('canvas');
				canvas.width = clampedWidth;  // Use actual crop size to maintain resolution
				canvas.height = clampedHeight;
				
				const ctx = canvas.getContext('2d');
				if (ctx) {
					// Disable image smoothing for crisp pixels
					ctx.imageSmoothingEnabled = false;
					
					// Draw the cropped region at full resolution
					ctx.drawImage(
						img,
						clampedX, clampedY, clampedWidth, clampedHeight,  // Source rectangle
						0, 0, clampedWidth, clampedHeight  // Destination rectangle (full size)
					);
					
					console.log('✅ Image cropped successfully at full resolution');
				}
				
				resolve(canvas.toDataURL('image/png'));
			};
			img.src = imageData;
		});
	}

	cleanup() {
		this.removeOverlay();
	}
}