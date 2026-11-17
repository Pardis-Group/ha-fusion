<script lang="ts">
	import { configuration, states, connection, connected, translation, selectedLanguage } from '$lib/Stores';
	import { openModal } from 'svelte-modals';
	import Theme from '$lib/Components/Theme.svelte';
	import { authentication } from '$lib/Socket';
	import { callService } from 'home-assistant-js-websocket';
	import { browser } from '$app/environment';
	import { base } from '$app/paths';
	import { onDestroy, onMount } from 'svelte';
	import { icons, iconFor } from '$lib/Floorplan/icons';
	import type { Floorplan, Pin } from '$lib/Floorplan/types';

	export let data: { configuration: any; floorplan: Floorplan; theme: any; translations: any };

	$configuration = data.configuration;
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

	/** warm light colour for the glow, from the light's rgb_color when it has one */
	function glowColor(st: any, id: string) {
		const rgb = st?.[id]?.attributes?.rgb_color;
		return rgb ? `rgb(${rgb.join(',')})` : 'rgb(255, 196, 120)';
	}

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
				openModal(() => import('$lib/Modal/LightModal.svelte'), { sel });
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
</svelte:head>

<Theme initial={data.theme} />

<div class="frame">
	<div class="panel" class:editing>
		<!-- sidebar -->
		<aside>
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
			<div
				class="plan"
				bind:this={planEl}
				on:pointermove={moveDrag}
				on:pointerup={endDrag}
				on:pointercancel={endDrag}
			>
				<img class="map" src="{base}/_api/floorplan_image?f={plan.image}" alt="Floor plan" draggable="false" />

				<!-- light spill: a glow on the plan under every light that is on -->
				<div class="glows">
					{#each plan.pins as p (p.id)}
						{#if ['light', 'switch'].includes(domain(p.entity_id)) && isOn($states, p.entity_id)}
							<div class="glow" style:left="{p.x}%" style:top="{p.y}%" style:--c={glowColor($states, p.entity_id)}></div>
						{/if}
					{/each}
				</div>

				{#if mode === 'rooms' && !editing}
					{#each plan.rooms as room (room.name)}
						{@const lit = roomPins(room.name).filter((p) => isOn($states, p.entity_id)).length}
						<button class="room" style:left="{room.x}%" style:top="{room.y}%" on:click={() => toggleRoom(room.name)}>
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
	</div>
</div>

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
		padding: 24px;
		box-sizing: border-box;
		font-family: 'Inter Variable', Inter, system-ui, sans-serif;
		color: #e8e6e1;
	}

	.panel {
		width: min(100%, 1500px);
		min-height: min(calc(100vh - 48px), 900px);
		display: grid;
		grid-template-columns: 260px 1fr;
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
		padding: 40px 28px 28px;
		gap: 36px;
		border-right: 1px solid rgba(255, 255, 255, 0.05);
	}

	.time {
		font-size: 56px;
		font-weight: 200;
		letter-spacing: 0.02em;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		color: #f3f1ec;
	}

	.date {
		margin-top: 10px;
		font-size: 13px;
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
		padding: 12px 14px;
		border: 0;
		border-radius: 12px;
		background: transparent;
		color: #b8b7b3;
		font: inherit;
		font-size: 14px;
		letter-spacing: 0.03em;
		cursor: pointer;
		transition: background 150ms ease, color 150ms ease;
	}
	.nav svg {
		width: 18px;
		height: 18px;
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
		grid-template-rows: 1fr auto;
		padding: 28px;
		gap: 16px;
		min-width: 0;
	}

	.plan {
		position: relative;
		align-self: center;
		justify-self: center;
		width: fit-content;
		max-width: 100%;
		user-select: none;
		touch-action: none;
	}

	.map {
		display: block;
		width: auto;
		height: auto;
		max-width: 100%;
		max-height: calc(100vh - 170px);
		pointer-events: none;
	}

	.glows {
		position: absolute;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
	}

	.glow {
		position: absolute;
		width: 15%;
		aspect-ratio: 1;
		/* squash to match the floor's foreshortening in the generated plan (sin of the view elevation) */
		transform: translate(-50%, -50%) scaleY(0.64);
		border-radius: 50%;
		background: radial-gradient(circle, var(--c) 0%, transparent 65%);
		opacity: 0.45;
		mix-blend-mode: screen;
		pointer-events: none;
		transition: opacity 400ms ease;
	}

	.pin {
		position: absolute;
		transform: translate(-50%, -50%);
		-webkit-touch-callout: none;
		width: 40px;
		height: 40px;
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
		width: 18px;
		height: 18px;
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
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
		min-height: 36px;
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
	@media (max-width: 900px) {
		.frame {
			padding: 0;
		}
		.panel {
			grid-template-columns: 1fr;
			grid-template-rows: auto 1fr;
			border-radius: 0;
			min-height: 100vh;
		}
		aside {
			border-right: 0;
			border-bottom: 1px solid rgba(255, 255, 255, 0.05);
			padding: 24px 20px;
			gap: 20px;
		}
		.time {
			font-size: 40px;
		}
		nav {
			flex-direction: row;
			overflow-x: auto;
		}
		.nav span {
			white-space: nowrap;
		}
		.bottom {
			margin-top: 0;
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
			flex-wrap: wrap;
		}
		.status {
			width: 100%;
		}
		.label {
			display: none;
		}
		main {
			padding: 16px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.pin,
		.nav,
		.glow,
		.avatar {
			transition: none;
		}
	}
</style>
