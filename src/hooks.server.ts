import { error, type Handle } from '@sveltejs/kit';
import { authorized } from '$lib/server/effects';
import { startAutomations } from '$lib/server/automations';

// auto brightness and movie mode run for as long as the server does
startAutomations();

/**
 * Dashboard API endpoints that only read harmless files and can be used without
 * signing in (an <img> or <script> tag cannot send a token). Everything else
 * under /_api changes files or makes the server fetch URLs, so it needs a valid
 * Home Assistant token: the dashboard is reachable from the internet through
 * the Cloudflare tunnel.
 */
const OPEN = new Set([
	'GET /_api/floorplan_image',
	'GET /_api/custom_js',
	'GET /_api/version',
	'GET /_api/list_languages',
	'GET /_api/get_all_themes',
	'GET /_api/get_docs'
]);

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname.replace(/\/$/, '');
	if (path.startsWith('/_api/') && !OPEN.has(`${event.request.method} ${path}`)) {
		if (!(await authorized(event.request.headers.get('authorization')))) {
			error(401, 'sign in to Home Assistant first');
		}
	}

	const response = await resolve(event);
	// Remove large sveltekit `link` header to be able to run behind reverse proxy
	// (`upstream sent too big header while reading response header from upstream`)
	response.headers.delete('link');
	return response;
};
