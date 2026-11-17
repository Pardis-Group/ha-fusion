import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { authorized, cancelTimer, enabled, setTimer, start, status, stop } from '$lib/server/effects';

/** GET: which lights run which effect, and sleep timers */
export const GET: RequestHandler = async ({ request }) => {
	if (!(await authorized(request.headers.get('authorization')))) error(401, 'sign in to Home Assistant first');
	return json(status());
};

/**
 * POST
 *   { action: 'start', mode, entities, options?: { speed, sync, dim } }
 *   { action: 'stop', entities }
 *   { action: 'timer', entities, minutes }
 *   { action: 'cancel_timer', entities }
 */
export const POST: RequestHandler = async ({ request }) => {
	if (!(await authorized(request.headers.get('authorization')))) error(401, 'sign in to Home Assistant first');
	if (!enabled()) error(503, 'effects need HASS_TOKEN or HASS_TOKEN_FILE on the dashboard server');

	const body = await request.json().catch(() => ({}));
	const entities: string[] = Array.isArray(body?.entities)
		? body.entities.filter((e: unknown) => typeof e === 'string')
		: [];

	try {
		switch (body?.action) {
			case 'start':
				await start(String(body.mode), entities, body.options);
				break;
			case 'stop':
				stop(entities);
				break;
			case 'timer':
				await setTimer(entities, Number(body.minutes));
				break;
			case 'cancel_timer':
				cancelTimer(entities);
				break;
			default:
				error(400, 'expected action start, stop, timer or cancel_timer');
		}
	} catch (e) {
		if ((e as any)?.status) throw e;
		error(400, (e as Error).message);
	}
	return json(status());
};
