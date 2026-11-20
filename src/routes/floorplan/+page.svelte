<script lang="ts">
	import { configuration, states, connection, connected, translation, selectedLanguage } from '$lib/Stores';
	import { openModal } from 'svelte-modals';
	import Theme from '$lib/Components/Theme.svelte';
	import { authentication } from '$lib/Socket';
	import { callService } from 'home-assistant-js-websocket';
	import { browser } from '$app/environment';
	import { base } from '$app/paths';
	import { onDestroy, onMount, tick } from 'svelte';
	import { icons, iconFor } from '$lib/Floorplan/icons';
	import type { Floorplan, Pin } from '$lib/Floorplan/types';
	import { activeEffects, refreshEffects, stopEffect, refreshAutomations } from '$lib/Floorplan/effects';

	export let data: { configuration: any; floorplan: Floorplan; theme: any; translations: any; geometry: Geometry | null };

	type Geometry = { width: number; height: number; rooms: Record<string, number[][][]> };

	// talk to Home Assistant through this server, on the page's own origin (see server.js)
	$configuration = browser ? { ...data.configuration, hassUrl: window.location.origin } : data.configuration;
	$translation = data.translations;
	$selectedLanguage = 'en';
	let plan: Floorplan = structuredClone(data.floorplan);

	/* ---------- connection (same flow as the main page) ---------- */
	let isConnecting = false;
	let retryInterval: ReturnType<typeof setInterval>;

	async function connect() {
		if (isConnecting) return;
		isConnecting = true;
		try {
			await authentication($configuration);
			$connected = true;
			clearInterval(retryInterval);
		} catch {
			/* retried by interval */
		} finally {
			isConnecting = false;
		}
	}

	if (browser) {
		connect();
		retryInterval = setInterval(connect, 3000);
	}
	onDestroy(() => {
		clearInterval(retryInterval);
		clearInterval(clockInterval);
	});

	/* ---------- clock ---------- */
	let now = new Date();
	let clockInterval: ReturnType<typeof setInterval>;
	onMount(() => {
		clockInterval = setInterval(() => (now = new Date()), 1000);
	});
	$: time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
	$: date = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

	/* ---------- modes ---------- */
	type Mode = 'rooms' | 'lights' | 'media' | 'devices';
	const modes: { id: Mode; label: string; icon: string; domains?: string[] }[] = [
		{ id: 'rooms', label: 'Rooms', icon: icons.rooms },
		{ id: 'lights', label: 'Lights', icon: icons.light, domains: ['light', 'switch'] },
		{ id: 'media', label: 'Media', icon: icons.media, domains: ['media_player'] },
		{ id: 'devices', label: 'All devices', icon: icons.devices }
	];
	let mode: Mode = 'lights';

	const domain = (id: string) => id.split('.')[0];

	$: visiblePins = plan.pins.filter((p) => {
		const m = modes.find((m) => m.id === mode);
		if (mode === 'rooms') return false;
		return !m?.domains || m.domains.includes(domain(p.entity_id));
	});

	/* ---------- entity helpers ---------- */
	const onStates = ['on', 'playing', 'open', 'heat', 'cool', 'home', 'cleaning'];
	// helpers take the states map as an argument so Svelte tracks it in the template
	const isOn = (st: any, id: string) => onStates.includes(st?.[id]?.state);
	const isUnavailable = (st: any, id: string) => ['unavailable', 'unknown', undefined].includes(st?.[id]?.state);
	const nameOf = (st: any, p: Pin) => p.name || st?.[p.entity_id]?.attributes?.friendly_name || p.entity_id;

	function toggle(p: Pin) {
		// a long-press already opened the details; don't also toggle
		if (longPressed) {
			longPressed = false;
			return;
		}
		if (editing || !$connection) return;
		const d = domain(p.entity_id);
		if (['light', 'switch', 'fan', 'input_boolean', 'cover', 'media_player'].includes(d)) {
			callService($connection, 'homeassistant', 'toggle', { entity_id: p.entity_id });
		}
	}

	/** right-click / long-press: open Fusion's detail modal for the entity (colour, brightness, ...) */
	function openDetails(p: Pin) {
		if (editing) return;
		const sel = { entity_id: p.entity_id, name: p.name };
		switch (domain(p.entity_id)) {
			case 'light':
				openLights([p.entity_id], nameOf($states, p));
				break;
			case 'switch':
			case 'input_boolean':
				openModal(() => import('$lib/Modal/SwitchModal.svelte'), { sel });
				break;
			case 'media_player':
				openModal(() => import('$lib/Modal/MediaPlayer.svelte'), { selected: sel });
				break;
			case 'climate':
				openModal(() => import('$lib/Modal/ClimateModal.svelte'), { sel });
				break;
			case 'fan':
				openModal(() => import('$lib/Modal/FanModal.svelte'), { selected: sel });
				break;
			case 'cover':
				openModal(() => import('$lib/Modal/CoverModal.svelte'), { selected: sel });
				break;
			case 'lock':
				openModal(() => import('$lib/Modal/LockModal.svelte'), { sel });
				break;
			case 'vacuum':
				openModal(() => import('$lib/Modal/VacuumModal.svelte'), { sel });
				break;
			default:
				openModal(() => import('$lib/Modal/SensorModal.svelte'), { sel });
		}
	}

	let pressTimer: ReturnType<typeof setTimeout> | undefined;
	let longPressed = false;
	function pressStart(p: Pin) {
		clearTimeout(pressTimer);
		longPressed = false;
		pressTimer = setTimeout(() => {
			longPressed = true;
			openDetails(p);
		}, 550);
	}
	function pressEnd() {
		clearTimeout(pressTimer);
	}

	function roomPins(room: string) {
		return plan.pins.filter((p) => p.room === room && ['light', 'switch'].includes(domain(p.entity_id)));
	}

	function toggleRoom(room: string) {
		if (!$connection) return;
		const pins = roomPins(room);
		if (!pins.length) return;
		const anyOn = pins.some((p) => isOn($states, p.entity_id));
		callService($connection, 'homeassistant', anyOn ? 'turn_off' : 'turn_on', {
			entity_id: pins.map((p) => p.entity_id)
		});
	}

	/* ---------- live room lighting on the plan ----------
	 * Rooms whose lights are all off go dark; lit rooms take the bulb's real colour
	 * and brightness, with a glow around each lamp kept inside the room's walls. */
	const geo = data.geometry;
	type RoomLight = {
		name: string;
		slug: string;
		points: string[];
		kind: 'none' | 'dark' | 'lit';
		tint: string;
		strength: number;
		radius: number;
		lamps: { id: number; x: number; y: number; color: string; level: number }[];
	};
	const DEFAULT_RGB = [255, 196, 120];
	const rgbCss = (c: number[]) => `rgb(${c.map((v) => Math.round(v)).join(',')})`;

	$: lighting = geo
		? Object.entries(geo.rooms).map(([name, polys]): RoomLight => {
				const xs = polys.flat().map((p) => p[0]);
				const ys = polys.flat().map((p) => p[1]);
				const base = {
					name,
					slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
					points: polys.map((poly) => poly.map((p) => p.join(',')).join(' ')),
					radius: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.55,
					tint: '#ffffff',
					strength: 0,
					lamps: [] as RoomLight['lamps']
				};
				const lamps = plan.pins.filter((p) => p.room === name && domain(p.entity_id) === 'light');
				if (!lamps.length) return { ...base, kind: 'none' };
				const on = lamps.filter((p) => $states?.[p.entity_id]?.state === 'on');
				if (!on.length) return { ...base, kind: 'dark', tint: '#363d5c', strength: 0.6 };
				const lit = on.map((p) => {
					const a = $states[p.entity_id].attributes;
					return {
						id: p.id,
						x: (p.x / 100) * geo.width,
						y: (p.y / 100) * geo.height,
						rgb: (a?.rgb_color as number[]) || DEFAULT_RGB,
						level: (a?.brightness ?? 255) / 255
					};
				});
				const level = lit.reduce((s, l) => s + l.level, 0) / lit.length;
				const avg = [0, 1, 2].map((i) => lit.reduce((s, l) => s + l.rgb[i], 0) / lit.length);
				// multiply tint: the bulb colour, darker when dimmed
				const shade = 0.55 + 0.45 * level;
				return {
					...base,
					kind: 'lit',
					tint: rgbCss(avg.map((v) => v * shade)),
					strength: 0.5,
					lamps: lit.map((l) => ({ id: l.id, x: l.x, y: l.y, color: rgbCss(l.rgb), level: l.level }))
				};
			})
		: [];

	/* ---------- light panel: one light, a room, or the whole flat ---------- */
	function openLights(entities: string[], title: string) {
		if (editing || !entities.length) return;
		openModal(() => import('$lib/Floorplan/LightPanel.svelte'), { entities, title });
	}

	const roomLights = (room: string) => roomPins(room).filter((p) => domain(p.entity_id) === 'light').map((p) => p.entity_id);

	$: allLights = Object.keys($states || {})
		.filter((id) => domain(id) === 'light')
		.sort();

	let roomTimer: ReturnType<typeof setTimeout> | undefined;
	let roomLongPressed = false;
	function roomPressStart(room: string) {
		clearTimeout(roomTimer);
		roomLongPressed = false;
		roomTimer = setTimeout(() => {
			roomLongPressed = true;
			openLights(roomLights(room), room);
		}, 550);
	}

	// which lights run an effect (party, christmas, ...); refreshed while the page is open
	let effectsTimer: ReturnType<typeof setInterval> | undefined;
	$: if ($connected && browser && !effectsTimer) {
		refreshEffects($connection);
		refreshAutomations();
		effectsTimer = setInterval(() => {
			refreshEffects($connection);
			refreshAutomations();
		}, 5000);
	}
	onDestroy(() => clearInterval(effectsTimer));

	/* ---------- Home Assistant settings ----------
	 * On the home network open Home Assistant directly; from outside use its own
	 * hostname next to this one (home.a-ll.site -> ha.a-ll.site), or plan.ha_url. */
	$: haUrl = (() => {
		if (!browser) return '#';
		if (plan.ha_url) return plan.ha_url.replace(/\/$/, '');
		const h = location.hostname;
		const lan = /^\d+\.\d+\.\d+\.\d+$/.test(h) || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal');
		if (lan) return `http://${h}:8123`;
		return `${location.protocol}//ha.${h.split('.').slice(1).join('.')}`;
	})();

	/* ---------- phone layout ---------- */
	let planWrap: HTMLDivElement;
	let phone = false;
	onMount(() => {
		const mq = window.matchMedia('(max-width: 760px)');
		const set = () => {
			phone = mq.matches;
			if (!phone) resetZoom();
		};
		set();
		mq.addEventListener('change', set);
		return () => mq.removeEventListener('change', set);
	});

	/* pinch to zoom, drag to move, double tap to zoom in/out (phones) */
	const MAX_ZOOM = 4;
	let zoom = 1;
	let tx = 0;
	let ty = 0;
	let gesturing = false;
	$: zoomed = zoom > 1.01;
	const pointers = new Map<number, { x: number; y: number }>();
	let pinch: { dist: number; zoom: number; px: number; py: number } | null = null;
	let pan: { x: number; y: number; tx: number; ty: number; moved: boolean } | null = null;
	let suppressClick = false;
	let lastTap = { t: 0, x: 0, y: 0 };

	function clampPan() {
		if (!planEl) return;
		const w = planEl.offsetWidth;
		const h = planEl.offsetHeight;
		tx = Math.min(0, Math.max(w - w * zoom, tx));
		ty = Math.min(0, Math.max(h - h * zoom, ty));
	}
	function zoomAt(next: number, cx: number, cy: number) {
		// keep the plan point under (cx, cy) where it is
		const px = (cx - tx) / zoom;
		const py = (cy - ty) / zoom;
		zoom = Math.min(MAX_ZOOM, Math.max(1, next));
		tx = cx - px * zoom;
		ty = cy - py * zoom;
		clampPan();
	}
	function resetZoom() {
		zoom = 1;
		tx = 0;
		ty = 0;
	}
	function local(e: PointerEvent) {
		const r = planWrap.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}
	function cancelPresses() {
		pressEnd();
		clearTimeout(roomTimer);
	}
	function onGestureDown(e: PointerEvent) {
		if (!phone || editing) return;
		pointers.set(e.pointerId, local(e));
		if (pointers.size === 2) {
			const [a, b] = [...pointers.values()];
			const mx = (a.x + b.x) / 2;
			const my = (a.y + b.y) / 2;
			pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom, px: (mx - tx) / zoom, py: (my - ty) / zoom };
			pan = null;
			gesturing = true;
			suppressClick = true;
			cancelPresses();
		} else if (pointers.size === 1 && zoomed) {
			const p = pointers.get(e.pointerId)!;
			pan = { x: p.x, y: p.y, tx, ty, moved: false };
		}
	}
	function onGestureMove(e: PointerEvent) {
		if (!pointers.has(e.pointerId)) return;
		pointers.set(e.pointerId, local(e));
		if (pinch && pointers.size >= 2) {
			const [a, b] = [...pointers.values()];
			const mx = (a.x + b.x) / 2;
			const my = (a.y + b.y) / 2;
			zoom = Math.min(MAX_ZOOM, Math.max(1, pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist)));
			tx = mx - pinch.px * zoom;
			ty = my - pinch.py * zoom;
			clampPan();
		} else if (pan) {
			const p = pointers.get(e.pointerId)!;
			const dx = p.x - pan.x;
			const dy = p.y - pan.y;
			if (!pan.moved && Math.hypot(dx, dy) > 8) {
				pan.moved = true;
				gesturing = true;
				suppressClick = true;
				cancelPresses();
			}
			if (pan.moved) {
				tx = pan.tx + dx;
				ty = pan.ty + dy;
				clampPan();
			}
		}
	}
	function onGestureUp(e: PointerEvent) {
		if (!pointers.has(e.pointerId)) return;
		const p = pointers.get(e.pointerId)!;
		pointers.delete(e.pointerId);
		if (pointers.size < 2) pinch = null;
		if (pointers.size === 0) {
			const wasGesture = gesturing;
			gesturing = false;
			pan = null;
			if (zoom < 1.05) resetZoom();
			// double tap: zoom in on that spot, or back out
			const now = Date.now();
			if (!wasGesture && now - lastTap.t < 300 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30) {
				if (zoomed) resetZoom();
				else zoomAt(2.5, p.x, p.y);
				lastTap.t = 0;
				suppressClick = true;
			} else if (!wasGesture) {
				lastTap = { t: now, x: p.x, y: p.y };
			}
			if (suppressClick) setTimeout(() => (suppressClick = false), 50);
		}
	}
	function blockClickAfterGesture(e: MouseEvent) {
		if (suppressClick) {
			e.stopPropagation();
			e.preventDefault();
		}
	}
	function toggleZoom() {
		if (zoomed) resetZoom();
		else if (planEl) zoomAt(2.2, planEl.offsetWidth / 2, planEl.offsetHeight / 2);
	}

	const colourOf = (ids: string[]) => {
		const lit = ids.map((id) => $states?.[id]).filter((s) => s?.state === 'on');
		if (!lit.length) return 'rgb(255, 196, 120)';
		const avg = [0, 1, 2].map((i) => lit.reduce((sum, s) => sum + ((s!.attributes?.rgb_color as number[]) || DEFAULT_RGB)[i], 0) / lit.length);
		return rgbCss(avg);
	};

	$: roomCards = plan.rooms
		.map((room) => {
			const lights = roomLights(room.name);
			const states = lights.map((id) => $states?.[id]);
			const on = states.filter((s) => s?.state === 'on');
			const reachable = states.some((s) => s && !['unavailable', 'unknown'].includes(s.state));
			const level = on.length ? Math.round(on.reduce((sum, s) => sum + (s!.attributes?.brightness ?? 255), 0) / on.length / 2.55) : 0;
			const fx = lights.map((id) => $activeEffects[id]?.mode).find(Boolean);
			return {
				name: room.name,
				lights,
				on: on.length,
				reachable,
				color: colourOf(lights),
				effect: fx ? fx.charAt(0).toUpperCase() + fx.slice(1) : '',
				status: !reachable ? 'Unreachable' : on.length ? `On · ${level}%` : 'Off'
			};
		})
		.filter((r) => r.lights.length);

	$: allOn = allLights.filter((id) => $states?.[id]?.state === 'on').length;
	$: allColor = colourOf(allLights);
	$: mediaPins = plan.pins.filter((p) => domain(p.entity_id) === 'media_player');

	async function toggleAll() {
		if (!$connection) return;
		await stopEffect($connection, allLights);
		callService($connection, 'light', allOn ? 'turn_off' : 'turn_on', { entity_id: allLights });
	}

	/* ---------- people & temperature ---------- */
	$: people = plan.people.map((id) => {
		const s = $states?.[id];
		return {
			id,
			name: s?.attributes?.friendly_name || id.split('.')[1],
			home: s?.state === 'home',
			picture: s?.attributes?.entity_picture as string | undefined
		};
	});

	$: temperature = (() => {
		if (!plan.temperature) return undefined;
		const s = $states?.[plan.temperature];
		if (!s) return undefined;
		const v = plan.temperature.startsWith('weather.') ? s.attributes?.temperature : s.state;
		const unit = s.attributes?.temperature_unit || s.attributes?.unit_of_measurement || '°C';
		return v === undefined ? undefined : `${Math.round(Number(v))}${unit.replace(/^°?/, '°')}`;
	})();

	/* ---------- editing ---------- */
	let editing = false;
	let dirty = false;
	let saving = false;
	let planEl: HTMLDivElement;
	let dragging: Pin | undefined;
	let newEntity = '';

	const placeable = ['light', 'switch', 'media_player', 'fan', 'climate', 'sensor', 'binary_sensor', 'cover', 'lock', 'vacuum'];
	$: unplaced = Object.keys($states || {})
		.filter((id) => placeable.includes(domain(id)) && !plan.pins.some((p) => p.entity_id === id))
		.sort();

	function startDrag(e: PointerEvent, p: Pin) {
		if (!editing) return;
		dragging = p;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function moveDrag(e: PointerEvent) {
		if (!dragging || !planEl) return;
		const r = planEl.getBoundingClientRect();
		dragging.x = Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100));
		dragging.y = Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100));
		plan.pins = plan.pins;
		dirty = true;
	}

	function endDrag() {
		dragging = undefined;
	}

	function addPin() {
		if (!newEntity) return;
		plan.pins = [...plan.pins, { id: Date.now(), entity_id: newEntity, x: 50, y: 50 }];
		newEntity = '';
		dirty = true;
	}

	function removePin(p: Pin) {
		plan.pins = plan.pins.filter((x) => x !== p);
		dirty = true;
	}

	async function save() {
		saving = true;
		try {
			const res = await fetch(`${base}/_api/save_floorplan`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(plan)
			});
			if (!res.ok) throw new Error(await res.text());
			dirty = false;
			editing = false;
		} catch (e) {
			console.error('save failed', e);
			alert('Could not save the layout. Check the container logs.');
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>Home</title>
	<meta name="theme-color" content="#1d1e21" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
	<meta name="apple-mobile-web-app-title" content="Home" />
	<link rel="apple-touch-icon" href="{base}/home-icon-180.png" />
</svelte:head>

<Theme initial={data.theme} />

<div class="frame">
	<div class="panel" class:editing>
		<!-- phone: compact header -->
		<header class="m-header" id="top">
			<div>
				<div class="brand small"><img src="{base}/home-icon.svg" alt="" /><span>Home</span></div>
				<div class="m-time">{time}</div>
				<div class="m-date">{date}</div>
			</div>
			<div class="m-side">
				{#each people as person (person.id)}
					<div class="avatar small" class:away={!person.home} title="{person.name} · {person.home ? 'home' : 'away'}">
						{#if person.picture}
							<img src={person.picture} alt={person.name} />
						{:else}
							<span>{person.name.slice(0, 1).toUpperCase()}</span>
						{/if}
					</div>
				{/each}
				<span class="m-temp">{temperature ?? '--'}</span>
				<span class="dot" class:ok={$connected} title={$connected ? 'Connected' : 'Connecting…'}></span>
			</div>
		</header>

		<!-- sidebar -->
		<aside>
			<div class="brand"><img src="{base}/home-icon.svg" alt="" /><span>Home</span></div>
			<div class="clock">
				<div class="time">{time}</div>
				<div class="date">{date}</div>
			</div>

			<nav>
				{#each modes as m}
					<button class="nav" class:active={mode === m.id} on:click={() => (mode = m.id)}>
						<span>{m.label}</span>
						<svg viewBox="0 0 24 24"><path d={m.icon} /></svg>
					</button>
				{/each}
				<button class="nav all-lights" on:click={() => openLights(allLights, 'All lights')}>
					<span>All lights</span>
					<svg viewBox="0 0 24 24"><path d={icons.sliders} /></svg>
				</button>
				<a class="nav settings" href="{haUrl}/config/dashboard" target="_blank" rel="noopener">
					<span>Settings</span>
					<svg viewBox="0 0 24 24"><path d={icons.cog} /></svg>
				</a>
			</nav>

			<div class="bottom">
				{#if people.length}
					<div class="label">People at home</div>
					<div class="people">
						{#each people as person (person.id)}
							<div class="avatar" class:away={!person.home} title="{person.name} · {person.home ? 'home' : 'away'}">
								{#if person.picture}
									<img src={person.picture} alt={person.name} />
								{:else}
									<span>{person.name.slice(0, 1).toUpperCase()}</span>
								{/if}
							</div>
						{/each}
					</div>
				{/if}

				<div class="temp">
					<span class="value">{temperature ?? '--'}</span>
					<svg viewBox="0 0 24 24"><path d={icons.thermometer} /></svg>
				</div>

				<div class="status">
					<span class="dot" class:ok={$connected}></span>
					{$connected ? 'Connected' : 'Connecting…'}
				</div>
			</div>
		</aside>

		<!-- plan -->
		<main>
			<!-- phone: what the pins show -->
			<div class="m-modes" role="tablist">
				{#each modes as m}
					<button role="tab" class:active={mode === m.id} on:click={() => (mode = m.id)}>{m.label}</button>
				{/each}
			</div>

			<!-- the wrapper only handles touch gestures; pins inside are the controls -->
			<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
			<div
				class="plan-wrap"
				class:zoomed
				class:gesturing
				bind:this={planWrap}
				on:pointerdown={onGestureDown}
				on:pointermove={onGestureMove}
				on:pointerup={onGestureUp}
				on:pointercancel={onGestureUp}
				on:click|capture={blockClickAfterGesture}
			>
			<div
				class="plan"
				style:--ar={geo ? geo.width / geo.height : undefined}
				style:transform={phone && zoomed ? `translate(${tx}px, ${ty}px) scale(${zoom})` : undefined}
				style:--inv={phone ? 1 / zoom : 1}
				bind:this={planEl}
				on:pointermove={moveDrag}
				on:pointerup={endDrag}
				on:pointercancel={endDrag}
			>
				<img class="map" src="{base}/_api/floorplan_image?f={plan.image}" alt="Floor plan" draggable="false" />

				{#if geo}
					<!-- room lighting: darken rooms that are off, tint lit rooms with the bulb colour -->
					<svg class="shade" viewBox="0 0 {geo.width} {geo.height}" preserveAspectRatio="none" aria-hidden="true">
						{#each lighting as r (r.name)}
							<g class="room-shade" style:opacity={r.kind === 'none' ? 0 : r.strength}>
								{#each r.points as pts}
									<polygon points={pts} style:fill={r.tint} />
								{/each}
							</g>
						{/each}
					</svg>
					<!-- glow around each lamp that is on, kept inside its room -->
					<svg class="light" viewBox="0 0 {geo.width} {geo.height}" preserveAspectRatio="none" aria-hidden="true">
						<defs>
							{#each lighting as r (r.name)}
								<clipPath id="room-{r.slug}">
									{#each r.points as pts}
										<polygon points={pts} />
									{/each}
								</clipPath>
							{/each}
							{#each lighting as r (r.name)}
								{#each r.lamps as l (l.id)}
									<radialGradient id="lamp-{l.id}">
										<stop offset="0" style:stop-color={l.color} style:stop-opacity={0.85 * l.level} />
										<stop offset="0.45" style:stop-color={l.color} style:stop-opacity={0.35 * l.level} />
										<stop offset="1" style:stop-color={l.color} style:stop-opacity="0" />
									</radialGradient>
								{/each}
							{/each}
						</defs>
						{#each lighting as r (r.name)}
							<g clip-path="url(#room-{r.slug})">
								{#each r.lamps as l (l.id)}
									<ellipse class="lamp-glow" cx={l.x} cy={l.y} rx={r.radius} ry={r.radius * 0.75} fill="url(#lamp-{l.id})" />
								{/each}
							</g>
						{/each}
					</svg>
				{/if}

				{#if mode === 'rooms' && !editing}
					{#each plan.rooms as room (room.name)}
						{@const lit = roomPins(room.name).filter((p) => isOn($states, p.entity_id)).length}
						<button
							class="room"
							style:left="{room.x}%"
							style:top="{room.y}%"
							title="Click to switch the room's lights, right-click for colours and modes"
							on:click={() => {
								if (roomLongPressed) return (roomLongPressed = false);
								toggleRoom(room.name);
							}}
							on:contextmenu|preventDefault={() => openLights(roomLights(room.name), room.name)}
							on:pointerdown={(e) => e.pointerType === 'touch' && roomPressStart(room.name)}
							on:pointerup={() => clearTimeout(roomTimer)}
							on:pointerleave={() => clearTimeout(roomTimer)}
						>
							<span class="room-name">{room.name}</span>
							<span class="room-sub">
								{#if roomPins(room.name).length}
									{lit ? `${lit} on` : 'all off'}
								{:else}
									no lights
								{/if}
							</span>
						</button>
					{/each}
				{/if}

				{#each editing ? plan.pins : visiblePins as p (p.id)}
					<button
						class="pin"
						class:on={isOn($states, p.entity_id)}
						class:unavailable={isUnavailable($states, p.entity_id)}
						class:dragging={dragging === p}
						class:fx={Boolean($activeEffects[p.entity_id])}
						style:left="{p.x}%"
						style:top="{p.y}%"
						title="{nameOf($states, p)}{isUnavailable($states, p.entity_id) ? ' · unavailable' : ''}"
						on:click={() => toggle(p)}
						on:contextmenu|preventDefault={() => openDetails(p)}
						on:pointerdown={(e) => {
							startDrag(e, p);
							if (e.pointerType === 'touch') pressStart(p);
						}}
						on:pointerup={pressEnd}
						on:pointerleave={pressEnd}
					>
						<svg viewBox="0 0 24 24"><path d={iconFor(p.entity_id)} /></svg>
						<span class="pin-name">{nameOf($states, p)}</span>
						{#if editing}
							<span class="remove" role="button" tabindex="0" on:click|stopPropagation={() => removePin(p)} on:keydown={(e) => e.key === 'Enter' && removePin(p)}>×</span>
						{/if}
					</button>
				{/each}
			</div>

			</div>
			<button class="m-zoom" on:click={toggleZoom} aria-label={zoomed ? 'Show the whole flat' : 'Zoom in on the plan'}>
				<svg viewBox="0 0 24 24"><path d={zoomed ? icons.zoomOut : icons.zoomIn} /></svg>
			</button>

			<!-- edit toolbar -->
			<div class="toolbar">
				{#if editing}
					<select bind:value={newEntity} aria-label="Device to place">
						<option value="">Add a device…</option>
						{#each unplaced as id}
							<option value={id}>{$states[id]?.attributes?.friendly_name || id} ({id})</option>
						{/each}
					</select>
					<button class="btn" on:click={addPin} disabled={!newEntity}>Place</button>
					<span class="hint">Drag pins to where the device is.</span>
					<button class="btn primary" on:click={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save layout'}</button>
					<button class="btn" on:click={() => { plan = structuredClone(data.floorplan); dirty = false; editing = false; }}>Cancel</button>
				{:else}
					<button class="btn ghost" on:click={() => (editing = true)}>Edit layout</button>
				{/if}
			</div>
		</main>

		<!-- phone: lights by room -->
		<section class="m-rooms" id="rooms">
			<button class="m-card all" style:--c={allColor} class:lit={allOn > 0} on:click={() => openLights(allLights, 'All lights')}>
				<span class="m-bulb"><svg viewBox="0 0 24 24"><path d={icons.light} /></svg></span>
				<span class="m-text">
					<span class="m-name">All lights</span>
					<span class="m-sub">{allOn ? `${allOn} of ${allLights.length} on` : 'All off'}</span>
				</span>
				<span
					class="m-switch"
					class:on={allOn > 0}
					role="switch"
					tabindex="0"
					aria-checked={allOn > 0}
					aria-label="Switch all lights"
					on:click|stopPropagation={toggleAll}
					on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggleAll())}
				></span>
			</button>

			<h2 class="m-title">Rooms</h2>
			<div class="m-grid">
				{#each roomCards as r (r.name)}
					<div
						class="m-card m-room"
						class:lit={r.on > 0}
						class:off={!r.reachable}
						style:--c={r.color}
						role="button"
						tabindex="0"
						on:click={() => {
							if (roomLongPressed) return (roomLongPressed = false);
							toggleRoom(r.name);
						}}
						on:keydown={(e) => e.key === 'Enter' && toggleRoom(r.name)}
						on:contextmenu|preventDefault={() => openLights(r.lights, r.name)}
						on:pointerdown={(e) => e.pointerType === 'touch' && roomPressStart(r.name)}
						on:pointerup={() => clearTimeout(roomTimer)}
						on:pointerleave={() => clearTimeout(roomTimer)}
					>
						<span class="m-bulb"><svg viewBox="0 0 24 24"><path d={icons.light} /></svg></span>
						<span class="m-name">{r.name}</span>
						<span class="m-sub">{r.status}</span>
						<button
							class="m-more"
							data-room-panel
							aria-label="Colours and modes for {r.name}"
							on:click|stopPropagation={() => openLights(r.lights, r.name)}
						>
							<svg viewBox="0 0 24 24"><path d={icons.sliders} /></svg>
						</button>
						{#if r.effect}
							<span class="m-fx">{r.effect}</span>
						{/if}
					</div>
				{/each}
			</div>

			{#if mediaPins.length}
				<h2 class="m-title">Media</h2>
				<div class="m-grid">
					{#each mediaPins as p (p.id)}
						<button class="m-card m-room" class:off={isUnavailable($states, p.entity_id)} on:click={() => openDetails(p)}>
							<span class="m-bulb"><svg viewBox="0 0 24 24"><path d={icons.media} /></svg></span>
							<span class="m-name">{nameOf($states, p)}</span>
							<span class="m-sub cap">{isUnavailable($states, p.entity_id) ? 'Unreachable' : $states?.[p.entity_id]?.state}</span>
						</button>
					{/each}
				</div>
			{/if}
		</section>
	</div>
</div>

<!-- phone: tab bar -->
<nav class="m-tabbar" aria-label="Sections">
	<a href="#top" class="tab"><svg viewBox="0 0 24 24"><path d={icons.home} /></svg><span>Home</span></a>
	<a href="#rooms" class="tab"><svg viewBox="0 0 24 24"><path d={icons.rooms} /></svg><span>Rooms</span></a>
	<button class="tab" on:click={() => openLights(allLights, 'All lights')}
		><svg viewBox="0 0 24 24"><path d={icons.sliders} /></svg><span>All lights</span></button
	>
	<a class="tab" href="{haUrl}/config/dashboard" target="_blank" rel="noopener"
		><svg viewBox="0 0 24 24"><path d={icons.cog} /></svg><span>Settings</span></a
	>
</nav>

<style>
	:global(body) {
		background: #e9e7e2 !important;
	}

	/* Fusion's detail modals: match the dark panel instead of the theme's photo background.
	   :root:root outranks the :root rule the Theme component injects. */
	:global(:root:root) {
		--theme-background-image: none;
		--theme-modal-background-color-modal: rgba(38, 39, 43, 0.97);
		--theme-modal-background-color: rgba(255, 255, 255, 0.06);
		--theme-app-color: #26272b;
	}
	:global(div.backdrop) {
		background-color: rgba(18, 18, 20, 0.55) !important;
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
	}

	.frame {
		min-height: 100vh;
		display: grid;
		place-items: center;
		padding: 14px;
		box-sizing: border-box;
		font-family: 'Inter Variable', Inter, system-ui, sans-serif;
		color: #e8e6e1;
	}

	.panel {
		width: 100%;
		height: calc(100vh - 28px);
		min-height: 560px;
		display: grid;
		grid-template-columns: 290px 1fr;
		background: #26272b;
		border-radius: 28px;
		box-shadow:
			0 40px 80px -30px rgba(0, 0, 0, 0.6),
			0 0 0 1px rgba(255, 255, 255, 0.04) inset;
		overflow: hidden;
	}

	/* ---------- sidebar ---------- */
	aside {
		display: flex;
		flex-direction: column;
		padding: 44px 30px 30px;
		gap: 38px;
		border-right: 1px solid rgba(255, 255, 255, 0.05);
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: -14px;
		font-size: 17px;
		font-weight: 600;
		letter-spacing: 0.01em;
		color: #f3f1ec;
	}
	.brand img {
		width: 34px;
		height: 34px;
		border-radius: 9px;
		box-shadow: 0 4px 12px -4px rgba(10, 111, 194, 0.7);
	}
	.brand.small {
		margin: 0 0 12px;
		font-size: 15px;
	}
	.brand.small img {
		width: 28px;
		height: 28px;
		border-radius: 8px;
	}
	.time {
		font-size: 68px;
		font-weight: 200;
		letter-spacing: 0.02em;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		color: #f3f1ec;
	}

	.date {
		margin-top: 10px;
		font-size: 14.5px;
		color: #8d8d93;
	}

	nav {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 13px 16px;
		border: 0;
		border-radius: 13px;
		background: transparent;
		color: #b8b7b3;
		font: inherit;
		font-size: 15.5px;
		letter-spacing: 0.03em;
		cursor: pointer;
		transition: background 150ms ease, color 150ms ease;
	}
	.nav svg {
		width: 20px;
		height: 20px;
		fill: currentColor;
		opacity: 0.8;
	}
	.nav:hover {
		background: rgba(255, 255, 255, 0.05);
		color: #f3f1ec;
	}
	.nav.active {
		background: #35363b;
		color: #ffffff;
		font-weight: 500;
	}
	.nav:focus-visible {
		outline: 2px solid #ffb86b;
		outline-offset: 2px;
	}

	.bottom {
		margin-top: auto;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.label {
		font-size: 12px;
		color: #8d8d93;
	}

	.people {
		display: flex;
		gap: 10px;
	}

	.avatar {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		overflow: hidden;
		background: #3b3c41;
		display: grid;
		place-items: center;
		font-size: 15px;
		font-weight: 500;
		color: #f3f1ec;
		box-shadow: 0 0 0 2px #26272b, 0 0 0 3px rgba(255, 255, 255, 0.12);
		transition: opacity 200ms ease, filter 200ms ease;
	}
	.avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.avatar.away {
		opacity: 0.3;
		filter: grayscale(1);
	}

	.temp {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 6px;
	}
	.temp .value {
		font-size: 22px;
		font-weight: 300;
		font-variant-numeric: tabular-nums;
	}
	.temp svg {
		width: 18px;
		height: 18px;
		fill: #ffb86b;
	}

	.status {
		font-size: 11px;
		color: #6f6f75;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #6f6f75;
	}
	.dot.ok {
		background: #5bd07d;
		box-shadow: 0 0 8px #5bd07d;
	}

	/* ---------- plan ---------- */
	main {
		position: relative;
		display: grid;
		place-items: center;
		padding: 18px 22px;
		min-width: 0;
		min-height: 0;
	}

	.plan {
		position: relative;
		isolation: isolate;
		/* as big as the panel allows, keeping the plan's proportions (--ar = width / height) */
		width: min(100%, calc((100vh - 64px) * var(--ar, 1.25)));
		aspect-ratio: var(--ar, 1.25);
		user-select: none;
		touch-action: none;
	}

	.map {
		display: block;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	.shade,
	.light {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}
	.shade {
		mix-blend-mode: multiply;
	}
	.light {
		mix-blend-mode: screen;
	}
	.room-shade {
		transition: opacity 900ms ease;
	}
	.room-shade polygon {
		transition: fill 900ms ease;
	}
	.light stop {
		transition:
			stop-color 900ms ease,
			stop-opacity 900ms ease;
	}

	.pin {
		position: absolute;
		transform: translate(-50%, -50%);
		-webkit-touch-callout: none;
		width: 46px;
		height: 46px;
		border-radius: 50%;
		border: 0;
		padding: 0;
		background: #f6f4ef;
		color: #2a2b2f;
		display: grid;
		place-items: center;
		cursor: pointer;
		box-shadow: 0 6px 16px -4px rgba(0, 0, 0, 0.6);
		transition: transform 150ms ease, box-shadow 200ms ease, background 200ms ease;
	}
	.pin svg {
		width: 21px;
		height: 21px;
		fill: currentColor;
	}
	.pin:hover {
		transform: translate(-50%, -50%) scale(1.08);
	}
	.pin:focus-visible {
		outline: 2px solid #ffb86b;
		outline-offset: 3px;
	}
	.pin.on {
		color: #d9771a;
		box-shadow:
			0 6px 16px -4px rgba(0, 0, 0, 0.6),
			0 0 0 4px rgba(255, 184, 107, 0.35);
	}
	.pin.fx::before {
		content: '';
		position: absolute;
		inset: -5px;
		border-radius: 50%;
		background: conic-gradient(#ff0080, #00c8ff, #ffdc00, #8c00ff, #00ff78, #ff0080);
		/* only a ring around the pin */
		-webkit-mask: radial-gradient(closest-side, transparent 78%, #000 80%);
		mask: radial-gradient(closest-side, transparent 78%, #000 80%);
		animation: fx-spin 2.4s linear infinite;
	}
	@keyframes fx-spin {
		to {
			transform: rotate(360deg);
		}
	}
	.nav.all-lights {
		margin-top: 10px;
		border: 1px solid rgba(255, 184, 107, 0.35);
		color: #ffcf9a;
	}
	.nav.all-lights:hover {
		background: rgba(255, 184, 107, 0.12);
	}
	a.nav {
		text-decoration: none;
		box-sizing: border-box;
	}
	.nav.settings {
		margin-top: 4px;
	}

	.pin.unavailable {
		background: #5a5b60;
		color: #9a9a9f;
		cursor: not-allowed;
	}
	.pin.unavailable::after {
		content: '';
		position: absolute;
		width: 26px;
		height: 2px;
		background: #9a9a9f;
		transform: rotate(-45deg);
	}

	.pin-name {
		position: absolute;
		top: 100%;
		margin-top: 8px;
		padding: 3px 8px;
		border-radius: 6px;
		background: rgba(20, 20, 22, 0.85);
		color: #f3f1ec;
		font-size: 11px;
		white-space: nowrap;
		opacity: 0;
		pointer-events: none;
		transition: opacity 150ms ease;
	}
	.pin:hover .pin-name,
	.editing .pin-name {
		opacity: 1;
	}

	.editing .pin {
		cursor: grab;
		outline: 2px dashed rgba(255, 184, 107, 0.7);
		outline-offset: 3px;
	}
	.pin.dragging {
		cursor: grabbing;
		transform: translate(-50%, -50%) scale(1.12);
	}
	.remove {
		position: absolute;
		top: -8px;
		right: -8px;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: #d9534f;
		color: white;
		font-size: 14px;
		line-height: 20px;
		text-align: center;
	}

	.room {
		position: absolute;
		transform: translate(-50%, -50%);
		border: 0;
		padding: 10px 16px;
		border-radius: 14px;
		background: rgba(20, 20, 22, 0.78);
		color: #f3f1ec;
		font: inherit;
		text-align: left;
		cursor: pointer;
		backdrop-filter: blur(6px);
		display: flex;
		flex-direction: column;
		gap: 2px;
		box-shadow: 0 8px 20px -8px rgba(0, 0, 0, 0.7);
	}
	.room:hover {
		background: rgba(40, 40, 44, 0.9);
	}
	.room-name {
		font-size: 14px;
		font-weight: 500;
	}
	.room-sub {
		font-size: 11px;
		color: #ffb86b;
	}

	/* ---------- toolbar ---------- */
	.toolbar {
		position: absolute;
		right: 22px;
		bottom: 18px;
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
		justify-content: flex-end;
		max-width: calc(100% - 44px);
		z-index: 2;
	}
	.hint {
		font-size: 12px;
		color: #8d8d93;
		margin-right: auto;
	}
	.btn,
	select {
		font: inherit;
		font-size: 13px;
		padding: 8px 14px;
		border-radius: 10px;
		border: 1px solid rgba(255, 255, 255, 0.1);
		background: #35363b;
		color: #f3f1ec;
		cursor: pointer;
	}
	select {
		max-width: 320px;
	}
	.btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.btn.primary {
		background: #ffb86b;
		color: #2a2b2f;
		border-color: transparent;
		font-weight: 500;
	}
	.btn.ghost {
		background: transparent;
		color: #8d8d93;
		margin-left: auto;
	}
	.btn.ghost:hover {
		color: #f3f1ec;
	}

	/* ---------- responsive ---------- */
	/* ---------- phone-only parts are hidden on bigger screens ---------- */
	.m-header,
	.m-modes,
	.m-zoom,
	.m-rooms,
	.m-tabbar {
		display: none;
	}
	.plan-wrap {
		display: contents;
	}

	/* ---------- tablets in portrait ---------- */
	@media (max-width: 1100px) and (min-width: 761px) {
		.panel {
			grid-template-columns: 240px minmax(0, 1fr);
		}
		aside {
			padding: 32px 22px 24px;
		}
		.time {
			font-size: 52px;
		}
	}

	/* ---------- phones: a single column like an app ---------- */
	@media (max-width: 760px) {
		:global(body) {
			background: #1d1e21 !important;
		}
		.frame {
			display: block;
			padding: 0;
			min-height: 100dvh;
		}
		.panel {
			display: block;
			height: auto;
			min-height: 100dvh;
			border-radius: 0;
			background: #1d1e21;
			box-shadow: none;
			overflow: visible;
			padding-bottom: calc(84px + env(safe-area-inset-bottom));
		}
		aside,
		.toolbar {
			display: none;
		}

		/* header */
		.m-header {
			display: flex;
			align-items: flex-end;
			justify-content: space-between;
			gap: 12px;
			padding: calc(env(safe-area-inset-top) + 18px) 20px 14px;
		}
		.m-time {
			font-size: 46px;
			font-weight: 200;
			line-height: 1;
			font-variant-numeric: tabular-nums;
			color: #f3f1ec;
		}
		.m-date {
			margin-top: 6px;
			font-size: 13px;
			color: #8d8d93;
		}
		.m-side {
			display: flex;
			align-items: center;
			gap: 8px;
			padding-bottom: 4px;
		}
		.avatar.small {
			width: 30px;
			height: 30px;
			font-size: 12px;
		}
		.m-temp {
			margin-left: 4px;
			font-size: 18px;
			font-weight: 300;
			font-variant-numeric: tabular-nums;
		}

		/* plan card */
		main {
			display: block;
			position: relative;
			margin: 0 12px;
			padding: 10px 0 0;
			border-radius: 24px;
			background: #26272b;
			overflow: hidden;
		}
		.m-modes {
			display: flex;
			gap: 6px;
			padding: 0 10px 8px;
			overflow-x: auto;
			scrollbar-width: none;
		}
		.m-modes::-webkit-scrollbar {
			display: none;
		}
		.m-modes button {
			flex: none;
			font: inherit;
			font-size: 13px;
			padding: 7px 13px;
			border: 0;
			border-radius: 999px;
			background: rgba(255, 255, 255, 0.06);
			color: #b8b7b3;
		}
		.m-modes button.active {
			background: #f3f1ec;
			color: #1d1e21;
			font-weight: 600;
		}
		.plan-wrap {
			display: block;
			overflow: hidden;
			margin-bottom: 12px;
			/* one finger scrolls the page; two fingers zoom (handled in the page) */
			touch-action: pan-y;
		}
		.plan-wrap.zoomed {
			/* zoomed in: one finger moves the plan instead of the page */
			touch-action: none;
		}
		.plan {
			width: 100%;
			margin: 0 auto;
			transform-origin: 0 0;
			transition: transform 250ms ease;
			will-change: transform;
		}
		.plan-wrap.gesturing .plan {
			transition: none;
		}
		/* pins and room tags keep their size while the plan is zoomed */
		.pin,
		.pin:hover {
			transform: translate(-50%, -50%) scale(var(--inv, 1));
		}
		.room {
			transform: translate(-50%, -50%) scale(var(--inv, 1));
		}
		.m-zoom {
			display: grid;
			place-items: center;
			position: absolute;
			right: 10px;
			bottom: 10px;
			width: 40px;
			height: 40px;
			border: 0;
			border-radius: 12px;
			background: rgba(20, 20, 22, 0.75);
			color: #f3f1ec;
			backdrop-filter: blur(6px);
		}
		.m-zoom svg {
			width: 22px;
			height: 22px;
			fill: currentColor;
		}
		.pin {
			width: 32px;
			height: 32px;
		}
		.pin svg {
			width: 16px;
			height: 16px;
		}
		.pin-name {
			display: none;
		}
		.room {
			padding: 6px 10px;
			border-radius: 10px;
		}
		.room-name {
			font-size: 12px;
		}
		.room-sub {
			font-size: 10px;
		}

		/* rooms */
		.m-rooms {
			display: block;
			padding: 14px 12px 8px;
		}
		.m-title {
			margin: 22px 8px 10px;
			font-size: 17px;
			font-weight: 600;
			color: #f3f1ec;
		}
		.m-grid {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 10px;
		}
		.m-card {
			position: relative;
			display: flex;
			flex-direction: column;
			align-items: flex-start;
			gap: 3px;
			width: 100%;
			min-height: 108px;
			padding: 14px;
			border: 0;
			border-radius: 22px;
			background: #26272b;
			color: #e8e6e1;
			font: inherit;
			text-align: left;
			cursor: pointer;
			-webkit-tap-highlight-color: transparent;
			transition:
				background 600ms ease,
				transform 120ms ease;
		}
		.m-card:active {
			transform: scale(0.97);
		}
		.m-card.lit {
			background:
				radial-gradient(120% 90% at 0% 0%, color-mix(in srgb, var(--c) 34%, transparent), transparent 70%),
				#2c2d32;
		}
		.m-card.off {
			opacity: 0.55;
		}
		.m-card.all {
			flex-direction: row;
			align-items: center;
			gap: 14px;
			min-height: 0;
			padding: 16px;
		}
		.m-text {
			display: flex;
			flex-direction: column;
			gap: 2px;
			margin-right: auto;
		}
		.m-bulb {
			display: grid;
			place-items: center;
			width: 40px;
			height: 40px;
			margin-bottom: 10px;
			border-radius: 50%;
			background: #3a3b40;
			color: #8d8d93;
			transition:
				background 600ms ease,
				color 600ms ease,
				box-shadow 600ms ease;
		}
		.m-card.all .m-bulb {
			margin-bottom: 0;
		}
		.m-card.lit .m-bulb {
			background: #f6f4ef;
			color: var(--c);
			box-shadow: 0 0 18px -2px var(--c);
		}
		.m-bulb svg {
			width: 20px;
			height: 20px;
			fill: currentColor;
		}
		.m-name {
			font-size: 15px;
			font-weight: 600;
		}
		.m-sub {
			font-size: 13px;
			color: #9a9aa0;
		}
		.m-sub.cap {
			text-transform: capitalize;
		}
		.m-more {
			position: absolute;
			top: 10px;
			right: 10px;
			display: grid;
			place-items: center;
			width: 36px;
			height: 36px;
			border: 0;
			border-radius: 12px;
			background: rgba(255, 255, 255, 0.06);
			color: #d6d4cf;
		}
		.m-more svg {
			width: 18px;
			height: 18px;
			fill: currentColor;
		}
		.m-fx {
			position: absolute;
			right: 12px;
			bottom: 12px;
			font-size: 11px;
			padding: 3px 8px;
			border-radius: 999px;
			background: rgba(255, 184, 107, 0.18);
			color: #ffcf9a;
		}
		.m-switch {
			flex: none;
			position: relative;
			width: 52px;
			height: 31px;
			border-radius: 999px;
			background: #45464c;
			transition: background 200ms ease;
		}
		.m-switch::after {
			content: '';
			position: absolute;
			top: 3px;
			left: 3px;
			width: 25px;
			height: 25px;
			border-radius: 50%;
			background: #fff;
			box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
			transition: transform 200ms ease;
		}
		.m-switch.on {
			background: #34c759;
		}
		.m-switch.on::after {
			transform: translateX(21px);
		}

		/* tab bar */
		.m-tabbar {
			display: grid;
			grid-template-columns: repeat(4, 1fr);
			position: fixed;
			left: 0;
			right: 0;
			bottom: 0;
			z-index: 2;
			padding: 8px 8px calc(8px + env(safe-area-inset-bottom));
			background: rgba(29, 30, 33, 0.88);
			backdrop-filter: blur(16px);
			-webkit-backdrop-filter: blur(16px);
			border-top: 1px solid rgba(255, 255, 255, 0.06);
			font-family: 'Inter Variable', Inter, system-ui, sans-serif;
		}
		.tab {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 3px;
			padding: 6px 0;
			border: 0;
			background: none;
			color: #9a9aa0;
			font: inherit;
			font-size: 11px;
			text-decoration: none;
		}
		.tab svg {
			width: 24px;
			height: 24px;
			fill: currentColor;
		}
		.tab:active {
			color: #ffcf9a;
		}

		/* light panel and other dialogs become a sheet from the bottom */
		:global(#modal) {
			align-items: flex-end !important;
		}
		:global(#modal .contents) {
			width: 100vw !important;
			max-width: 100vw !important;
			max-height: 90dvh !important;
			border-radius: 24px 24px 0 0 !important;
			padding: 0.6rem 1.1rem calc(1.4rem + env(safe-area-inset-bottom)) !important;
		}
		:global(#modal .contents)::before {
			content: '';
			display: block;
			width: 40px;
			height: 5px;
			margin: 0 auto 0.8rem;
			border-radius: 3px;
			background: rgba(255, 255, 255, 0.25);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.pin.fx::before {
			animation: none;
		}
		.pin,
		.nav,
		.avatar {
			transition: none;
		}
	}
</style>
