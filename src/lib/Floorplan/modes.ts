/**
 * Light modes for the floor plan's light panel, inspired by the Tapo, Hue and LIFX apps.
 *
 * Scenes set one colour/brightness and are applied straight from the browser.
 * Effects change colour over time; they run on the dashboard server
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
	group: 'party' | 'holiday' | 'nature' | 'calm';
	palette: RGB[];
	/** cycle: palette in order; random: shuffled, never the same twice; hue: continuous rainbow */
	order: 'cycle' | 'random' | 'hue';
	/** ms a colour stays, then ms to blend into the next (at speed 1) */
	hold: number;
	fade: number;
	/** ms between commands to the bulbs; kept >= 400 so Matter bulbs keep up */
	frame: number;
	/** brightness range in percent */
	brightness: [number, number];
	/** how brightness moves inside the range */
	dynamics: 'steady' | 'breathe' | 'flicker' | 'flash' | 'rampUp' | 'rampDown';
	/** ms for one trip around the colour wheel (order 'hue') */
	hueCycle?: number;
	/** one-shot effects (sunrise, sunset) last this long and keep their last colour */
	duration?: number;
	/** switch the lights off when a one-shot effect ends */
	endOff?: boolean;
	swatch: string;
}

export type LightMode = StaticMode | DynamicMode;

export interface EffectOptions {
	/** 0.5 = half speed, 2 = double speed */
	speed: number;
	/** how much of each step is spent blending: 0 = colours jump, 1 = the effect's own feel, 2 = always blending */
	fade: number;
	/** true: every light shows the same colour at the same time */
	sync: boolean;
	/** brightness multiplier 0.05..1 */
	dim: number;
}

export const defaultOptions: EffectOptions = { speed: 1, fade: 1, sync: true, dim: 1 };

/** steps offered by the panel's sliders */
export const speedSteps = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
export const fadeSteps = [0, 0.25, 0.6, 1, 1.5, 2];
export const fadeNames = ['Instant', 'Quick', 'Short', 'Normal', 'Smooth', 'Very smooth'];

const grad = (...c: string[]) => `linear-gradient(135deg, ${c.join(', ')})`;

export const staticModes: StaticMode[] = [
	{ id: 'sleep', name: 'Sleep', kind: 'static', kelvin: 2200, brightness: 8, swatch: grad('#2b1d3a', '#7a4a2a') },
	{ id: 'night', name: 'Night light', kind: 'static', rgb: [255, 110, 30], brightness: 2, swatch: grad('#140d08', '#7a3a10') },
	{ id: 'relax', name: 'Relax', kind: 'static', kelvin: 2700, brightness: 55, swatch: grad('#ffb26b', '#ffd59e') },
	{ id: 'dinner', name: 'Dinner', kind: 'static', kelvin: 2500, brightness: 70, swatch: grad('#ff9f4a', '#ffcf8a') },
	{ id: 'reading', name: 'Reading', kind: 'static', kelvin: 4000, brightness: 90, swatch: grad('#ffe9c7', '#fff7ea') },
	{ id: 'focus', name: 'Focus', kind: 'static', kelvin: 5000, brightness: 100, swatch: grad('#fdfbf6', '#dfeaff') },
	{ id: 'energize', name: 'Energize', kind: 'static', kelvin: 6500, brightness: 100, swatch: grad('#e8f1ff', '#a9c8ff') },
	{ id: 'movie', name: 'Movie', kind: 'static', rgb: [50, 60, 200], brightness: 12, swatch: grad('#0d1033', '#3a46c8') },
	{ id: 'gaming', name: 'Gaming', kind: 'static', rgb: [130, 40, 255], brightness: 60, swatch: grad('#2a0a5e', '#8228ff', '#00c8ff') },
	{ id: 'romantic', name: 'Romantic', kind: 'static', rgb: [255, 40, 90], brightness: 30, swatch: grad('#5a0a24', '#ff2a5a') },
	{ id: 'golden', name: 'Golden hour', kind: 'static', rgb: [255, 140, 40], brightness: 65, swatch: grad('#ff7a2a', '#ffc457') },
	{ id: 'nature', name: 'Nature', kind: 'static', rgb: [90, 200, 80], brightness: 45, swatch: grad('#1f5a2a', '#7bd36a') }
];

const VIVID: RGB[] = [
	[255, 0, 110],
	[255, 140, 0],
	[255, 230, 0],
	[0, 230, 120],
	[0, 170, 255],
	[150, 0, 255]
];

export const dynamicModes: DynamicMode[] = [
	// ---- party ----
	{
		id: 'party', name: 'Party', kind: 'dynamic', group: 'party', palette: VIVID, order: 'cycle',
		hold: 1100, fade: 700, frame: 500, brightness: [95, 100], dynamics: 'steady',
		swatch: 'conic-gradient(from 45deg, #ff006e, #ff8c00, #ffe600, #00e678, #00aaff, #9600ff, #ff006e)'
	},
	{
		id: 'disco', name: 'Disco', kind: 'dynamic', group: 'party', palette: [...VIVID, [255, 255, 255]], order: 'random',
		hold: 350, fade: 150, frame: 500, brightness: [100, 100], dynamics: 'steady',
		swatch: 'radial-gradient(circle at 30% 30%, #fff, #ff006e 30%, #00aaff 60%, #1a0033)'
	},
	{
		id: 'rainbow', name: 'Rainbow', kind: 'dynamic', group: 'party', palette: [], order: 'hue', hueCycle: 30000,
		hold: 0, fade: 0, frame: 700, brightness: [100, 100], dynamics: 'steady',
		swatch: 'linear-gradient(90deg, #ff0000, #ffa500, #ffff00, #00ff00, #00bfff, #8a2be2)'
	},
	{
		id: 'neon', name: 'Neon', kind: 'dynamic', group: 'party',
		palette: [[255, 0, 200], [0, 230, 255], [120, 0, 255]], order: 'cycle',
		hold: 1600, fade: 1400, frame: 600, brightness: [80, 100], dynamics: 'breathe',
		swatch: grad('#ff00c8', '#7800ff', '#00e6ff')
	},
	// ---- holidays ----
	{
		id: 'christmas', name: 'Christmas', kind: 'dynamic', group: 'holiday',
		palette: [[255, 0, 0], [0, 190, 40], [255, 170, 40]], order: 'cycle',
		hold: 2600, fade: 1600, frame: 700, brightness: [85, 95], dynamics: 'steady',
		swatch: grad('#d4001a', '#0a8f2e', '#ffb347')
	},
	{
		id: 'candycane', name: 'Candy cane', kind: 'dynamic', group: 'holiday',
		palette: [[255, 0, 20], [255, 225, 215]], order: 'cycle',
		hold: 1600, fade: 900, frame: 600, brightness: [85, 95], dynamics: 'steady',
		swatch: 'repeating-linear-gradient(135deg, #e0001a 0 8px, #fff 8px 16px)'
	},
	{
		id: 'halloween', name: 'Halloween', kind: 'dynamic', group: 'holiday',
		palette: [[255, 90, 0], [120, 0, 255], [80, 255, 20], [255, 40, 0]], order: 'cycle',
		hold: 1300, fade: 900, frame: 550, brightness: [35, 100], dynamics: 'flicker',
		swatch: grad('#ff5a00', '#2a0b3d', '#50ff14')
	},
	{
		id: 'valentine', name: 'Valentine', kind: 'dynamic', group: 'holiday',
		palette: [[255, 0, 80], [255, 90, 170], [200, 0, 60]], order: 'cycle',
		hold: 2200, fade: 2200, frame: 800, brightness: [45, 85], dynamics: 'breathe',
		swatch: grad('#ff0050', '#ff5aaa', '#c8003c')
	},
	{
		id: 'nowruz', name: 'Nowruz', kind: 'dynamic', group: 'holiday',
		palette: [[60, 200, 90], [255, 120, 170], [255, 190, 60], [120, 190, 255]], order: 'cycle',
		hold: 2800, fade: 2600, frame: 900, brightness: [65, 90], dynamics: 'breathe',
		swatch: grad('#3cc85a', '#ff78aa', '#ffbe3c')
	},
	{
		id: 'yalda', name: 'Yalda', kind: 'dynamic', group: 'holiday',
		palette: [[200, 10, 40], [255, 140, 30], [130, 0, 25]], order: 'cycle',
		hold: 2600, fade: 2600, frame: 700, brightness: [40, 70], dynamics: 'flicker',
		swatch: grad('#82001a', '#c80a28', '#ff8c1e')
	},
	// ---- nature ----
	{
		id: 'aurora', name: 'Aurora', kind: 'dynamic', group: 'nature',
		palette: [[0, 255, 140], [0, 200, 255], [120, 0, 255], [0, 255, 90], [60, 120, 255]], order: 'cycle',
		hold: 2500, fade: 4500, frame: 1000, brightness: [55, 85], dynamics: 'breathe',
		swatch: grad('#00ff8c', '#00c8ff', '#7800ff')
	},
	{
		id: 'ocean', name: 'Ocean', kind: 'dynamic', group: 'nature',
		palette: [[0, 90, 255], [0, 170, 220], [0, 220, 200], [20, 60, 180]], order: 'cycle',
		hold: 2000, fade: 4000, frame: 1000, brightness: [50, 85], dynamics: 'breathe',
		swatch: grad('#003a8c', '#00aadc', '#00dcc8')
	},
	{
		id: 'forest', name: 'Forest', kind: 'dynamic', group: 'nature',
		palette: [[40, 160, 40], [120, 200, 40], [20, 110, 60], [180, 220, 80]], order: 'cycle',
		hold: 3000, fade: 4000, frame: 1200, brightness: [55, 75], dynamics: 'breathe',
		swatch: grad('#14501e', '#3ca028', '#b4dc50')
	},
	{
		id: 'fireplace', name: 'Fireplace', kind: 'dynamic', group: 'nature',
		palette: [[255, 70, 0], [255, 115, 10], [230, 40, 0], [255, 145, 30]], order: 'random',
		hold: 250, fade: 350, frame: 500, brightness: [35, 85], dynamics: 'flicker',
		swatch: 'radial-gradient(circle at 50% 80%, #ffd27a, #ff6a00 40%, #8a1a00 75%, #2a0a00)'
	},
	{
		id: 'candle', name: 'Candle', kind: 'dynamic', group: 'nature',
		palette: [[255, 130, 30], [255, 145, 45], [255, 115, 25]], order: 'random',
		hold: 200, fade: 300, frame: 450, brightness: [22, 50], dynamics: 'flicker',
		swatch: 'radial-gradient(circle at 50% 60%, #ffe2a0, #ff8a2a 40%, #3a1a08)'
	},
	{
		id: 'storm', name: 'Thunderstorm', kind: 'dynamic', group: 'nature',
		palette: [[40, 60, 150], [25, 35, 110], [60, 50, 140]], order: 'cycle',
		hold: 3000, fade: 3000, frame: 450, brightness: [12, 28], dynamics: 'flash',
		swatch: grad('#0a0f2a', '#283c96', '#c8d2ff')
	},
	{
		id: 'starry', name: 'Starry sky', kind: 'dynamic', group: 'nature',
		palette: [[20, 20, 110], [70, 20, 140], [10, 50, 140]], order: 'cycle',
		hold: 3000, fade: 5000, frame: 1100, brightness: [10, 40], dynamics: 'flicker',
		swatch: 'radial-gradient(circle at 70% 25%, #fff 0 2px, transparent 3px), radial-gradient(circle at 30% 60%, #fff 0 1.5px, transparent 2.5px), linear-gradient(135deg, #0a0a3a, #46148c)'
	},
	{
		id: 'lava', name: 'Lava', kind: 'dynamic', group: 'nature',
		palette: [[255, 40, 0], [190, 0, 20], [255, 100, 0]], order: 'cycle',
		hold: 2000, fade: 3000, frame: 900, brightness: [50, 85], dynamics: 'breathe',
		swatch: grad('#3a0000', '#be0014', '#ff6400')
	},
	// ---- calm and wake-up ----
	{
		id: 'breathe', name: 'Breathe', kind: 'dynamic', group: 'calm',
		palette: [[255, 170, 90]], order: 'cycle',
		hold: 3500, fade: 3500, frame: 800, brightness: [10, 70], dynamics: 'breathe',
		swatch: 'radial-gradient(circle, #ffd8a8, #ff9a4a 55%, #3a1f0e)'
	},
	{
		id: 'sunrise', name: 'Sunrise · 10 min', kind: 'dynamic', group: 'calm',
		palette: [[120, 0, 0], [255, 50, 0], [255, 120, 20], [255, 190, 110], [255, 235, 210]], order: 'cycle',
		hold: 0, fade: 0, frame: 5000, brightness: [1, 100], dynamics: 'rampUp', duration: 600000,
		swatch: 'linear-gradient(0deg, #780000, #ff3200 35%, #ffbe6e 70%, #fff0dc)'
	},
	{
		id: 'sunset', name: 'Sunset · 15 min', kind: 'dynamic', group: 'calm',
		palette: [[255, 210, 150], [255, 150, 60], [255, 90, 20], [180, 30, 10]], order: 'cycle',
		hold: 0, fade: 0, frame: 5000, brightness: [80, 2], dynamics: 'rampDown', duration: 900000, endOff: true,
		swatch: 'linear-gradient(180deg, #ffd296, #ff963c 40%, #ff5a14 70%, #b41e0a)'
	}
];

export const effectGroups: { id: DynamicMode['group']; name: string }[] = [
	{ id: 'party', name: 'Party' },
	{ id: 'holiday', name: 'Holidays' },
	{ id: 'nature', name: 'Nature' },
	{ id: 'calm', name: 'Calm and wake-up' }
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

/* ---------- colour maths shared by the engine and the page ---------- */

export function hsvToRgb(h: number, s: number, v: number): RGB {
	const f = (n: number) => {
		const k = (n + h / 60) % 6;
		return v - v * s * Math.max(Math.min(k, 4 - k, 1), 0);
	};
	return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
}

export function rgbToHsv([r, g, b]: RGB): [number, number, number] {
	r /= 255;
	g /= 255;
	b /= 255;
	const max = Math.max(r, g, b);
	const d = max - Math.min(r, g, b);
	let h = 0;
	if (d) {
		if (max === r) h = ((g - b) / d) % 6;
		else if (max === g) h = (b - r) / d + 2;
		else h = (r - g) / d + 4;
		h *= 60;
		if (h < 0) h += 360;
	}
	return [h, max ? d / max : 0, max];
}

/** blend two colours around the colour wheel, so red to blue goes through purple instead of grey */
export function mix(a: RGB, b: RGB, k: number): RGB {
	const [h1, s1, v1] = rgbToHsv(a);
	const [h2, s2, v2] = rgbToHsv(b);
	if (s1 < 0.15 || s2 < 0.15) {
		return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * k)) as RGB;
	}
	let dh = h2 - h1;
	if (dh > 180) dh -= 360;
	if (dh < -180) dh += 360;
	return hsvToRgb((h1 + dh * k + 360) % 360, s1 + (s2 - s1) * k, v1 + (v2 - v1) * k);
}

export const smooth = (k: number) => k * k * (3 - 2 * k);
