<script lang="ts">
	/**
	 * Light panel for one light, a room, or every light in the flat:
	 * power, brightness, white temperature, colour wheel, scenes, effects and a sleep timer.
	 */
	import Modal from '$lib/Modal/Index.svelte';
	import Toggle from '$lib/Components/Toggle.svelte';
	import { states, connection } from '$lib/Stores';
	import { callService, type HassEntity } from 'home-assistant-js-websocket';
	import iro from '@jaames/iro';
	import { onDestroy, onMount, tick } from 'svelte';
	import {
		staticModes,
		dynamicModes,
		effectGroups,
		swatches,
		defaultOptions,
		type LightMode,
		type RGB,
		type EffectOptions
	} from './modes';
	import {
		activeEffects,
		effectsAvailable,
		lastStatic,
		sleepTimers,
		applyMode,
		stopEffect,
		startEffect,
		turnOn,
		clearStatic,
		refreshEffects,
		setSleepTimer,
		cancelSleepTimer
	} from './effects';

	export let isOpen: boolean;
	export let entities: string[];
	export let title: string;

	const COLOR_MODES = ['hs', 'xy', 'rgb', 'rgbw', 'rgbww'];

	$: lights = entities.map((e) => $states?.[e]).filter(Boolean) as HassEntity[];
	$: reachable = lights.filter((s) => s.state !== 'unavailable' && s.state !== 'unknown');
	$: lit = lights.filter((s) => s.state === 'on');
	$: ref = lit[0] || reachable[0];
	$: anyOn = lit.length > 0;
	$: none = reachable.length === 0;
	$: many = entities.length > 1;
	$: modesOf = (s: HassEntity) => (s.attributes?.supported_color_modes as string[]) || [];
	$: canColor = reachable.some((s) => modesOf(s).some((m) => COLOR_MODES.includes(m)));
	$: canTemp = reachable.some((s) => modesOf(s).includes('color_temp'));
	$: minK = reachable.length ? Math.max(...reachable.map((s) => s.attributes?.min_color_temp_kelvin ?? 2200)) : 2200;
	$: maxK = reachable.length ? Math.min(...reachable.map((s) => s.attributes?.max_color_temp_kelvin ?? 6500)) : 6500;

	$: running = entities.map((e) => $activeEffects[e]).find(Boolean);
	$: runningMode = running ? dynamicModes.find((m) => m.id === running?.mode) : undefined;
	$: picked = entities.map((e) => $lastStatic[e]).find(Boolean);
	$: timerEnds = entities.map((e) => $sleepTimers[e]).find(Boolean);

	$: status = none
		? many
			? 'None of these lights can be reached'
			: 'Unreachable: check that the lamp has power'
		: many
			? `${lit.length} of ${lights.length} on`
			: anyOn
				? `On · ${Math.round((ref?.attributes?.brightness ?? 0) / 2.55)}%`
				: 'Off';

	/* ---------- effect options ---------- */
	let opts: EffectOptions = { ...defaultOptions };
	$: if (running) opts = { speed: running.speed, sync: running.sync, dim: running.dim };

	async function restartEffect(changes: Partial<EffectOptions>) {
		if (!running) return;
		opts = { ...opts, ...changes };
		await startEffect($connection, running.mode, entities, opts).catch((e) => console.error(e));
	}

	/* ---------- brightness and temperature, synced from the light unless the user is dragging ---------- */
	let brightness = 100;
	let kelvin = 3000;
	let holdB = false;
	let holdK = false;
	$: if (!holdB && running) brightness = Math.round(running.dim * 100);
	$: if (!holdB && !running && ref?.state === 'on' && ref.attributes?.brightness)
		brightness = Math.max(1, Math.round(ref.attributes.brightness / 2.55));
	$: if (!holdK && ref?.attributes?.color_temp_kelvin) kelvin = ref.attributes.color_temp_kelvin;

	let tab: 'white' | 'color' = 'white';
	onMount(() => {
		tab = ref?.attributes?.color_mode && ref.attributes.color_mode !== 'color_temp' && canColor ? 'color' : canTemp ? 'white' : 'color';
		refreshEffects($connection);
	});

	async function power() {
		await stopEffect($connection, entities);
		callService($connection, 'light', anyOn ? 'turn_off' : 'turn_on', { entity_id: entities });
	}

	async function setBrightness() {
		holdB = false;
		if (running) return restartEffect({ dim: Math.max(0.05, brightness / 100) });
		clearStatic(entities);
		turnOn($connection, $states, entities, { brightness_pct: brightness }, 0.4);
	}

	async function setKelvin(k = kelvin) {
		holdK = false;
		kelvin = k;
		await stopEffect($connection, entities);
		clearStatic(entities);
		turnOn($connection, $states, entities, { color_temp_kelvin: k }, 0.8);
	}

	let lastSent = 0;
	async function setColor(rgb: RGB, final = true) {
		const now = Date.now();
		if (!final && now - lastSent < 350) return;
		lastSent = now;
		if (final) {
			await stopEffect($connection, entities);
			clearStatic(entities);
		}
		turnOn($connection, $states, entities, { rgb_color: rgb }, final ? 0.6 : 0.3);
	}

	async function pick(mode: LightMode) {
		if (none) return;
		try {
			await applyMode($connection, $states, mode, entities, mode.kind === 'dynamic' ? { ...opts, dim: running ? opts.dim : 1 } : undefined);
		} catch (e) {
			console.error('mode failed', e);
		}
	}

	/* ---------- sleep timer ---------- */
	let now = Date.now();
	const clock = setInterval(() => (now = Date.now()), 15000);
	onDestroy(() => clearInterval(clock));
	$: timerText = timerEnds
		? `Off at ${new Date(timerEnds).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${Math.max(1, Math.round((timerEnds - now) / 60000))} min left`
		: '';

	/* ---------- colour wheel ---------- */
	let wheelEl: HTMLDivElement;
	let picker: iro.ColorPicker | undefined;

	$: if (tab === 'color' && wheelEl && !picker) mountWheel();
	$: if (tab !== 'color' && picker) destroyWheel();

	async function mountWheel() {
		await tick();
		if (!wheelEl || picker) return;
		const rgb = ref?.attributes?.rgb_color as RGB | undefined;
		picker = iro.ColorPicker(wheelEl, {
			width: 230,
			color: rgb ? { r: rgb[0], g: rgb[1], b: rgb[2] } : '#ffb46b',
			handleRadius: 16,
			borderWidth: 3,
			borderColor: '#2a2b30',
			layout: [{ component: iro.ui.Wheel, options: { wheelAngle: 270, wheelDirection: 'clockwise' } }]
		});
		picker.on('input:change', (c: any) => setColor([c.rgb.r, c.rgb.g, c.rgb.b], false));
		picker.on('input:end', (c: any) => setColor([c.rgb.r, c.rgb.g, c.rgb.b], true));
	}

	function destroyWheel() {
		picker = undefined;
		if (wheelEl) wheelEl.innerHTML = '';
	}

	onDestroy(destroyWheel);

	const css = (c: RGB) => `rgb(${c.join(',')})`;
	$: lampColor = ref?.state === 'on' && ref.attributes?.rgb_color ? css(ref.attributes.rgb_color) : 'rgb(255, 196, 120)';
	const speedLabel = (s: number) => (s <= 0.5 ? 'Very slow' : s < 1 ? 'Slow' : s === 1 ? 'Normal' : s <= 1.5 ? 'Fast' : 'Very fast');
</script>

{#if isOpen}
	<Modal>
		<span slot="title">{title}</span>

		<div class="panel" style:--lamp={lampColor}>
			<div class="power">
				<div class="bulb" class:on={anyOn}>
					<svg viewBox="0 0 24 24"
						><path
							d="M12,2A7,7 0 0,0 5,9C5,11.38 6.19,13.47 8,14.74V17A1,1 0 0,0 9,18H15A1,1 0 0,0 16,17V14.74C17.81,13.47 19,11.38 19,9A7,7 0 0,0 12,2M9,21A1,1 0 0,0 10,22H14A1,1 0 0,0 15,21V20H9V21Z"
						/></svg
					>
				</div>
				<div class="status">
					<span class="state">{status}</span>
					{#if runningMode}
						<span class="fx">Effect: {runningMode.name}</span>
					{/if}
					{#if timerText}
						<span class="fx">{timerText}</span>
					{/if}
				</div>
				{#if !none}
					<Toggle checked={anyOn} on:change={power} />
				{/if}
			</div>

			{#if !none}
				<!-- brightness (scales the effect while one runs) -->
				<div class="row">
					<span class="label">{running ? 'Effect brightness' : 'Brightness'}</span>
					<span class="value">{brightness}%</span>
				</div>
				<input
					class="range brightness"
					type="range"
					min="1"
					max="100"
					bind:value={brightness}
					on:pointerdown={() => (holdB = true)}
					on:change={setBrightness}
					aria-label="Brightness"
				/>

				{#if running}
					<!-- options of the running effect -->
					<div class="effect-box">
						<div class="row">
							<span class="label">Speed</span>
							<span class="value">{speedLabel(opts.speed)}</span>
						</div>
						<input
							class="range speed"
							type="range"
							min="0.5"
							max="2"
							step="0.25"
							value={opts.speed}
							on:change={(e) => restartEffect({ speed: Number(e.currentTarget.value) })}
							aria-label="Effect speed"
						/>
						{#if many}
							<label class="sync">
								<span>
									<span class="label">Same colour on every light</span>
									<span class="hint">Off: each light runs a step behind the next, like a wave</span>
								</span>
								<Toggle checked={opts.sync} on:change={() => restartEffect({ sync: !opts.sync })} />
							</label>
						{/if}
						<button class="stop" on:click={() => stopEffect($connection, entities)}>Stop effect</button>
					</div>
				{/if}

				<!-- white / colour -->
				{#if canTemp && canColor}
					<div class="tabs" role="tablist">
						<button role="tab" class:selected={tab === 'white'} on:click={() => (tab = 'white')}>White</button>
						<button role="tab" class:selected={tab === 'color'} on:click={() => (tab = 'color')}>Colour</button>
					</div>
				{/if}

				{#if tab === 'white' && canTemp}
					<div class="row">
						<span class="label">Temperature</span>
						<span class="value">{kelvin} K</span>
					</div>
					<input
						class="range kelvin"
						type="range"
						min={minK}
						max={maxK}
						step="50"
						bind:value={kelvin}
						on:pointerdown={() => (holdK = true)}
						on:change={() => setKelvin()}
						aria-label="Colour temperature"
					/>
					<div class="chips">
						{#each [['Warm', 2700], ['Soft', 3300], ['Neutral', 4000], ['Daylight', 5500]] as [name, k]}
							<button class="chip" disabled={Number(k) < minK || Number(k) > maxK} on:click={() => setKelvin(Number(k))}
								>{name}</button
							>
						{/each}
					</div>
				{:else if canColor}
					<div class="wheel" bind:this={wheelEl} data-exclude-drag-modal></div>
					<div class="swatches">
						{#each swatches as c}
							<button class="swatch" style:background={css(c)} aria-label="Colour {css(c)}" on:click={() => setColor(c)}
							></button>
						{/each}
					</div>
				{/if}

				<!-- scenes -->
				<div class="section">Scenes</div>
				<div class="grid">
					{#each staticModes as m}
						<button class="mode" class:selected={picked === m.id && !running} on:click={() => pick(m)}>
							<span class="tile" style:background={m.swatch}></span>
							<span class="name">{m.name}</span>
						</button>
					{/each}
				</div>

				<!-- effects -->
				{#if !$effectsAvailable}
					<p class="note">Effects need the Home Assistant token on the dashboard server.</p>
				{/if}
				{#each effectGroups as group}
					<div class="section">{group.name}</div>
					<div class="grid">
						{#each dynamicModes.filter((m) => m.group === group.id) as m}
							<button
								class="mode"
								class:selected={running?.mode === m.id}
								disabled={!$effectsAvailable}
								on:click={() => pick(m)}
							>
								<span class="tile" class:playing={running?.mode === m.id} style:background={m.swatch}></span>
								<span class="name">{m.name}</span>
							</button>
						{/each}
					</div>
				{/each}

				<!-- sleep timer -->
				<div class="section">Sleep timer</div>
				<p class="hint">Dims slowly, then switches off.</p>
				<div class="chips">
					{#each [15, 30, 60, 120] as min}
						<button class="chip" disabled={!anyOn || !$effectsAvailable} on:click={() => setSleepTimer($connection, entities, min)}
							>{min < 60 ? `${min} min` : `${min / 60} h`}</button
						>
					{/each}
					{#if timerEnds}
						<button class="chip cancel" on:click={() => cancelSleepTimer($connection, entities)}>Cancel timer</button>
					{/if}
				</div>
			{/if}
		</div>
	</Modal>
{/if}

<style>
	.panel {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		margin-top: 0.6rem;
		color: #ecebe7;
	}

	.power {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		padding: 0.8rem 0.9rem;
		border-radius: 1rem;
		background: rgba(255, 255, 255, 0.05);
	}
	.bulb {
		width: 2.8rem;
		height: 2.8rem;
		border-radius: 50%;
		display: grid;
		place-items: center;
		background: #3a3b40;
		color: #8d8d93;
		flex-shrink: 0;
		transition: background 300ms ease, box-shadow 600ms ease, color 600ms ease;
	}
	.bulb.on {
		background: #f6f4ef;
		color: var(--lamp);
		box-shadow: 0 0 22px -2px var(--lamp);
	}
	.bulb svg {
		width: 1.4rem;
		height: 1.4rem;
		fill: currentColor;
	}
	.status {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		margin-right: auto;
	}
	.state {
		font-size: 1rem;
		font-weight: 500;
	}
	.fx {
		font-size: 0.8rem;
		color: #ffb86b;
	}

	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 0.4rem;
	}
	.label {
		font-size: 0.95rem;
		font-weight: 600;
	}
	.value {
		font-size: 0.9rem;
		color: #a5a5aa;
		font-variant-numeric: tabular-nums;
	}
	.section {
		margin-top: 0.9rem;
		font-size: 0.95rem;
		font-weight: 600;
	}
	.hint {
		display: block;
		margin: 0;
		font-size: 0.8rem;
		color: #a5a5aa;
		font-weight: 400;
	}

	.range {
		-webkit-appearance: none;
		appearance: none;
		width: 100%;
		height: 2.6rem;
		border-radius: 0.9rem;
		margin: 0;
		cursor: pointer;
		outline: none;
	}
	.range.brightness {
		background: linear-gradient(90deg, #1d1e21, var(--lamp));
		transition: background 600ms ease;
	}
	.range.kelvin {
		background: linear-gradient(90deg, #ff9b3d, #ffd9a8 35%, #fff6ec 60%, #cfe2ff);
	}
	.range.speed {
		height: 2rem;
		background: linear-gradient(90deg, #2c2d33, #4b4d55);
	}
	.range::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 1.2rem;
		height: 2.2rem;
		border-radius: 0.6rem;
		background: #ffffff;
		box-shadow: 0 1px 6px rgba(0, 0, 0, 0.5);
		border: 2px solid rgba(0, 0, 0, 0.15);
	}
	.range.speed::-webkit-slider-thumb {
		height: 1.6rem;
	}
	.range::-moz-range-thumb {
		width: 1.2rem;
		height: 2.2rem;
		border-radius: 0.6rem;
		background: #ffffff;
		border: 2px solid rgba(0, 0, 0, 0.15);
	}
	.range:focus-visible {
		outline: 2px solid #ffb86b;
		outline-offset: 2px;
	}

	.effect-box {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0.4rem 0.9rem 0.9rem;
		border-radius: 1rem;
		background: rgba(255, 184, 107, 0.08);
		box-shadow: inset 0 0 0 1px rgba(255, 184, 107, 0.25);
	}
	.sync {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		cursor: pointer;
	}
	.sync > span {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.tabs {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.3rem;
		padding: 0.25rem;
		border-radius: 0.8rem;
		background: rgba(255, 255, 255, 0.06);
		margin-top: 0.4rem;
	}
	.tabs button,
	.chip,
	.stop {
		font: inherit;
		border: 0;
		color: #ecebe7;
		cursor: pointer;
	}
	.tabs button {
		padding: 0.55rem;
		border-radius: 0.6rem;
		background: transparent;
		font-size: 0.9rem;
	}
	.tabs button.selected {
		background: #3a3b40;
		font-weight: 600;
	}

	.chips {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.chip {
		padding: 0.45rem 0.8rem;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.08);
		font-size: 0.82rem;
	}
	.chip:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.chip.cancel {
		background: rgba(255, 90, 90, 0.18);
		color: #ffb3b3;
	}
	.stop {
		align-self: flex-start;
		padding: 0.45rem 0.9rem;
		border-radius: 999px;
		background: #ffb86b;
		color: #26272b;
		font-size: 0.82rem;
		font-weight: 600;
	}
	.note {
		margin: 0.6rem 0 0;
		font-size: 0.82rem;
		color: #a5a5aa;
	}

	.wheel {
		display: flex;
		justify-content: center;
		padding: 0.4rem 0;
	}
	.swatches {
		display: flex;
		justify-content: center;
		gap: 0.55rem;
		flex-wrap: wrap;
	}
	.swatch {
		width: 1.9rem;
		height: 1.9rem;
		border-radius: 50%;
		border: 2px solid rgba(255, 255, 255, 0.18);
		cursor: pointer;
		padding: 0;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.6rem;
	}
	.mode {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4rem;
		padding: 0.55rem 0.2rem 0.5rem;
		border-radius: 0.9rem;
		border: 0;
		background: rgba(255, 255, 255, 0.04);
		color: #ecebe7;
		font: inherit;
		cursor: pointer;
		transition: background 150ms ease;
	}
	.mode:hover {
		background: rgba(255, 255, 255, 0.09);
	}
	.mode:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.mode.selected {
		background: rgba(255, 184, 107, 0.16);
		box-shadow: inset 0 0 0 2px #ffb86b;
	}
	.tile {
		width: 3rem;
		height: 3rem;
		border-radius: 0.8rem;
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
	}
	.tile.playing {
		animation: shimmer 4s linear infinite;
	}
	.name {
		font-size: 0.78rem;
		text-align: center;
		line-height: 1.15;
	}

	@keyframes shimmer {
		to {
			filter: hue-rotate(360deg);
		}
	}

	@media (max-width: 520px) {
		.grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.tile.playing {
			animation: none;
		}
	}
</style>
