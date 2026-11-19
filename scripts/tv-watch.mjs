#!/usr/bin/env node
/**
 * Watches what the living-room TV is playing and writes it to a small JSON file the
 * dashboard reads (movie mode). Runs on the host because it needs adb and its key.
 *
 * Read-only: it only runs `dumpsys` on the TV, never starts or stops apps.
 *
 *   TV_HOST    192.168.1.122:5555
 *   ADB        path to adb (default ~/Android/Sdk/platform-tools/adb)
 *   OUT        status file (default ~/ha-fusion-data/tv-status.json)
 */
import { execFile } from 'node:child_process';
import { writeFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

const TV = process.env.TV_HOST || '192.168.1.122:5555';
const ADB = process.env.ADB || `${homedir()}/Android/Sdk/platform-tools/adb`;
const OUT = process.env.OUT || `${homedir()}/ha-fusion-data/tv-status.json`;
const ONLINE_EVERY = 3000;
const OFFLINE_EVERY = 20000;

const PLAYBOX = /^org\.jellyfin\.androidtv(\.debug)?$/;
const STATES = { 0: 'none', 1: 'stopped', 2: 'paused', 3: 'playing', 6: 'buffering', 7: 'error', 8: 'connecting' };

const run = (args, timeout = 6000) =>
	new Promise((resolve) => {
		execFile(ADB, args, { timeout }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || err?.message || '') }));
	});

let last = '';
function write(status) {
	const json = JSON.stringify({ ...status, tv: TV, updated: Date.now() });
	// rewrite every poll so the dashboard can tell the watcher is alive
	writeFileSync(`${OUT}.tmp`, json);
	renameSync(`${OUT}.tmp`, OUT);
	const key = `${status.online}|${status.package}|${status.playback}|${status.title}`;
	if (key !== last) console.log(new Date().toISOString(), key);
	last = key;
}

/** parse `dumpsys media_session` lines into sessions */
export function sessions(text) {
	const list = [];
	let cur;
	for (const line of text.split('\n')) {
		const pkg = line.match(/^\s*package=(\S+)/);
		if (pkg) {
			cur = { package: pkg[1], active: false, state: 0, title: '' };
			list.push(cur);
			continue;
		}
		if (!cur) continue;
		if (/^\s*active=true/.test(line)) cur.active = true;
		const st = line.match(/state=PlaybackState \{state=(\d+)/);
		if (st) cur.state = Number(st[1]);
		const d = line.match(/description=(.*)$/);
		if (d && !cur.title) cur.title = d[1].split(',')[0].trim().replace(/^null$/, '');
	}
	return list;
}

async function poll() {
	let res = await run(['-s', TV, 'shell', 'dumpsys activity activities | grep -m1 mResumedActivity; echo @@@; dumpsys power | grep -m1 mWakefulness=; echo @@@; dumpsys media_session | grep -E "package=|active=|state=PlaybackState|description="']);
	if (!res.ok) {
		// not connected (TV off, rebooted, or adb lost it): try to connect, then report offline
		const c = await run(['connect', TV], 5000);
		if (!/connected to/.test(c.out)) {
			write({ online: false, playback: 'none', package: '', activity: '', title: '', video: false, playbox: false });
			return OFFLINE_EVERY;
		}
		res = await run(['-s', TV, 'shell', 'dumpsys activity activities | grep -m1 mResumedActivity; echo @@@; dumpsys power | grep -m1 mWakefulness=; echo @@@; dumpsys media_session | grep -E "package=|active=|state=PlaybackState|description="']);
		if (!res.ok) {
			write({ online: false, playback: 'none', package: '', activity: '', title: '', video: false, playbox: false });
			return OFFLINE_EVERY;
		}
	}
	const [act = '', power = '', media = ''] = res.out.split('@@@');
	const m = act.match(/ ([\w.]+)\/([\w.$]+)/);
	const pkg = m?.[1] || '';
	const activity = m ? (m[2].startsWith('.') ? pkg + m[2] : m[2]) : '';
	const awake = !/mWakefulness=(Asleep|Dozing)/.test(power);
	// the session of the app in front decides; fall back to any active session that is playing
	const list = sessions(media);
	const s = list.find((x) => x.package === pkg && x.active) || list.find((x) => x.package === pkg) || list.find((x) => x.active && x.state === 3);
	const playback = awake ? STATES[s?.state ?? 0] || 'none' : 'none';
	const playbox = PLAYBOX.test(pkg);
	write({
		online: true,
		awake,
		package: pkg,
		activity,
		playback,
		title: s?.title || '',
		playbox,
		// PlayBox plays films and episodes in its own player; live channels and trailers use this one
		stream: /PlayBoxStreamPlayerActivity/.test(activity),
		video: playbox && !/PlayBoxStreamPlayerActivity/.test(activity)
	});
	return ONLINE_EVERY;
}

async function loop() {
	let wait = OFFLINE_EVERY;
	try {
		wait = await poll();
	} catch (e) {
		console.error('poll failed:', e.message);
	}
	setTimeout(loop, wait);
}
// run only when started directly (the parser can be imported for tests)
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	console.log(`watching ${TV} -> ${OUT}`);
	loop();
}
