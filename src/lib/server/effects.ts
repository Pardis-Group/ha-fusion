/**
 * Runs the dynamic light modes (party, christmas, ...) on the dashboard server,
 * so an effect keeps going when the browser is closed.
 *
 * It talks to Home Assistant's REST API with the long-lived token from
 * HASS_TOKEN or the file named by HASS_TOKEN_FILE. That token never leaves the server.
 */
import { readFileSync } from 'fs';
import { findMode, hsvToRgb, type DynamicMode, type RGB } from '$lib/Floorplan/modes';

const TRANSITION = 32; // LightEntityFeature.TRANSITION

interface Run {
	id: number;
	mode: DynamicMode;
	entities: string[];
	step: number;
	timer?: ReturnType<typeof setTimeout>;
	transition: Record<string, boolean>;
}

const runs = new Map<number, Run>();
const owner = new Map<string, number>(); // entity_id -> run id
let nextId = 1;

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

async function ha(path: string, init?: RequestInit) {
	const res = await fetch(`${hassUrl()}${path}`, {
		...init,
		headers: { Authorization: `Bearer ${serverToken()}`, 'Content-Type': 'application/json' },
		signal: AbortSignal.timeout(5000)
	});
	if (!res.ok) throw new Error(`${path}: ${res.status}`);
	return res.json();
}

/** checks a token sent by the browser, so only signed-in Home Assistant users can start effects */
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

export function active(): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [entity, id] of owner) {
		const run = runs.get(id);
		if (run) out[entity] = run.mode.id;
	}
	return out;
}

export function stop(entities: string[]) {
	for (const entity of entities) {
		const id = owner.get(entity);
		if (id === undefined) continue;
		owner.delete(entity);
		const run = runs.get(id);
		if (!run) continue;
		run.entities = run.entities.filter((e) => e !== entity);
		if (!run.entities.length) {
			clearTimeout(run.timer);
			runs.delete(id);
		}
	}
}

export async function start(modeId: string, entities: string[]) {
	const mode = findMode(modeId);
	if (!mode || mode.kind !== 'dynamic') throw new Error(`unknown effect ${modeId}`);
	entities = [...new Set(entities.filter((e) => e.startsWith('light.')))];
	if (!entities.length) throw new Error('no lights');

	stop(entities);

	const transition: Record<string, boolean> = {};
	await Promise.all(
		entities.map(async (e) => {
			try {
				const s = await ha(`/api/states/${e}`);
				transition[e] = ((s?.attributes?.supported_features ?? 0) & TRANSITION) !== 0;
			} catch {
				transition[e] = false;
			}
		})
	);

	const run: Run = { id: nextId++, mode, entities, step: 0, transition };
	runs.set(run.id, run);
	for (const e of entities) owner.set(e, run.id);
	tick(run);
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function colourFor(mode: DynamicMode, step: number, index: number, count: number): RGB {
	const p = mode.palette;
	switch (mode.pattern) {
		case 'hue': {
			const offset = mode.spread ? (360 / Math.max(count, 1)) * index : 0;
			return hsvToRgb((step * 30 + offset) % 360, 1, 1);
		}
		case 'cycle':
			return p[(step + (mode.spread ? index : 0)) % p.length];
		case 'flicker':
		case 'random':
		default:
			return p[Math.floor(Math.random() * p.length)];
	}
}

async function tick(run: Run) {
	if (!runs.has(run.id)) return;
	const { mode } = run;
	const entities = [...run.entities];
	const shared = mode.spread ? undefined : colourFor(mode, run.step, 0, 1);

	await Promise.all(
		entities.map(async (entity, i) => {
			try {
				// respect someone switching the light off elsewhere (app, voice, wall switch)
				if (run.step > 1) {
					const s = await ha(`/api/states/${entity}`);
					if (s?.state === 'off') {
						stop([entity]);
						return;
					}
					if (s?.state !== 'on') return; // unavailable: skip this step, keep trying
				}
				const rgb = shared ?? colourFor(mode, run.step, i, entities.length);
				const brightness = Math.round(rand(mode.brightness[0], mode.brightness[1]));
				const body: Record<string, unknown> = { entity_id: entity, rgb_color: rgb, brightness_pct: brightness };
				if (run.transition[entity]) body.transition = mode.transition;
				await ha('/api/services/light/turn_on', { method: 'POST', body: JSON.stringify(body) });
			} catch (error) {
				console.error(`effect ${mode.id} on ${entity}:`, (error as Error).message);
			}
		})
	);

	run.step++;
	if (!runs.has(run.id)) return;
	const jitter = mode.pattern === 'flicker' ? rand(0.6, 1.3) : 1;
	run.timer = setTimeout(() => tick(run), mode.interval * jitter);
}
