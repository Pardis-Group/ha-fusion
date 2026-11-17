import { handler } from './build/handler.js';
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import dotenv from 'dotenv';

const app = express();

// environment
dotenv.config();
const ADDON = process.env.ADDON === 'true';
const { PORT, HASS_PORT, EXPOSED_PORT } = process.env;

// dynamically set target
const entryMiddleware = async (req, res, next) => {
	// default
	let target = process.env.HASS_URL;

	if (ADDON) {
		// headers
		const {
			'x-hass-source': source,
			'x-forwarded-proto': forwardedProto,
			'x-forwarded-host': forwardedHost,
			host
		} = req.headers;

		// ingress
		if (source && forwardedProto && forwardedHost) {
			target = `${forwardedProto}://${forwardedHost}`;
		}

		// exposed port
		else if (host && EXPOSED_PORT && HASS_PORT) {
			const proto = req.secure ? 'https' : 'http';
			target = `${proto}://${host.replace(EXPOSED_PORT, HASS_PORT)}`;
		}
	}

	// target should be defined now
	if (!target) {
		throw new Error('Proxy target could not be determined');
	}

	// add header for +page.server.ts
	req.headers['X-Proxy-Target'] = target;
	req.target = target;
	next();
};

// production proxy
//
// The browser talks to Home Assistant through this server, on the same origin as the
// dashboard. That way it works through a tunnel or reverse proxy on https (no mixed
// content, no need to reach port 8123 from outside): login pages, the REST API and
// the WebSocket all go through here.
const HA_PATHS = ['/api/', '/auth/', '/local/', '/frontend_latest/', '/frontend_es5/', '/static/'];

// Home Assistant refuses forwarded requests unless it is configured for reverse proxies
// (http: use_x_forwarded_for + trusted_proxies). Drop those headers so it sees a plain
// request from this container. Set HA_KEEP_FORWARDED=true once Home Assistant trusts
// this container, so its logs show the real client address.
const KEEP_FORWARDED = process.env.HA_KEEP_FORWARDED === 'true';
const FORWARDED = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port', 'forwarded', 'x-real-ip'];
const stripForwarded = (proxyReq) => {
	if (KEEP_FORWARDED) return;
	for (const h of FORWARDED) proxyReq.removeHeader(h);
};

const proxy = createProxyMiddleware({
	pathFilter: (path) => HA_PATHS.some((p) => path.startsWith(p)),
	// websocket upgrades skip the express middleware, so fall back to HASS_URL
	router: (req) => req.target || process.env.HASS_URL,
	changeOrigin: true,
	ws: true,
	on: {
		proxyReq: stripForwarded,
		proxyReqWs: stripForwarded
	}
});

app.use(entryMiddleware, proxy);

// let SvelteKit handle everything else, including serving prerendered pages and static assets
app.use(handler);

const server = app.listen(PORT, () => {
	if (ADDON) {
		console.log('ADDON:', ADDON);
		console.log('INGRESS_PORT:', PORT);
		console.log('EXPOSED_PORT:', EXPOSED_PORT);
		console.log('HASS_PORT:', HASS_PORT);
	} else {
		console.log('HASS_URL:', process.env.HASS_URL);
		console.log('PORT:', PORT);
		console.log('ADDON:', ADDON);
	}
});

// Home Assistant's WebSocket (/api/websocket) through the same proxy
server.on('upgrade', proxy.upgrade);
