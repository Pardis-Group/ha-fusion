/**
 * Home automations that run on the dashboard server:
 *
 * Auto brightness: lamps follow the time of day. Low while there is daylight, full in
 * the evening, then dimmer towards bedtime and very low at night. Sunrise and sunset
 * come from Home Assistant's own sun (worked out locally from the home's position;
 * nothing is sent anywhere). Lights the user changes by hand are left alone until they
 * are switched off and on again.
 *
 * Movie mode: when a film or episode plays on the living-room TV (seen by
 * scripts/tv-watch.mjs over adb), lights that are on go to the Movie scene, a soft light
 * while paused, and back to how they were when the film stops.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { enabled, ha, service, effectRunning, sleepTimerOn, stop as stopEffects } from './effects';

const SETTINGS_FILE = './data/automations.json';
const TV_FILE = './data/tv-status.json';
const TRANSITION = 32;

export interface Settings {
	adaptive: {
		enabled: boolean;
		/** light entity ids, or 'all' */
		lights: string[] | 'all';
		wake: string; // "07:00"
		bedtime: string; // "23:30"
		morning: number; // brightness %, from wake-up until there is daylight
		day: number; // while the sun is up
		evening: number; // after sunset
		bedtimeLevel: number; // at bedtime
		night: number; // an hour after bedtime until wake-up
		warmth: boolean; // also make white light warmer in the evening
	};
	movie: {
		enabled: boolean;
		/** 'playbox': films and episodes in PlayBox; 'any': any video on the TV */
		source: 'playbox' | 'any';
		lights: string[] | 'all';
		level: number; // Movie scene brightness %
		pause: 'soft' | 'keep';
	};
}

export const defaults: Settings = {
	adaptive: {
		enabled: true,
		lights: 'all',
		wake: '07:00',
		bedtime: '23:30',
		morning: 70,
		day: 35,
		evening: 100,
		bedtimeLevel: 40,
		night: 5,
		warmth: true
	},
	movie: { enabled: true, source: 'playbox', lights: 'all', level: 12, pause: 'soft' }
};

let settings: Settings = load();

function load(): Settings {
	try {
		const s = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
		return { adaptive: { ...defaults.adaptive, ...s.adaptive }, movie: { ...defaults.movie, ...s.movie } };
	} catch {
		return structuredClone(defaults);
	}
}

const clamp = (v: unknown, lo: number, hi: number, d: number) => {
	const n = Number(v);
	return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d;
};
const hhmm = (v: unknown, d: string) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : d);
const lightList = (v: unknown) =>
	v === 'all' || !Array.isArray(v) ? 'all' : v.filter((e) => typeof e === 'string' && e.startsWith('light.'));

export function saveSettings(input: any) {
	const a = input?.adaptive ?? {};
	const m = input?.movie ?? {};
	const d = defaults;
	settings = {
		adaptive: {
			enabled: Boolean(a.enabled ?? settings.adaptive.enabled),
			lights: lightList(a.lights ?? settings.adaptive.lights),
			wake: hhmm(a.wake, settings.adaptive.wake),
			bedtime: hhmm(a.bedtime, settings.adaptive.bedtime),
			morning: clamp(a.morning, 1, 100, d.adaptive.morning),
			day: clamp(a.day, 1, 100, d.adaptive.day),
			evening: clamp(a.evening, 1, 100, d.adaptive.evening),
			bedtimeLevel: clamp(a.bedtimeLevel, 1, 100, d.adaptive.bedtimeLevel),
			night: clamp(a.night, 1, 100, d.adaptive.night),
			warmth: Boolean(a.warmth ?? settings.adaptive.warmth)
		},
		movie: {
			enabled: Boolean(m.enabled ?? settings.movie.enabled),
			source: m.source === 'any' ? 'any' : 'playbox',
			lights: lightList(m.lights ?? settings.movie.lights),
			level: clamp(m.level, 1, 100, d.movie.level),
			pause: m.pause === 'keep' ? 'keep' : 'soft'
		}
	};
	writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, '\t'));
	lastAdaptive = 0; // apply the new curve right away
	return settings;
}

export const getSettings = () => settings;

/* ---------- time of day in the home's time zone ---------- */

let timeZone = process.env.TZ || 'Europe/Berlin';
let sun = { sunrise: 7 * 60, sunset: 17 * 60, fetched: 0 };

const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const fmt = (m: number) => {
	m = ((Math.round(m) % 1440) + 1440) % 1440;
	return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
function localMinutes(d: Date) {
	const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
	const h = Number(parts.find((p) => p.type === 'hour')?.value) % 24;
	const min = Number(parts.find((p) => p.type === 'minute')?.value);
	return h * 60 + min + d.getSeconds() / 60;
}

async function refreshSun() {
	if (Date.now() - sun.fetched < 30 * 60_000) return;
	try {
		const config = await ha('/api/config');
		if (config?.time_zone) timeZone = config.time_zone;
		const s = await ha('/api/states/sun.sun');
		// the next rise/set is today's or tomorrow's; a day apart they differ by a minute or two
		sun = {
			sunrise: localMinutes(new Date(s.attributes.next_rising)),
			sunset: localMinutes(new Date(s.attributes.next_setting)),
			fetched: Date.now()
		};
	} catch (e) {
		console.error('automations: sun', (e as Error).message);
	}
}

/* ---------- the brightness curve ---------- */

type Point = [number, number, number]; // minutes after wake-up, brightness %, kelvin

function keypoints(a: Settings['adaptive']): Point[] {
	const W = toMin(a.wake);
	const B = toMin(a.bedtime);
	const rel = (m: number) => (((m - W) % 1440) + 1440) % 1440;
	let tSunUp = rel(sun.sunrise + 60); // an hour after sunrise the room has daylight
	const tSunDown = rel(sun.sunset - 60);
	if (tSunUp > tSunDown) tSunUp = Math.min(60, tSunDown); // sun already up at wake-up (summer)
	const pts: Point[] = [
		[0, a.morning, 3200],
		[tSunUp, a.day, 4600],
		[tSunDown, a.day, 4600],
		[rel(sun.sunset + 30), a.evening, 3000],
		[rel(B - 120), a.evening, 2900],
		[rel(B), a.bedtimeLevel, 2400],
		[rel(B + 60), a.night, 2200],
		[1439, a.night, 2200]
	];
	// short winter days or a late sunset can cross points over: keep them in order
	for (let i = 1; i < pts.length; i++) pts[i][0] = Math.min(1439, Math.max(pts[i][0], pts[i - 1][0]));
	return pts;
}

/** target brightness % and kelvin at minute-of-day m */
export function curveAt(m: number, a = settings.adaptive) {
	const W = toMin(a.wake);
	const t = (((m - W) % 1440) + 1440) % 1440;
	const pts = keypoints(a);
	for (let i = 1; i < pts.length; i++) {
		const [t0, b0, k0] = pts[i - 1];
		const [t1, b1, k1] = pts[i];
		if (t <= t1) {
			const k = t1 > t0 ? (1 - Math.cos(((t - t0) / (t1 - t0)) * Math.PI)) / 2 : 1;
			return { pct: Math.round(b0 + (b1 - b0) * k), kelvin: Math.round(k0 + (k1 - k0) * k) };
		}
	}
	return { pct: a.night, kelvin: 2200 };
}

/* ---------- light state ---------- */

type State = { entity_id: string; state: string; attributes: any };
let states = new Map<string, State>();
const wasOn = new Map<string, boolean>();
const lastSet = new Map<string, { pct: number; at: number; fade: number }>();
const manual = new Map<string, number>(); // lights the user changed by hand -> since
const movieHeld = new Set<string>();

async function pollStates() {
	const all = (await ha('/api/states')) as State[];
	states = new Map(all.filter((s) => s.entity_id.startsWith('light.')).map((s) => [s.entity_id, s]));
}

const pctOf = (s: State) => Math.round(((s.attributes?.brightness ?? 0) / 255) * 100);
const canFade = (s: State) => ((s.attributes?.supported_features ?? 0) & TRANSITION) !== 0;
const targets = (list: string[] | 'all') => (list === 'all' ? [...states.keys()] : list.filter((e) => states.has(e)));

/** the dashboard tells us when someone sets a light by hand (scene, colour, brightness) */
export function markManual(entities: string[]) {
	for (const e of entities) if (e.startsWith('light.')) manual.set(e, Date.now());
}
export function resume(entities: string[]) {
	for (const e of entities) {
		manual.delete(e);
		lastSet.delete(e);
	}
	lastAdaptive = 0;
}

/* ---------- auto brightness ---------- */

let lastAdaptive = 0;

async function adaptive() {
	const a = settings.adaptive;
	const now = Date.now();
	const due = now - lastAdaptive > 60_000;
	if (due) lastAdaptive = now;
	const goal = curveAt(localMinutes(new Date()));

	for (const e of targets(a.lights)) {
		const s = states.get(e)!;
		const on = s.state === 'on';
		const turnedOn = on && wasOn.get(e) === false;
		wasOn.set(e, on);
		if (!on) {
			// switching a light off hands it back to the automation
			manual.delete(e);
			lastSet.delete(e);
			continue;
		}
		if (!a.enabled || effectRunning(e) || sleepTimerOn(e) || movieHeld.has(e) || manual.has(e)) continue;

		// someone changed the brightness elsewhere (app, voice, switch): leave it be
		const prev = lastSet.get(e);
		if (prev && now - prev.at > prev.fade * 1000 + 30_000 && Math.abs(pctOf(s) - prev.pct) > 6) {
			manual.set(e, now);
			continue;
		}
		if (!turnedOn && !due) continue;

		const data: Record<string, unknown> = { entity_id: e, brightness_pct: goal.pct };
		const white = s.attributes?.color_mode === 'color_temp';
		if (a.warmth && white) {
			const lo = s.attributes?.min_color_temp_kelvin ?? 2000;
			const hi = s.attributes?.max_color_temp_kelvin ?? 6500;
			const k = Math.min(hi, Math.max(lo, goal.kelvin));
			if (Math.abs((s.attributes?.color_temp_kelvin ?? 0) - k) > 60 || turnedOn) data.color_temp_kelvin = k;
		}
		const off = Math.abs(pctOf(s) - goal.pct);
		if (!turnedOn && off < 2 && !data.color_temp_kelvin) {
			lastSet.set(e, { pct: goal.pct, at: now, fade: 0 });
			continue;
		}
		const fade = canFade(s) ? (turnedOn ? 0.4 : 20) : 0;
		if (fade) data.transition = fade;
		lastSet.set(e, { pct: goal.pct, at: now, fade });
		await service('turn_on', data);
	}
}

/* ---------- movie mode ---------- */

type Tv = { online: boolean; awake?: boolean; playback: string; playbox: boolean; video: boolean; stream?: boolean; title: string; package: string; updated: number };
let tv: Tv = { online: false, playback: 'none', playbox: false, video: false, title: '', package: '', updated: 0 };
type MovieState = 'idle' | 'playing' | 'paused';
let movieState: MovieState = 'idle';
let wanted: MovieState = 'idle';
let wantedSince = 0;
let testOverride: MovieState | null = null;
const snapshot = new Map<string, Record<string, unknown>>();

function readTv(): MovieState {
	try {
		if (existsSync(TV_FILE)) tv = JSON.parse(readFileSync(TV_FILE, 'utf8'));
	} catch {
		/* half-written file: keep the last one */
	}
	const fresh = Date.now() - (tv.updated || 0) < 45_000;
	if (!fresh || !tv.online || tv.awake === false) return 'idle';
	const m = settings.movie;
	const ours = m.source === 'any' ? true : tv.video;
	if (!ours) return 'idle';
	if (tv.playback === 'playing' || tv.playback === 'buffering') return 'playing';
	if (tv.playback === 'paused') return 'paused';
	return 'idle';
}

async function applyMovie() {
	const lights = [...movieHeld];
	if (!lights.length) return;
	const fade = lights.filter((e) => states.get(e) && canFade(states.get(e)!));
	const plain = lights.filter((e) => !fade.includes(e));
	const data = { rgb_color: [50, 60, 200], brightness_pct: settings.movie.level };
	if (fade.length) await service('turn_on', { ...data, entity_id: fade, transition: 2 });
	if (plain.length) await service('turn_on', { ...data, entity_id: plain });
}

async function applySoft() {
	const lights = [...movieHeld];
	if (!lights.length) return;
	await service('turn_on', { entity_id: lights, color_temp_kelvin: 2700, brightness_pct: 35 });
}

async function restore() {
	for (const e of movieHeld) {
		const snap = snapshot.get(e);
		const s = states.get(e);
		lastSet.delete(e);
		if (!snap || !s || s.state !== 'on') continue; // switched off during the film: leave it off
		await service('turn_on', { entity_id: e, ...snap, ...(canFade(s) ? { transition: 2 } : {}) });
		// auto brightness carries on from here at its next regular step, with its usual slow fade,
		// instead of cutting into the 2-second return
		lastSet.set(e, { pct: Math.round(((snap.brightness as number) ?? 255) / 2.55), at: Date.now(), fade: 2 });
	}
	movieHeld.clear();
	snapshot.clear();
}

async function movie() {
	const m = settings.movie;
	const now = Date.now();
	const seen = testOverride ?? (m.enabled ? readTv() : 'idle');
	if (seen !== wanted) {
		wanted = seen;
		wantedSince = now;
	}
	// wait a moment before reacting, so a short gap between episodes doesn't flash the lights
	const hold = wanted === 'playing' ? 4000 : wanted === 'paused' ? 2000 : 10_000;
	if (wanted === movieState || now - wantedSince < (testOverride ? 0 : hold)) return;

	const from = movieState;
	movieState = wanted;
	console.log(`movie mode: ${from} -> ${movieState}${tv.title ? ` (${tv.title})` : ''}`);

	if (movieState === 'idle') return restore();

	if (from === 'idle') {
		// take the lights that are on, remember how they were, stop any effect on them
		for (const e of targets(m.lights)) {
			const s = states.get(e)!;
			if (s.state !== 'on') continue;
			const a = s.attributes ?? {};
			const snap: Record<string, unknown> = { brightness: a.brightness ?? 255 };
			if (a.color_mode === 'color_temp' && a.color_temp_kelvin) snap.color_temp_kelvin = a.color_temp_kelvin;
			else if (a.hs_color) snap.hs_color = a.hs_color;
			snapshot.set(e, snap);
			movieHeld.add(e);
		}
		stopEffects([...movieHeld]);
	}
	if (movieState === 'playing') await applyMovie();
	else if (movieState === 'paused' && m.pause === 'soft') await applySoft();
}

/** for testing without a film: force playing / paused / idle, or null to follow the TV again */
export function testMovie(state: 'playing' | 'paused' | 'idle' | null) {
	testOverride = state;
}

/* ---------- loop and status ---------- */

let started = false;
export function startAutomations() {
	if (started || !enabled()) return;
	started = true;
	const tick = async () => {
		try {
			await refreshSun();
			await pollStates();
			await movie();
			await adaptive();
		} catch (e) {
			console.error('automations:', (e as Error).message);
		}
		setTimeout(tick, 3000);
	};
	tick();
	console.log('automations started');
}

export function automationStatus() {
	const nowMin = localMinutes(new Date());
	const curve = Array.from({ length: 49 }, (_, i) => {
		const m = i * 30;
		return { time: fmt(m), ...curveAt(m) };
	});
	return {
		timeZone,
		now: fmt(nowMin),
		sunrise: fmt(sun.sunrise),
		sunset: fmt(sun.sunset),
		target: curveAt(nowMin),
		curve,
		manual: [...manual.keys()],
		movie: {
			state: movieState,
			test: testOverride,
			held: [...movieHeld],
			tv: { online: tv.online && Date.now() - (tv.updated || 0) < 45_000, playback: tv.playback, title: tv.title, playbox: tv.playbox, app: tv.package, video: tv.video }
		}
	};
}
