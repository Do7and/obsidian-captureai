export interface ImageCaptureSettings {
	defaultSaveLocation: string;
	enableAIAnalysis: boolean;
	imageFormat: 'png' | 'jpg';
	enableRegionSelect: boolean;
}

export const DEFAULT_SETTINGS: ImageCaptureSettings = {
	defaultSaveLocation: '',
	enableAIAnalysis: true,
	imageFormat: 'png',
	enableRegionSelect: true
};

export interface EditTool {
	name: string;
	icon: string;
	cursor: string;
}

export interface Region {
	x: number;
	y: number;
	width: number;
	height: number;
}

export type StrokeSize = 'small' | 'medium' | 'large';

export interface StrokeSetting {
	size: StrokeSize;
	width: number;
}