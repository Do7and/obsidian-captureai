import { Notice } from 'obsidian';
import ImageCapturePlugin from '../main';
import { Region } from '../types';
import { t } from '../i18n';
import { getLogger } from '../utils/logger';

export class ScreenshotManager {
	private plugin: ImageCapturePlugin;
	private overlay: HTMLElement | null = null;
	private selectionBox: HTMLElement | null = null;
	private isSelecting = false;
	private isScreenshotModeActive = false; // 全局截图状态监控
	private startX = 0;
	private startY = 0;
	private selectionCompleteCallback: ((region: Region | null) => void) | null = null;
	
	// Cache Electron API for performance
	private electronAPI: any = null;
	private desktopCapturer: any = null;

	// WeakMap storage for overlay element properties - replaces (element as any) patterns
	private overlayElements = new WeakMap<HTMLElement, {
		instructionEl?: HTMLElement;
		mouseIndicator?: HTMLElement;
		coordDisplay?: HTMLElement;
		cleanup?: () => void;
	}>();

	constructor(plugin: ImageCapturePlugin) {
		this.plugin = plugin;
	}

	/**
	 * Wait for window to be minimized by checking its state
	 */
	private async waitForWindowMinimized(window: any): Promise<void> {
		return new Promise((resolve) => {
			let checkCount = 0;
			const maxChecks = 50; // 50 * 10ms = 500ms max
			
			const checkMinimized = () => {
				checkCount++;
				getLogger().log(`🔍 Checking window state (attempt ${checkCount}): minimized=${window.isMinimized()}, visible=${window.isVisible()}, focused=${window.isFocused()}`);
				
				// Try multiple detection methods
				const isMinimized = window.isMinimized();
				const isNotVisible = !window.isVisible();
				const isNotFocused = !window.isFocused();
				
				// Consider minimized if any of these conditions are true
				if (isMinimized || (isNotVisible && isNotFocused)) {
					resolve();
					return;
				}
				
				if (checkCount >= maxChecks) {
					resolve();
					return;
				}
				
				// Check again after a short interval
				setTimeout(checkMinimized, 10);
			};
			
			// Start checking after a tiny delay to let the minimize start
			setTimeout(checkMinimized, 20);
		});
	}

	async startRegionCapture(minimizeWindow: boolean = false) {
		// 原子性检查和设置状态，防止竞态条件
		if (this.isScreenshotModeActive) {
			return;
		}
		// 立即设置状态，防止后续调用通过检查
		this.isScreenshotModeActive = true;
		
		let currentWindow: any = null;
		
		try {
			// Handle window minimization if requested
			if (minimizeWindow) {
				// Get Electron window instance
				const electron = this.plugin.getElectronAPI();
				if (!electron || !electron.remote) {
					getLogger().error('❌ Electron API not available for window control');
					new Notice(t('notice.electronAPINotAvailable'));
					return;
				}

				const { BrowserWindow } = electron.remote;
				currentWindow = BrowserWindow.getFocusedWindow();
				
				if (!currentWindow) {
					getLogger().error('❌ Could not get current window reference');
					new Notice(t('notice.windowControlNotAvailable'));
					return;
				}

				// Minimize the current window
				currentWindow.minimize();
				
				// Wait for window to actually minimize using state detection with fallback
				try {
					await this.waitForWindowMinimized(currentWindow);
				} catch (error) {
					await new Promise(resolve => setTimeout(resolve, 100));
				}
			}
			
			let region: Region | null = null;
			
			if (minimizeWindow) {
				// For minimized capture, skip region selection and use full screen
				getLogger().log('🔍 Using full screen region for minimized capture...');
				
				// Create a default selection region in the center of the screen (60% of screen size)
				const centerX = screen.width / 2;
				const centerY = screen.height / 2;
				const defaultWidth = Math.floor(screen.width * 0.6);
				const defaultHeight = Math.floor(screen.height * 0.6);
				
				region = {
					x: Math.floor(centerX - defaultWidth / 2),
					y: Math.floor(centerY - defaultHeight / 2),
					width: defaultWidth,
					height: defaultHeight
				};
				
				getLogger().log('🔍 Created default center selection region:', region);
			} else {
				// Normal capture with region selection
				getLogger().log('🔍 Creating overlay for region selection...');
				this.createOverlay();
				
				getLogger().log('🔍 Waiting for region selection...');
				region = await this.waitForRegionSelection();
				if (!region) {
					getLogger().log('❌ Region selection cancelled by user');
					new Notice(t('notice.regionSelectionCancelled'));
					return;
				}
				await new Promise(resolve => setTimeout(resolve, 20));
			}
			
			getLogger().log('✅ Region selected:', region);
			
			getLogger().log('🔍 Starting screen capture...');
			const screenshot = await this.captureScreen();
			if (!screenshot) {
				getLogger().error('❌ Failed to capture screen');
				// Restore window before showing notice if it was minimized
				if (currentWindow) {
					currentWindow.restore();
					currentWindow.focus();
				}
				new Notice(t('notice.screenCaptureFailed'));
				return;
			}
			
			// Immediately restore window after successful capture (async, non-blocking)
			if (currentWindow) {
				getLogger().log('🔍 Restoring window (async)...');
				// Don't await - let this run in background while we process the image
				currentWindow.restore();
				currentWindow.focus();
			}
			
			getLogger().log('✅ Screen captured successfully');
			
			if (minimizeWindow) {
				// For minimized capture, create extended crop to show selection handles
				getLogger().log('🔍 Creating extended crop with default selection...');
				const extendedImage = await this.createExtendedCrop(screenshot, region);
				
				getLogger().log('✅ Extended image created successfully');
				getLogger().log('🔍 Opening image editor with default selection...');
				this.plugin.imageEditor.showEditor(extendedImage.imageData, region, extendedImage.extendedRegion, screenshot);
			} else {
				// Normal capture with extended crop
				getLogger().log('🔍 Creating extended crop with surrounding area...');
				const extendedImage = await this.createExtendedCrop(screenshot, region);
				
				getLogger().log('✅ Extended image created successfully');
				getLogger().log('🔍 Opening image editor...');
				this.plugin.imageEditor.showEditor(extendedImage.imageData, region, extendedImage.extendedRegion, screenshot);
			}
			
		} catch (error: any) {
			getLogger().error('❌ Region capture failed:', error);
			getLogger().error('Error details:', {
				name: error.name,
				message: error.message,
				stack: error.stack
			});
			
			// Try to restore window even on error if it was minimized
			if (currentWindow) {
				try {
					currentWindow.restore();
					currentWindow.focus();
				} catch (restoreError) {
					getLogger().error('❌ Failed to restore window:', restoreError);
				}
			}
			
			new Notice(t(minimizeWindow ? 'notice.minimizedCaptureFailed' : 'notice.regionCaptureFailed', { message: error.message }));
			// Clean up overlay on failure
			this.removeOverlay();
		} finally {
			// 确保状态被重置
			this.isScreenshotModeActive = false;
		}
	}



	private createOverlay() {
		this.overlay = document.createElement('div');
		this.overlay.className = 'screenshot-overlay-base';
		
		// Add instructions for user
		const instructionEl = document.createElement('div');
		instructionEl.className = 'screenshot-instruction-base';
		instructionEl.createSpan({ text: t('notice.screenCapturingOverlayInstruction') });
		
		// Create selection indicator that shows current mouse position
		const mouseIndicator = document.createElement('div');
		mouseIndicator.className = 'mouse-indicator screenshot-mouse-indicator-base';
		
		this.selectionBox = document.createElement('div');
		this.selectionBox.className = 'screenshot-selection-base';
		
		// Add coordinate display
		const coordDisplay = document.createElement('div');
		coordDisplay.className = 'coord-display screenshot-coord-display-base';
		
		this.overlay.appendChild(this.selectionBox);
		document.body.appendChild(this.overlay);
		document.body.appendChild(instructionEl);
		document.body.appendChild(mouseIndicator);
		document.body.appendChild(coordDisplay);
		
		// Store references for cleanup
		this.overlayElements.set(this.overlay, {
			instructionEl: instructionEl,
			mouseIndicator: mouseIndicator,
			coordDisplay: coordDisplay
		});
		
		this.bindOverlayEvents();
	}

	private bindOverlayEvents() {
		if (!this.overlay || !this.selectionBox) return;
		
		let overlayData = this.overlayElements.get(this.overlay);
		if (!overlayData) return;
		
		const mouseIndicator = overlayData.mouseIndicator;
		const coordDisplay = overlayData.coordDisplay;
		
		const mouseDownHandler = (e: MouseEvent) => this.handleMouseDown(e, mouseIndicator, coordDisplay);
		const mouseMoveHandler = (e: MouseEvent) => this.handleMouseMove(e, mouseIndicator, coordDisplay);
		const mouseUpHandler = (e: MouseEvent) => this.handleMouseUp(e, mouseIndicator, coordDisplay);
		const keyDownHandler = (e: KeyboardEvent) => this.handleKeyDown(e);
		
		// Show crosshair when mouse enters overlay
		const mouseEnterHandler = (e: MouseEvent) => {
			if (mouseIndicator) {
				mouseIndicator.style.display = 'block';
				if (coordDisplay) coordDisplay.style.display = 'block';
			}
		};
		
		// Hide crosshair when mouse leaves overlay
		const mouseLeaveHandler = (e: MouseEvent) => {
			if (!this.isSelecting && mouseIndicator) {
				mouseIndicator.style.display = 'none';
				if (coordDisplay) coordDisplay.style.display = 'none';
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
		
		overlayData = this.overlayElements.get(this.overlay);
		if (overlayData) {
			overlayData.cleanup = cleanup;
			this.overlayElements.set(this.overlay, overlayData);
		}
	}

	private handleMouseDown(e: MouseEvent, mouseIndicator?: HTMLElement, coordDisplay?: HTMLElement) {
		this.isSelecting = true;
		
		// Use direct screen coordinates - much simpler and more reliable
		this.startX = e.screenX;
		this.startY = e.screenY;
		
		// 隐藏全局滤镜，显示选择框滤镜
		if (this.overlay) {
			this.overlay.addClass('selecting');
		}
		
		if (this.selectionBox) {
			this.selectionBox.style.display = 'block';
			// Position selection box using client coordinates for visual display
			this.selectionBox.style.left = e.clientX + 'px';
			this.selectionBox.style.top = e.clientY + 'px';
			this.selectionBox.style.width = '0px';
			this.selectionBox.style.height = '0px';
		}
		
		// Hide crosshair indicators during selection
		if (mouseIndicator) {
			mouseIndicator.style.display = 'none';
		}
	}

	private handleMouseMove(e: MouseEvent, mouseIndicator?: HTMLElement, coordDisplay?: HTMLElement) {
		// Update crosshair position if not selecting (use client coordinates for visual display)
		if (!this.isSelecting && mouseIndicator) {
			mouseIndicator.style.left = e.clientX + 'px';
			
			if (coordDisplay) {
				coordDisplay.style.left = (e.clientX + 10) + 'px';
				coordDisplay.style.top = (e.clientY - 30) + 'px';
				// Show screen coordinates in display for debugging
				coordDisplay.textContent = `Screen: ${e.screenX}, ${e.screenY}`;
			}
		}
		
		// Handle selection box during dragging
		if (!this.isSelecting || !this.selectionBox) return;
		
		// Calculate visual selection box using client coordinates
		const clientWidth = e.clientX - (this.selectionBox.style.left ? parseInt(this.selectionBox.style.left.replace('px', '')) : 0);
		const clientHeight = e.clientY - (this.selectionBox.style.top ? parseInt(this.selectionBox.style.top.replace('px', '')) : 0);
		
		// Get the starting client position from the selection box
		const startClientX = parseInt(this.selectionBox.style.left.replace('px', ''));
		const startClientY = parseInt(this.selectionBox.style.top.replace('px', ''));
		
		const width = e.clientX - startClientX;
		const height = e.clientY - startClientY;
		
		// Update visual selection box position using client coordinates
		this.selectionBox.style.left = (width < 0 ? e.clientX : startClientX) + 'px';
		this.selectionBox.style.top = (height < 0 ? e.clientY : startClientY) + 'px';
		this.selectionBox.style.width = Math.abs(width) + 'px';
		this.selectionBox.style.height = Math.abs(height) + 'px';
		
		// Update coordinate display during selection
		if (coordDisplay) {
			const currentScreenX = e.screenX;
			const currentScreenY = e.screenY;
			const screenWidth = Math.abs(currentScreenX - this.startX);
			const screenHeight = Math.abs(currentScreenY - this.startY);
			coordDisplay.style.left = (e.clientX + 10) + 'px';
			coordDisplay.style.top = (e.clientY - 30) + 'px';
			// Show both screen coordinates and dimensions
			coordDisplay.textContent = `Screen: ${Math.min(this.startX, currentScreenX)}, ${Math.min(this.startY, currentScreenY)} ${screenWidth}×${screenHeight}`;
		}
	}

	private handleMouseUp(e: MouseEvent, mouseIndicator?: HTMLElement, coordDisplay?: HTMLElement) {
		if (!this.isSelecting) return;
		this.isSelecting = false;
		
		if (this.selectionCompleteCallback) {
			// Use screen coordinates for the final region calculation
			const currentScreenX = e.screenX;
			const currentScreenY = e.screenY;
			
			// Calculate screen-based region
			const rect: Region = {
				x: Math.min(this.startX, currentScreenX),
				y: Math.min(this.startY, currentScreenY),
				width: Math.abs(currentScreenX - this.startX),
				height: Math.abs(currentScreenY - this.startY)
			};
			
			getLogger().log('🔍 Final screen-based selection region:', rect);
			
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
			const overlayData = this.overlayElements.get(this.overlay);
			if (overlayData && overlayData.cleanup) {
				overlayData.cleanup();
			}
			if (this.overlay.parentNode) {
				this.overlay.parentNode.removeChild(this.overlay);
			}
			
			// Clean up additional elements
			if (overlayData) {
				const instructionEl = overlayData.instructionEl;
				const mouseIndicator = overlayData.mouseIndicator;
				const coordDisplay = overlayData.coordDisplay;
				
				[instructionEl, mouseIndicator, coordDisplay].forEach((el) => {
					if (el && el.parentNode) {
						el.parentNode.removeChild(el);
					}
				});
				
				// Clear the WeakMap entry
				this.overlayElements.delete(this.overlay);
			}
		}
		
		// Force cleanup any lingering elements with screenshot classes
		const lingeringElements = document.querySelectorAll('.screenshot-overlay-base, .screenshot-selection-base, .screenshot-instruction-base, .screenshot-mouse-indicator-base, .screenshot-coord-display-base');
		lingeringElements.forEach((el) => {
			if (el.parentNode) {
				el.parentNode.removeChild(el);
			}
		});
		
		this.overlay = null;
		this.selectionBox = null;
		this.selectionCompleteCallback = null;
		
		// 重置截图模式状态
		this.isScreenshotModeActive = false;
	}

	private async captureScreen(): Promise<string | null> {
		try {
			// Use cached Electron API for better performance
			if (!this.electronAPI) {
				this.electronAPI = this.plugin.getElectronAPI();
				
				if (!this.electronAPI) {
					getLogger().error('❌ Electron API not available');
					new Notice(t('notice.electronAPINotAvailable'));
					return null;
				}
				
				if (!this.electronAPI.remote) {
					getLogger().error('❌ Electron remote not available');
					new Notice(t('notice.electronRemoteNotAvailable'));
					return null;
				}
				
				const remoteElectron = this.electronAPI.remote.require('electron');
				this.desktopCapturer = remoteElectron.desktopCapturer;
				
				if (!this.desktopCapturer) {
					getLogger().error('❌ desktopCapturer not available');
					new Notice(t('notice.desktopCapturerNotAvailable'));
					return null;
				}
			}
			
			// Fast path using cached API
			const sources = await this.desktopCapturer.getSources({
				types: ['screen'],
				thumbnailSize: { 
					width: screen.width,
					height: screen.height
				}
			});
			
			getLogger().log(`🔍 Found ${sources.length} screen sources for capture`);
			
			if (sources.length === 0) {
				getLogger().error('❌ No screen sources found - permission denied or no screens available');
				new Notice(t('notice.screenRecordingPermissionDenied'));
				return null;
			}
			
			const primarySource = sources[0];
			getLogger().log('🔍 Primary source:', primarySource.name);
			
			const primaryThumbnail = primarySource.thumbnail;
			if (!primaryThumbnail) {
				getLogger().error('❌ No thumbnail in source');
				new Notice(t('notice.noThumbnailAvailable'));
				return null;
			}
			
			if (primaryThumbnail.isEmpty()) {
				getLogger().error('❌ Thumbnail is empty');
				new Notice(t('notice.thumbnailEmpty'));
				return null;
			}
			
			const screenSize = primaryThumbnail.getSize();
			getLogger().log('🔍 Captured screen size:', screenSize);
			
			if (screenSize.width === 0 || screenSize.height === 0) {
				getLogger().error('❌ Invalid screen size, trying alternative method...');
				
				// Try with different thumbnail sizes
				const alternativeSizes = [
					{ width: 1280, height: 720 },
					{ width: 800, height: 600 },
					{ width: 640, height: 480 }
				];
				
				for (const size of alternativeSizes) {
					getLogger().log(`🔍 Trying alternative size: ${size.width}x${size.height}`);
					const altSources = await this.desktopCapturer.getSources({
						types: ['screen'],
						thumbnailSize: size
					});
					
					if (altSources.length > 0) {
						const altThumbnail = altSources[0].thumbnail;
						if (altThumbnail && !altThumbnail.isEmpty()) {
							const altSize = altThumbnail.getSize();
							getLogger().log(`🔍 Alternative capture size: ${altSize.width}x${altSize.height}`);
							
							if (altSize.width > 0 && altSize.height > 0) {
								getLogger().log('✅ Alternative capture successful!');
								const dataURL = altThumbnail.toDataURL();
								getLogger().log('✅ DataURL length:', dataURL.length);
								return dataURL;
							}
						}
					}
				}
				
				getLogger().error('❌ All capture attempts failed');
				new Notice(t('notice.allCaptureAttemptsFailed'));
				return null;
			}
			
			const dataURL = primaryThumbnail.toDataURL();
			return dataURL;
			
		} catch (error: any) {
			getLogger().error('❌ Screen capture failed with error:', error);
			getLogger().error('Error details:', {
				name: error.name,
				message: error.message,
				stack: error.stack
			});
			
			// Provide more specific error messages
			if (error.message.includes('denied')) {
				new Notice(t('notice.screenRecordingPermissionDenied'));
			} else if (error.message.includes('not available')) {
				new Notice(t('notice.screenCaptureApiError'));
			} else {
				new Notice(t('notice.screenCaptureGenericError', { message: error.message }));
			}
			return null;
		}
	}

	private async createExtendedCrop(imageData: string, region: Region): Promise<{imageData: string, extendedRegion: Region}> {
		return new Promise((resolve) => {
			const img = new Image();
			img.onload = () => {
				// Calculate extended region (1.2x the area around the original crop)
				const extensionFactor = 0.2; // 20% extension on each side (total 1.4x)
				const extensionX = Math.floor(region.width * extensionFactor);
				const extensionY = Math.floor(region.height * extensionFactor);
				
				// Calculate scale factors (screenshot should match screen resolution)
				const scaleX = img.width / screen.width;
				const scaleY = img.height / screen.height;
				
				// Apply scaling to screen coordinates
				const scaledX = region.x * scaleX;
				const scaledY = region.y * scaleY;
				const scaledWidth = region.width * scaleX;
				const scaledHeight = region.height * scaleY;
				const scaledExtensionX = extensionX * scaleX;
				const scaledExtensionY = extensionY * scaleY;
				
				const extendedRegion = {
					x: Math.max(0, scaledX - scaledExtensionX),
					y: Math.max(0, scaledY - scaledExtensionY),
					width: Math.min(img.width - Math.max(0, scaledX - scaledExtensionX), scaledWidth + scaledExtensionX * 2),
					height: Math.min(img.height - Math.max(0, scaledY - scaledExtensionY), scaledHeight + scaledExtensionY * 2)
				};
				
				// Adjust if extended region would go beyond screen bounds
				if (scaledX - scaledExtensionX < 0) {
					extendedRegion.width = scaledWidth + scaledExtensionX + scaledX;
				}
				if (scaledY - scaledExtensionY < 0) {
					extendedRegion.height = scaledHeight + scaledExtensionY + scaledY;
				}
				if (scaledX + scaledWidth + scaledExtensionX > img.width) {
					extendedRegion.width = img.width - extendedRegion.x;
				}
				if (scaledY + scaledHeight + scaledExtensionY > img.height) {
					extendedRegion.height = img.height - extendedRegion.y;
				}
				
				const canvas = document.createElement('canvas');
				const ctx = canvas.getContext('2d')!;
				
				canvas.width = extendedRegion.width;
				canvas.height = extendedRegion.height;
				
				// Draw the extended crop directly using scaled coordinates
				ctx.drawImage(
					img,
					extendedRegion.x, extendedRegion.y, extendedRegion.width, extendedRegion.height,
					0, 0, extendedRegion.width, extendedRegion.height
				);
				
				resolve({
					imageData: canvas.toDataURL('image/png'),
					extendedRegion: extendedRegion
				});
			};
			img.src = imageData;
		});
	}

	private async cropImage(imageData: string, region: Region): Promise<string> {
		return new Promise((resolve) => {
			const img = new Image();
			img.onload = () => {
				getLogger().log('🔍 Screenshot dimensions:', { width: img.width, height: img.height });
				
				// Calculate scale factors (screenshot should match screen resolution)
				const scaleX = img.width / screen.width;
				const scaleY = img.height / screen.height;
				
				// Apply scaling to get final crop coordinates - region is already in screen coordinates
				const finalX = region.x * scaleX;
				const finalY = region.y * scaleY;
				const finalWidth = region.width * scaleX;
				const finalHeight = region.height * scaleY;
				
				getLogger().log('🔍 Final crop coordinates (after scaling):', { 
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