/**
 * Light modes for the floor plan's light panel, in the spirit of the Tapo app.
 *
 * Static modes set one colour/brightness and are applied straight from the browser.
 * Dynamic modes change colours over time; they run on the dashboard server
 * (src/lib/server/effects.ts) so they keep going when the page is closed.
 * This file is shared by both sides, so keep it free of browser or node imports.
 */

export type RGB = [number, number, number];

export interface StaticMode {
	id: string;
	name: string;
	kind: 'static';
	/** white light in kelvin, or a colour */
	kelvin?: number;
	rgb?: RGB;
	/** brightness in percent */
	brightness: number;
	/** CSS background for the tile */
	swatch: string;
}

export interface DynamicMode {
	id: string;
	name: string;
	kind: 'dynamic';
	palette: RGB[];
	/** how the next colour is chosen */
	pattern: 'cycle' | 'random' | 'flicker' | 'hue';
	/** milliseconds between steps */
	interval: number;
	/** seconds of fade per step, for bulbs that support transitions */
	transition: number;
	/** brightness range in percent; a random value in the range is used per step */
	brightness: [number, number];
	/** give each light a different colour instead of all the same */
	spread: boolean;
	swatch: string;
}

export type LightMode = StaticMode | DynamicMode;

const grad = (...c: string[]) => `linear-gradient(135deg, ${c.join(', ')})`;

export const staticModes: StaticMode[] = [
	{ id: 'sleep', name: 'Sleep', kind: 'static', kelvin: 2200, brightness: 8, swatch: grad('#2b1d3a', '#7a4a2a') },
	{ id: 'night', name: 'Night light', kind: 'static', rgb: [255, 120, 40], brightness: 3, swatch: grad('#1b1410', '#8a4a1a') },
	{ id: 'relax', name: 'Relax', kind: 'static', kelvin: 2700, brightness: 55, swatch: grad('#ffb26b', '#ffd59e') },
	{ id: 'reading', name: 'Reading', kind: 'static', kelvin: 4000, brightness: 90, swatch: grad('#ffe9c7', '#fff7ea') },
	{ id: 'focus', name: 'Focus', kind: 'static', kelvin: 5600, brightness: 100, swatch: grad('#e8f1ff', '#bcd6ff') },
	{ id: 'movie', name: 'Movie', kind: 'static', rgb: [60, 70, 200], brightness: 15, swatch: grad('#0d1033', '#3a46c8') },
	{ id: 'romantic', name: 'Romantic', kind: 'static', rgb: [255, 40, 90], brightness: 35, swatch: grad('#5a0a24', '#ff2a5a') },
	{ id: 'sunset', name: 'Sunset', kind: 'static', rgb: [255, 110, 40], brightness: 60, swatch: grad('#ff5e3a', '#ffb347') }
];

export const dynamicModes: DynamicMode[] = [
	{
		id: 'party',
		name: 'Party',
		kind: 'dynamic',
		palette: [
			[255, 0, 128],
			[0, 200, 255],
			[255, 220, 0],
			[140, 0, 255],
			[0, 255, 120],
			[255, 60, 0]
		],
		pattern: 'random',
		interval: 1200,
		transition: 0.4,
		brightness: [85, 100],
		spread: true,
		swatch: 'conic-gradient(from 45deg, #ff0080, #00c8ff, #ffdc00, #8c00ff, #00ff78, #ff0080)'
	},
	{
		id: 'halloween',
		name: 'Halloween',
		kind: 'dynamic',
		palette: [
			[255, 90, 0],
			[130, 0, 255],
			[60, 255, 30],
			[255, 40, 0]
		],
		pattern: 'flicker',
		interval: 1600,
		transition: 0.8,
		brightness: [35, 100],
		spread: true,
		swatch: grad('#ff5a00', '#2a0b3d', '#8200ff')
	},
	{
		id: 'christmas',
		name: 'Christmas',
		kind: 'dynamic',
		palette: [
			[255, 0, 0],
			[0, 200, 40],
			[255, 170, 40],
			[255, 220, 180]
		],
		pattern: 'cycle',
		interval: 3000,
		transition: 1.5,
		brightness: [80, 95],
		spread: true,
		swatch: grad('#d4001a', '#0a8f2e', '#ffb347')
	},
	{
		id: 'rainbow',
		name: 'Rainbow',
		kind: 'dynamic',
		palette: [],
		pattern: 'hue',
		interval: 1500,
		transition: 1.4,
		brightness: [100, 100],
		spread: true,
		swatch: 'linear-gradient(90deg, #ff0000, #ffa500, #ffff00, #00ff00, #00bfff, #8a2be2)'
	},
	{
		id: 'candle',
		name: 'Candle',
		kind: 'dynamic',
		palette: [
			[255, 120, 30],
			[255, 140, 40],
			[255, 100, 20]
		],
		pattern: 'flicker',
		interval: 600,
		transition: 0.3,
		brightness: [30, 70],
		spread: true,
		swatch: 'radial-gradient(circle at 50% 60%, #ffd27a, #ff7a1a 45%, #3a1a08)'
	},
	{
		id: 'ocean',
		name: 'Ocean',
		kind: 'dynamic',
		palette: [
			[0, 90, 255],
			[0, 170, 220],
			[0, 220, 200],
			[20, 60, 180]
		],
		pattern: 'cycle',
		interval: 4000,
		transition: 3.5,
		brightness: [50, 90],
		spread: true,
		swatch: grad('#003a8c', '#00aadc', '#00dcc8')
	},
	{
		id: 'aurora',
		name: 'Aurora',
		kind: 'dynamic',
		palette: [
			[0, 255, 140],
			[0, 200, 255],
			[120, 0, 255],
			[0, 255, 80]
		],
		pattern: 'cycle',
		interval: 5000,
		transition: 4.5,
		brightness: [60, 80],
		spread: true,
		swatch: grad('#00ff8c', '#00c8ff', '#7800ff')
	},
	{
		id: 'valentine',
		name: 'Valentine',
		kind: 'dynamic',
		palette: [
			[255, 0, 80],
			[255, 80, 160],
			[200, 0, 60]
		],
		pattern: 'cycle',
		interval: 3000,
		transition: 2,
		brightness: [55, 80],
		spread: true,
		swatch: grad('#ff0050', '#ff50a0', '#c8003c')
	}
];

export const allModes: LightMode[] = [...staticModes, ...dynamicModes];

export function findMode(id: string): LightMode | undefined {
	return allModes.find((m) => m.id === id);
}

/** quick colour swatches under the colour wheel */
export const swatches: RGB[] = [
	[255, 59, 48],
	[255, 149, 0],
	[255, 214, 10],
	[52, 199, 89],
	[0, 199, 190],
	[10, 132, 255],
	[94, 92, 230],
	[255, 55, 95]
];

export function hsvToRgb(h: number, s: number, v: number): RGB {
	const f = (n: number) => {
		const k = (n + h / 60) % 6;
		return v - v * s * Math.max(Math.min(k, 4 - k, 1), 0);
	};
	return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
}
