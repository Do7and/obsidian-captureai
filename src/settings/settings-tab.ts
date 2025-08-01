import { App, PluginSettingTab, Setting } from 'obsidian';
import ImageCapturePlugin from '../main';

export class ImageCaptureSettingTab extends PluginSettingTab {
	plugin: ImageCapturePlugin;

	constructor(app: App, plugin: ImageCapturePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Image Capture Settings' });

		new Setting(containerEl)
			.setName('Default save location')
			.setDesc('Directory where captured images will be saved. Leave empty to use vault root.')
			.addText(text => text
				.setPlaceholder('Enter folder path (e.g., attachments/screenshots)')
				.setValue(this.plugin.settings.defaultSaveLocation)
				.onChange(async (value) => {
					this.plugin.settings.defaultSaveLocation = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Image format')
			.setDesc('Choose the format for saved images')
			.addDropdown(dropdown => dropdown
				.addOption('png', 'PNG (lossless)')
				.addOption('jpg', 'JPG (compressed)')
				.setValue(this.plugin.settings.imageFormat)
				.onChange(async (value: 'png' | 'jpg') => {
					this.plugin.settings.imageFormat = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Enable region selection')
			.setDesc('Allow selecting specific regions of the screen to capture')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableRegionSelect)
				.onChange(async (value) => {
					this.plugin.settings.enableRegionSelect = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Enable AI analysis')
			.setDesc('Enable AI-powered image analysis features (experimental)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableAIAnalysis)
				.onChange(async (value) => {
					this.plugin.settings.enableAIAnalysis = value;
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('h3', { text: 'Shortcuts' });
		
		const shortcutsDesc = containerEl.createEl('div', { cls: 'setting-item-description' });
		shortcutsDesc.innerHTML = `
			<p>Available keyboard shortcuts:</p>
			<ul>
				<li><kbd>Escape</kbd> - Cancel region selection</li>
				<li><kbd>Ctrl/Cmd + Z</kbd> - Undo last edit</li>
				<li><kbd>Ctrl/Cmd + Y</kbd> - Redo last edit</li>
			</ul>
		`;

		containerEl.createEl('h3', { text: 'Usage' });
		
		const usageDesc = containerEl.createEl('div', { cls: 'setting-item-description' });
		usageDesc.innerHTML = `
			<p>How to use the screenshot capture plugin:</p>
			<ol>
				<li>Click the camera icon in the ribbon or use the command palette</li>
				<li>Select "Capture selected area" or "Capture full screen"</li>
				<li>For region capture: drag to select the area you want to capture</li>
				<li>Use the editing tools to annotate your screenshot</li>
				<li>Click "Save" to save the image to your vault</li>
			</ol>
			<p><strong>Note:</strong> This plugin requires Obsidian to be running on a desktop platform with Electron support.</p>
		`;

		containerEl.createEl('h3', { text: 'Troubleshooting' });
		
		const troubleshootingDesc = containerEl.createEl('div', { cls: 'setting-item-description' });
		troubleshootingDesc.innerHTML = `
			<p>If screenshots are not working:</p>
			<ul>
				<li>Make sure you're running Obsidian on desktop (not mobile)</li>
				<li>Try restarting Obsidian</li>
				<li>Check that you have proper screen recording permissions on macOS</li>
				<li>Use the "Test desktopCapturer API" command to diagnose issues</li>
			</ul>
		`;
	}
}