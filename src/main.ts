import { Plugin, Notice } from 'obsidian';
import { ScreenshotManager } from './managers/screenshot-manager';
import { ImageEditor } from './editors/image-editor';
import { ImageCaptureSettingTab } from './settings/settings-tab';
import { ImageCaptureSettings, DEFAULT_SETTINGS } from './types';

export default class ImageCapturePlugin extends Plugin {
	settings: ImageCaptureSettings;
	screenshotManager: ScreenshotManager;
	imageEditor: ImageEditor;

	async onload() {
		await this.loadSettings();

		this.screenshotManager = new ScreenshotManager(this);
		this.imageEditor = new ImageEditor(this);

		this.addRibbonIcon('camera', 'Screenshot Capture', (evt: MouseEvent) => {
			this.screenshotManager.startRegionCapture();
		});

		this.addCommand({
			id: 'capture-selected-area',
			name: 'Capture selected area',
			callback: () => this.screenshotManager.startRegionCapture()
		});

		this.addCommand({
			id: 'capture-full-screen',
			name: 'Capture full screen',
			callback: () => this.screenshotManager.captureFullScreen()
		});

		this.addCommand({
			id: 'test-desktop-capturer',
			name: 'Test desktopCapturer API',
			callback: async () => {
				await this.testAdvancedCapture();
			}
		});

		this.addSettingTab(new ImageCaptureSettingTab(this.app, this));
	}

	onunload() {
		if (this.screenshotManager) {
			this.screenshotManager.cleanup();
		}
		if (this.imageEditor) {
			this.imageEditor.cleanup();
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async testAdvancedCapture() {
		try {
			new Notice('Testing advanced capture methods...');
			console.log('Testing advanced capture methods...');
			
			const electron = this.getElectronAPI();
			if (electron && electron.remote) {
				try {
					const remoteElectron = electron.remote.require('electron');
					const desktopCapturer = remoteElectron.desktopCapturer;
					const fs = electron.remote.require('fs');
					const path = electron.remote.require('path');
					
					if (desktopCapturer) {
						new Notice('Remote desktopCapturer accessible, testing capture...');
						console.log('Remote desktopCapturer accessible, testing capture...');
						
						const sources = await desktopCapturer.getSources({
							types: ['screen'],
							thumbnailSize: { width: 0, height: 0 }
						});
						
						new Notice(`Found ${sources.length} screen sources`);
						console.log(`Found ${sources.length} screen sources:`, sources);
						
						if (sources.length > 0) {
							const primarySource = sources[0];
							new Notice(`Primary source: ${primarySource.name}`);
							console.log(`Primary source: ${primarySource.name}`);
							
							const fullSources = await desktopCapturer.getSources({
								types: ['screen'],
								thumbnailSize: { width: 1920, height: 1080 }
							});
							
							if (fullSources.length > 0) {
								const thumbnail = fullSources[0].thumbnail;
								if (thumbnail && !thumbnail.isEmpty()) {
									new Notice('Screenshot captured successfully!');
									console.log('Screenshot captured successfully!');
									console.log('Thumbnail size:', thumbnail.getSize());
									
									const dataURL = thumbnail.toDataURL();
									console.log('Data URL length:', dataURL.length);
									
									const base64Data = dataURL.replace(/^data:image\/png;base64,/, "");
									const fileName = `screenshot-${Date.now()}.png`;
									const filePath = path.join((this.app.vault.adapter as any).getBasePath(), fileName);
									
									fs.writeFile(filePath, base64Data, 'base64', (err: any) => {
										if (err) {
											new Notice(`Failed to save screenshot: ${err.message}`);
											console.error('Failed to save screenshot:', err);
										} else {
											new Notice(`Screenshot saved to: ${fileName}`);
											console.log(`Screenshot saved to: ${filePath}`);
										}
									});
									
									return true;
								}
							}
						}
					} else {
						new Notice('desktopCapturer not available through remote');
						console.log('desktopCapturer not available through remote');
					}
				} catch (e: any) {
					new Notice(`Error accessing remote desktopCapturer: ${e.message}`);
					console.log('Error accessing remote desktopCapturer:', e);
				}
			}
			
			new Notice('Advanced capture test completed');
		} catch (error: any) {
			new Notice(`Error in advanced test: ${error.message}`);
			console.error('Error in advanced test:', error);
		}
	}

	getElectronAPI() {
		try {
			console.log('🔍 Checking for Electron API...');
			
			// Check for modern Electron API
			if ((window as any).electron) {
				console.log('✅ Found window.electron');
				const electronAPI = (window as any).electron;
				console.log('🔍 Electron API properties:', Object.keys(electronAPI));
				return electronAPI;
			}
			
			// Check for legacy require method
			if ((window as any).require) {
				console.log('✅ Found window.require, attempting to load electron...');
				try {
					const electron = (window as any).require('electron');
					console.log('✅ Successfully required electron');
					console.log('🔍 Electron properties:', Object.keys(electron));
					
					const api = {
						desktopCapturer: electron.desktopCapturer,
						screen: electron.screen,
						remote: electron.remote
					};
					
					console.log('🔍 Constructed API object:', {
						hasDesktopCapturer: !!api.desktopCapturer,
						hasScreen: !!api.screen,
						hasRemote: !!api.remote
					});
					
					return api;
				} catch (requireError: any) {
					console.error('❌ Failed to require electron:', requireError);
				}
			}
			
			// Check if we're in a Node.js environment
			console.log('🔍 Environment check:', {
				hasProcess: typeof process !== 'undefined',
				hasGlobal: typeof global !== 'undefined',
				hasWindow: typeof window !== 'undefined',
				userAgent: navigator.userAgent
			});
			
			console.error('❌ No Electron API found');
			return null;
			
		} catch (error: any) {
			console.error('❌ Error accessing Electron API:', error);
			console.error('Error details:', {
				name: error.name,
				message: error.message,
				stack: error.stack
			});
			return null;
		}
	}
}