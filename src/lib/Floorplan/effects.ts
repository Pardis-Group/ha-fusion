/** Browser side of the light modes: talk to /_api/light_effect and apply scenes. */
import { writable, get } from 'svelte/store';
import { base } from '$app/paths';
import { callService, type Connection, type HassEntities } from 'home-assistant-js-websocket';
import type { EffectOptions, LightMode, RGB } from './modes';

export type ActiveEffect = { mode: string } & EffectOptions;

/** entity_id -> effect running on it */
export const activeEffects = writable<Record<string, ActiveEffect>>({});
/** entity_id -> when its sleep timer switches it off (ms) */
export const sleepTimers = writable<Record<string, number>>({});
/** entity_id -> id of the scene last picked in this session (for highlighting) */
export const lastStatic = writable<Record<string, string>>({});
/** false when the dashboard server has no Home Assistant token, so effects can't run */
export const effectsAvailable = writable(true);

const TRANSITION = 32;

async function token(conn: Connection | undefined) {
	const auth: any = (conn as any)?.options?.auth;
	if (!auth) return undefined;
	if (auth.expired && typeof auth.refreshAccessToken === 'function') await auth.refreshAccessToken();
	return auth.accessToken as string;
}

async function api(conn: Connection | undefined, body?: Record<string, unknown>) {
	const t = await token(conn);
	if (!t) throw new Error('not connected');
	const res = await fetch(`${base}/_api/light_effect`, {
		method: body ? 'POST' : 'GET',
		headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
		...(body ? { body: JSON.stringify(body) } : {})
	});
	if (!res.ok) throw new Error(await res.text());
	const data = await res.json();
	if (data?.active) activeEffects.set(data.active);
	if (data?.timers) sleepTimers.set(data.timers);
	if (typeof data?.enabled === 'boolean') effectsAvailable.set(data.enabled);
	return data;
}

export const refreshEffects = (conn: Connection | undefined) => api(conn).catch(() => undefined);

export const startEffect = (conn: Connection | undefined, mode: string, entities: string[], options?: Partial<EffectOptions>) =>
	api(conn, { action: 'start', mode, entities, options });

export async function stopEffect(conn: Connection | undefined, entities: string[]) {
	const running = get(activeEffects);
	if (!entities.some((e) => running[e])) return;
	await api(conn, { action: 'stop', entities }).catch(() => undefined);
}

export const setSleepTimer = (conn: Connection | undefined, entities: string[], minutes: number) =>
	api(conn, { action: 'timer', entities, minutes });

export const cancelSleepTimer = (conn: Connection | undefined, entities: string[]) =>
	api(conn, { action: 'cancel_timer', entities });

/* ---------- per-light Auto brightness and Movie buttons ---------- */

export type AutomationState = { autoOff: string[]; movieOff: string[]; manual: string[]; movieState: string };
export const automation = writable<AutomationState>({ autoOff: [], movieOff: [], manual: [], movieState: 'idle' });

async function automationsApi(body?: Record<string, unknown>) {
	const res = await fetch(`${base}/_api/automations`, {
		method: body ? 'POST' : 'GET',
		headers: { 'Content-Type': 'application/json' },
		...(body ? { body: JSON.stringify(body) } : {})
	});
	if (!res.ok) throw new Error(await res.text());
	const { status } = await res.json();
	automation.set({
		autoOff: status.autoOff ?? [],
		movieOff: status.movieOff ?? [],
		manual: status.manual ?? [],
		movieState: status.movie?.state ?? 'idle'
	});
}

export const refreshAutomations = () => automationsApi().catch(() => undefined);

/** switch lights in or out of auto brightness ('adaptive') or movie mode ('movie') */
export const setFeature = (feature: 'adaptive' | 'movie', entities: string[], on: boolean) =>
	automationsApi({ action: 'set_lights', feature, entities, on }).catch((e) => console.error(e));

/** a light set by hand goes back to auto brightness */
export const resumeAuto = (entities: string[]) => automationsApi({ action: 'resume', entities }).catch((e) => console.error(e));

/** tell auto brightness the user chose these lights' look by hand, so it leaves them alone */
export function markManual(entities: string[]) {
	automationsApi({ action: 'manual', entities }).catch(() => undefined);
}

/**
 * light.turn_on for several lights, adding a fade only for bulbs that support it
 * (Home Assistant rejects a transition on some integrations otherwise).
 */
export function turnOn(conn: Connection, states: HassEntities, entities: string[], data: Record<string, unknown>, fade = 0) {
	markManual(entities);
	const withFade = entities.filter((e) => ((states?.[e]?.attributes?.supported_features ?? 0) & TRANSITION) !== 0);
	const without = entities.filter((e) => !withFade.includes(e));
	if (withFade.length) callService(conn, 'light', 'turn_on', { ...data, ...(fade ? { transition: fade } : {}), entity_id: withFade });
	if (without.length) callService(conn, 'light', 'turn_on', { ...data, entity_id: without });
}

export async function applyMode(
	conn: Connection,
	states: HassEntities,
	mode: LightMode,
	entities: string[],
	options?: Partial<EffectOptions>
) {
	if (mode.kind === 'dynamic') {
		clearStatic(entities);
		await startEffect(conn, mode.id, entities, options);
		return;
	}
	await stopEffect(conn, entities);
	const data: Record<string, unknown> = { brightness_pct: mode.brightness };
	if (mode.kelvin) data.color_temp_kelvin = mode.kelvin;
	if (mode.rgb) data.rgb_color = mode.rgb as RGB;
	turnOn(conn, states, entities, data, 1.5);
	lastStatic.update((m) => {
		for (const e of entities) m[e] = mode.id;
		return m;
	});
}

/** forget the scene highlight once the user picks a colour or brightness by hand */
export function clearStatic(entities: string[]) {
	lastStatic.update((m) => {
		for (const e of entities) delete m[e];
		return m;
	});
}
