/** Browser side of the light modes: talk to /_api/light_effect and apply static modes. */
import { writable, get } from 'svelte/store';
import { base } from '$app/paths';
import { callService, type Connection, type HassEntities } from 'home-assistant-js-websocket';
import type { LightMode, RGB } from './modes';

/** entity_id -> id of the dynamic mode running on it */
export const activeEffects = writable<Record<string, string>>({});
/** entity_id -> id of the static mode last picked in this session (for highlighting) */
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

async function api(conn: Connection | undefined, init?: RequestInit) {
	const t = await token(conn);
	if (!t) throw new Error('not connected');
	const res = await fetch(`${base}/_api/light_effect`, {
		...init,
		headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }
	});
	if (!res.ok) throw new Error(await res.text());
	const data = await res.json();
	if (data?.active) activeEffects.set(data.active);
	if (typeof data?.enabled === 'boolean') effectsAvailable.set(data.enabled);
	return data;
}

export const refreshEffects = (conn: Connection | undefined) => api(conn).catch(() => undefined);

export const startEffect = (conn: Connection | undefined, mode: string, entities: string[]) =>
	api(conn, { method: 'POST', body: JSON.stringify({ action: 'start', mode, entities }) });

export async function stopEffect(conn: Connection | undefined, entities: string[]) {
	const running = get(activeEffects);
	if (!entities.some((e) => running[e])) return;
	await api(conn, { method: 'POST', body: JSON.stringify({ action: 'stop', entities }) }).catch(() => undefined);
}

/**
 * light.turn_on for several lights, adding a fade only for bulbs that support it
 * (Home Assistant rejects a transition on some integrations otherwise).
 */
export function turnOn(conn: Connection, states: HassEntities, entities: string[], data: Record<string, unknown>, fade = 0) {
	const withFade = entities.filter((e) => ((states?.[e]?.attributes?.supported_features ?? 0) & TRANSITION) !== 0);
	const without = entities.filter((e) => !withFade.includes(e));
	if (withFade.length) callService(conn, 'light', 'turn_on', { ...data, ...(fade ? { transition: fade } : {}), entity_id: withFade });
	if (without.length) callService(conn, 'light', 'turn_on', { ...data, entity_id: without });
}

export async function applyMode(conn: Connection, states: HassEntities, mode: LightMode, entities: string[]) {
	if (mode.kind === 'dynamic') {
		lastStatic.update((m) => {
			for (const e of entities) delete m[e];
			return m;
		});
		await startEffect(conn, mode.id, entities);
		return;
	}
	await stopEffect(conn, entities);
	const data: Record<string, unknown> = { brightness_pct: mode.brightness };
	if (mode.kelvin) data.color_temp_kelvin = mode.kelvin;
	if (mode.rgb) data.rgb_color = mode.rgb as RGB;
	turnOn(conn, states, entities, data, 1);
	lastStatic.update((m) => {
		for (const e of entities) m[e] = mode.id;
		return m;
	});
}

/** forget the static-mode highlight once the user picks a colour or brightness by hand */
export function clearStatic(entities: string[]) {
	lastStatic.update((m) => {
		for (const e of entities) delete m[e];
		return m;
	});
}
