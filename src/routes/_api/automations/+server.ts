import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { automationStatus, getSettings, markManual, resume, saveSettings, setLights, testMovie } from '$lib/server/automations';

/** GET: settings and live status (sun times, today's curve, movie mode) */
export const GET: RequestHandler = async () => json({ settings: getSettings(), status: automationStatus() });

/**
 * POST
 *   { action: 'save', settings }                 change the automations
 *   { action: 'set_lights', feature, entities, on }   Auto / Movie button: feature 'adaptive' | 'movie'
 *   { action: 'manual', entities }               the user set these lights by hand
 *   { action: 'resume', entities }               give these lights back to auto brightness
 *   { action: 'test_movie', state }              'playing' | 'paused' | 'idle' | null (follow the TV)
 * (hooks.server.ts already requires a Home Assistant token for this endpoint)
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => ({}));
	const entities: string[] = Array.isArray(body?.entities) ? body.entities.filter((e: unknown) => typeof e === 'string') : [];
	switch (body?.action) {
		case 'save':
			saveSettings(body.settings);
			break;
		case 'set_lights':
			if (body.feature !== 'adaptive' && body.feature !== 'movie') error(400, 'feature must be adaptive or movie');
			setLights(body.feature, entities, Boolean(body.on));
			break;
		case 'manual':
			markManual(entities);
			break;
		case 'resume':
			resume(entities);
			break;
		case 'test_movie':
			testMovie(['playing', 'paused', 'idle'].includes(body.state) ? body.state : null);
			break;
		default:
			error(400, 'expected action save, set_lights, manual, resume or test_movie');
	}
	return json({ settings: getSettings(), status: automationStatus() });
};
