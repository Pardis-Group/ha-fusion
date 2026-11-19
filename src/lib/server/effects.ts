/**
 * Runs the light effects (party, fireplace, sunrise, ...) and sleep timers on the
 * dashboard server, so they keep going when the browser is closed.
 *
 * Every effect is a timeline: colours hold, then blend into the next one. Each
 * frame the engine asks the bulbs to fade to where the timeline will be one frame
 * later, so bulbs that support transitions move continuously; the others step.
 * Lights started together share one timeline, so they show the same colour unless
 * the user turns "same colour" off.
 *
 * It talks to Home Assistant's REST API with the long-lived token from
 * HASS_TOKEN or the file named by HASS_TOKEN_FILE. That token never leaves the server.
 */
import { readFileSync } from 'fs';
import {
	defaultOptions,
	findMode,
	hsvToRgb,
	mix,
	smooth,
	type DynamicMode,
	type EffectOptions,
	type RGB
} from '$lib/Floorplan/modes';

const TRANSITION = 32; // LightEntityFeature.TRANSITION

interface Run {
	id: number;
	mode: DynamicMode;
	options: EffectOptions;
	entities: string[];
	started: number;
	timer?: ReturnType<typeof setTimeout>;
	sequence: number[]; // palette indexes for random order
	lastSent: Map<string, { key: string; at: number }>;
	lastCheck: number;
}

interface SleepTimer {
	entity: string;
	start: number;
	ends: number;
	startBrightness: number;
	interval: ReturnType<typeof setInterval>;
}

const runs = new Map<number, Run>();
const owner = new Map<string, number>(); // entity_id -> run id
const timers = new Map<string, SleepTimer>();
const transitionSupport = new Map<string, boolean>();
let nextId = 1;

/* ---------- Home Assistant access ---------- */

function hassUrl() {
	return (process.env.HASS_URL || '').replace(/\/$/, '');
}

let cachedToken: string | undefined;
function serverToken() {
	if (cachedToken) return cachedToken;
	if (process.env.HASS_TOKEN) cachedToken = process.env.HASS_TOKEN.trim();
	else if (process.env.HASS_TOKEN_FILE) cachedToken = readFileSync(process.env.HASS_TOKEN_FILE, 'utf8').trim();
	return cachedToken;
}

export function enabled() {
	try {
		return Boolean(hassUrl() && serverToken());
	} catch {
		return false;
	}
}

export async function ha(path: string, init?: RequestInit) {
	const res = await fetch(`${hassUrl()}${path}`, {
		...init,
		headers: { Authorization: `Bearer ${serverToken()}`, 'Content-Type': 'application/json' },
		signal: AbortSignal.timeout(6000)
	});
	if (!res.ok) throw new Error(`${path}: ${res.status}`);
	return res.json();
}

export const service = (name: string, data: Record<string, unknown>) =>
	ha(`/api/services/light/${name}`, { method: 'POST', body: JSON.stringify(data) }).catch((e) =>
		console.error(`light.${name}:`, (e as Error).message)
	);

export async function statesOf(entities: string[]) {
	const all = (await ha('/api/states')) as { entity_id: string; state: string; attributes: any }[];
	const wanted = new Set(entities);
	return new Map(all.filter((s) => wanted.has(s.entity_id)).map((s) => [s.entity_id, s]));
}

/** checks a token sent by the browser, so only signed-in Home Assistant users can control effects */
const validTokens = new Map<string, number>();
export async function authorized(header: string | null) {
	const token = header?.replace(/^Bearer\s+/i, '').trim();
	if (!token) return false;
	const until = validTokens.get(token);
	if (until && until > Date.now()) return true;
	try {
		const res = await fetch(`${hassUrl()}/api/`, {
			headers: { Authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(5000)
		});
		if (res.ok) {
			validTokens.set(token, Date.now() + 5 * 60_000);
			return true;
		}
	} catch {
		/* treated as unauthorized */
	}
	return false;
}

/* ---------- shared with the automations ---------- */

/** an effect is playing on this light */
export const effectRunning = (entity: string) => owner.has(entity);
/** a sleep timer is dimming this light */
export const sleepTimerOn = (entity: string) => timers.has(entity);

/* ---------- status ---------- */

export function status() {
	const active: Record<string, { mode: string } & EffectOptions> = {};
	for (const [entity, id] of owner) {
		const run = runs.get(id);
		if (run) active[entity] = { mode: run.mode.id, ...run.options };
	}
	const sleep: Record<string, number> = {};
	for (const [entity, t] of timers) sleep[entity] = t.ends;
	return { enabled: enabled(), active, timers: sleep };
}

/* ---------- effects ---------- */

export function stop(entities: string[]) {
	for (const entity of entities) {
		const id = owner.get(entity);
		if (id === undefined) continue;
		owner.delete(entity);
		const run = runs.get(id);
		if (!run) continue;
		run.entities = run.entities.filter((e) => e !== entity);
		run.lastSent.delete(entity);
		if (!run.entities.length) {
			clearTimeout(run.timer);
			runs.delete(id);
		}
	}
}

const sameOptions = (a: EffectOptions, b: EffectOptions) =>
	a.speed === b.speed && a.fade === b.fade && a.sync === b.sync && a.dim === b.dim;

export async function start(modeId: string, entities: string[], options?: Partial<EffectOptions>) {
	const mode = findMode(modeId);
	if (!mode || mode.kind !== 'dynamic') throw new Error(`unknown effect ${modeId}`);
	entities = [...new Set(entities.filter((e) => e.startsWith('light.')))];
	if (!entities.length) throw new Error('no lights');

	const opts: EffectOptions = {
		speed: Math.min(4, Math.max(0.25, Number(options?.speed ?? defaultOptions.speed))),
		fade: Math.min(2, Math.max(0, Number(options?.fade ?? defaultOptions.fade))),
		sync: options?.sync ?? defaultOptions.sync,
		dim: Math.min(1, Math.max(0.05, Number(options?.dim ?? defaultOptions.dim)))
	};

	stop(entities);
	for (const e of entities) cancelTimer([e]);

	// learn which bulbs can fade
	const states = await statesOf(entities).catch(() => new Map());
	for (const e of entities) {
		transitionSupport.set(e, ((states.get(e)?.attributes?.supported_features ?? 0) & TRANSITION) !== 0);
	}

	// join a run of the same effect so the lights stay in step (not for one-shot effects)
	if (!mode.duration) {
		for (const run of runs.values()) {
			if (run.mode.id === mode.id && sameOptions(run.options, opts)) {
				run.entities.push(...entities);
				for (const e of entities) owner.set(e, run.id);
				return;
			}
		}
	}

	const run: Run = {
		id: nextId++,
		mode,
		options: opts,
		entities,
		started: Date.now(),
		sequence: [],
		lastSent: new Map(),
		lastCheck: Date.now()
	};
	runs.set(run.id, run);
	for (const e of entities) owner.set(e, run.id);
	frame(run);
}

/** hold and fade of one step in ms, after the user's speed and transition settings */
function timing(run: Run) {
	const { mode, options } = run;
	const seg = Math.max(200, (mode.hold + mode.fade) / options.speed);
	const base = mode.hold + mode.fade > 0 ? mode.fade / (mode.hold + mode.fade) : 0;
	const fade = seg * Math.min(0.95, base * options.fade + (options.fade > 1 ? (options.fade - 1) * 0.35 : 0));
	return { seg, fade, hold: seg - fade };
}

/** ms between commands: often enough to follow the effect, never faster than the bulbs like */
function frameOf(run: Run) {
	const { mode } = run;
	if (mode.duration || mode.order === 'hue') return Math.max(400, mode.frame / Math.min(2, run.options.speed));
	const { seg, fade } = timing(run);
	const wanted = fade > 0 ? Math.min(mode.frame, fade / 2) : Math.min(mode.frame, seg);
	return Math.max(400, wanted);
}

function paletteIndex(run: Run, step: number) {
	const n = run.mode.palette.length;
	if (run.mode.order !== 'random') return ((step % n) + n) % n;
	while (run.sequence.length <= step) {
		const prev = run.sequence[run.sequence.length - 1];
		let next = Math.floor(Math.random() * n);
		if (n > 1 && next === prev) next = (next + 1 + Math.floor(Math.random() * (n - 1))) % n;
		run.sequence.push(next);
	}
	return run.sequence[step];
}

/** colour of light number `index` at `t` ms into the effect */
function colourAt(run: Run, t: number, index: number, count: number): RGB {
	const { mode, options } = run;
	const sp = options.speed;
	const p = mode.palette;

	if (mode.order === 'hue') {
		const offset = options.sync ? 0 : (360 / Math.max(count, 1)) * index;
		return hsvToRgb((((t * sp) / (mode.hueCycle ?? 30000)) * 360 + offset) % 360, 1, 1);
	}

	if (mode.duration) {
		const k = Math.min(1, t / mode.duration) * (p.length - 1);
		const i = Math.min(p.length - 2, Math.floor(k));
		return p.length === 1 ? p[0] : mix(p[i], p[i + 1], k - i);
	}

	const { hold, fade, seg } = timing(run);
	const tt = t + (options.sync ? 0 : index * seg * 0.5 + (index * seg) / Math.max(count, 1));
	const step = Math.floor(tt / seg);
	const within = tt - step * seg;
	const a = p[paletteIndex(run, step)];
	if (within < hold || fade <= 0) return a;
	const b = p[paletteIndex(run, step + 1)];
	return mix(a, b, smooth((within - hold) / fade));
}

/** brightness in percent of light number `index` at `t` ms */
function brightnessAt(run: Run, t: number, index: number): { pct: number; flash: boolean } {
	const { mode, options } = run;
	const [lo, hi] = mode.brightness;
	const { seg } = timing(run);
	let pct = hi;
	let flash = false;
	switch (mode.dynamics) {
		case 'breathe': {
			const phase = (t + (options.sync ? 0 : index * seg * 0.7)) / (seg * 2);
			pct = lo + (hi - lo) * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2));
			break;
		}
		case 'flicker':
			pct = lo + (hi - lo) * Math.random();
			break;
		case 'flash':
			if (Math.random() < 0.05) {
				pct = 100;
				flash = true;
			} else pct = lo + (hi - lo) * Math.random();
			break;
		case 'rampUp':
		case 'rampDown': {
			const k = Math.min(1, t / (mode.duration ?? 1));
			pct = lo + (hi - lo) * k;
			break;
		}
	}
	const dim = mode.dynamics === 'flash' && flash ? 1 : options.dim;
	return { pct: Math.max(1, Math.min(100, Math.round(pct * dim))), flash };
}

async function frame(run: Run) {
	if (!runs.has(run.id)) return;
	const { mode } = run;
	const now = Date.now();
	const t = now - run.started;
	const step = frameOf(run);
	const target = t + step; // aim where the timeline will be at the next frame
	const entities = [...run.entities];

	// lights someone switched off elsewhere (app, voice, wall switch) leave the effect
	if (now - run.lastCheck > 2500) {
		run.lastCheck = now;
		try {
			const states = await statesOf(entities);
			for (const e of entities) {
				const s = states.get(e);
				const sent = run.lastSent.get(e);
				if (s?.state === 'off' && sent && now - sent.at > 3000) stop([e]);
			}
		} catch {
			/* Home Assistant busy: try again next round */
		}
	}
	const live = run.entities.filter((e) => entities.includes(e));

	const done = mode.duration !== undefined && t >= mode.duration;
	// bulbs that can fade glide to the next frame; with "Instant" they jump
	const { fade: fadeMs } = timing(run);
	const glide = mode.order === 'hue' || mode.duration ? step : Math.min(step, fadeMs);
	const fadeFor = (e: string, flash: boolean) => {
		if (!transitionSupport.get(e) || flash || glide < 120) return undefined;
		return Math.round(mode.dynamics === 'flicker' ? glide * 0.8 : glide * 1.05) / 1000; // seconds
	};

	// work out each light's next colour, then send as few calls as possible
	const batches = new Map<string, string[]>();
	const payloads = new Map<string, Record<string, unknown>>();
	live.forEach((e, i) => {
		const rgb = colourAt(run, done ? mode.duration! : target, i, live.length);
		const { pct, flash } = brightnessAt(run, done ? mode.duration! : target, i);
		const key = `${rgb.join(',')}|${pct}`;
		const prev = run.lastSent.get(e);
		if (prev?.key === key && now - prev.at < 20000) return; // nothing new to say
		run.lastSent.set(e, { key, at: now });
		const transition = fadeFor(e, flash);
		const data: Record<string, unknown> = { rgb_color: rgb, brightness_pct: pct };
		if (transition) data.transition = transition;
		const batchKey = JSON.stringify(data);
		payloads.set(batchKey, data);
		batches.set(batchKey, [...(batches.get(batchKey) ?? []), e]);
	});
	await Promise.all([...batches].map(([k, list]) => service('turn_on', { ...payloads.get(k), entity_id: list })));

	if (done) {
		if (mode.endOff) await service('turn_off', { entity_id: live });
		stop(live);
		return;
	}
	if (!runs.has(run.id)) return;
	const jitter = mode.dynamics === 'flicker' || mode.dynamics === 'flash' ? 0.75 + Math.random() * 0.5 : 1;
	run.timer = setTimeout(() => frame(run), Math.max(400, step * jitter));
}

/* ---------- sleep timer: dim slowly, then switch off ---------- */

export function cancelTimer(entities: string[]) {
	for (const e of entities) {
		const t = timers.get(e);
		if (!t) continue;
		clearInterval(t.interval);
		timers.delete(e);
	}
}

export async function setTimer(entities: string[], minutes: number) {
	entities = [...new Set(entities.filter((e) => e.startsWith('light.')))];
	minutes = Math.min(600, Math.max(1, Number(minutes) || 0));
	cancelTimer(entities);
	const states = await statesOf(entities).catch(() => new Map());
	const start = Date.now();
	const ends = start + minutes * 60_000;
	const STEP = 30_000;

	for (const entity of entities) {
		const s = states.get(entity);
		if (s?.state !== 'on') continue;
		const startBrightness = Math.max(1, Math.round(((s.attributes?.brightness ?? 255) / 255) * 100));
		const fades = ((s.attributes?.supported_features ?? 0) & TRANSITION) !== 0;
		const timer: SleepTimer = {
			entity,
			start,
			ends,
			startBrightness,
			interval: setInterval(async () => {
				const now = Date.now();
				const left = ends - now;
				try {
					const st = (await ha(`/api/states/${entity}`)) as { state: string };
					if (st.state !== 'on') return cancelTimer([entity]);
				} catch {
					/* keep going */
				}
				if (left <= 0) {
					stop([entity]);
					cancelTimer([entity]);
					await service('turn_off', { entity_id: entity, ...(fades ? { transition: 5 } : {}) });
					return;
				}
				// only dim while no effect is running on the light
				if (owner.has(entity)) return;
				const pct = Math.max(1, Math.round(startBrightness * (left / (ends - start))));
				await service('turn_on', { entity_id: entity, brightness_pct: pct, ...(fades ? { transition: STEP / 1000 } : {}) });
			}, STEP)
		};
		timers.set(entity, timer);
	}
}
