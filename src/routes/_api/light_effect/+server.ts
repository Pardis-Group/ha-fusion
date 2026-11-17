import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { active, authorized, enabled, start, stop } from '$lib/server/effects';

/** GET: which lights run which effect */
export const GET: RequestHandler = async ({ request }) => {
	if (!(await authorized(request.headers.get('authorization')))) error(401, 'sign in to Home Assistant first');
	return json({ enabled: enabled(), active: active() });
};

/** POST { action: 'start', mode, entities } | { action: 'stop', entities } */
export const POST: RequestHandler = async ({ request }) => {
	if (!(await authorized(request.headers.get('authorization')))) error(401, 'sign in to Home Assistant first');
	if (!enabled()) error(503, 'effects need HASS_TOKEN or HASS_TOKEN_FILE on the dashboard server');

	const body = await request.json().catch(() => ({}));
	const entities: string[] = Array.isArray(body?.entities) ? body.entities.filter((e: unknown) => typeof e === 'string') : [];

	if (body?.action === 'stop') {
		stop(entities);
	} else if (body?.action === 'start' && typeof body?.mode === 'string') {
		try {
			await start(body.mode, entities);
		} catch (e) {
			error(400, (e as Error).message);
		}
	} else {
		error(400, 'expected action start or stop');
	}
	return json({ active: active() });
};
