import ImageCapturePlugin from '../main';

export class Logger {
	private plugin: ImageCapturePlugin;

	constructor(plugin: ImageCapturePlugin) {
		this.plugin = plugin;
	}

	private get isDebugEnabled(): boolean {
		return this.plugin.settings.enableDebugLogging;
	}

	log(...args: any[]): void {
		if (this.isDebugEnabled) {
			console.log('[Screenshot Capture]', ...args);
		}
	}

	info(...args: any[]): void {
		if (this.isDebugEnabled) {
			console.info('[Screenshot Capture]', ...args);
		}
	}

	warn(...args: any[]): void {
		if (this.isDebugEnabled) {
			console.warn('[Screenshot Capture]', ...args);
		}
	}

	error(...args: any[]): void {
		if (this.isDebugEnabled) {
			console.error('[Screenshot Capture]', ...args);
		}
	}

	debug(...args: any[]): void {
		if (this.isDebugEnabled) {
			console.debug('[Screenshot Capture]', ...args);
		}
	}
}

// 创建一个全局日志实例，可以在没有插件实例的地方使用
let globalLogger: Logger | null = null;

export function initializeLogger(plugin: ImageCapturePlugin): void {
	globalLogger = new Logger(plugin);
}

export function getLogger(): Logger {
	if (!globalLogger) {
		throw new Error('Logger not initialized. Call initializeLogger first.');
	}
	return globalLogger;
}

// 便捷的全局日志函数
export function debugLog(...args: any[]): void {
	if (globalLogger) {
		globalLogger.log(...args);
	}
}

export function debugInfo(...args: any[]): void {
	if (globalLogger) {
		globalLogger.info(...args);
	}
}

export function debugWarn(...args: any[]): void {
	if (globalLogger) {
		globalLogger.warn(...args);
	}
}

export function debugError(...args: any[]): void {
	if (globalLogger) {
		globalLogger.error(...args);
	}
}