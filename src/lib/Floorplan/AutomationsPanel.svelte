<script lang="ts">
	/**
	 * Automations: auto brightness through the day, and movie mode for the living-room TV.
	 * Settings save as you change them; the server runs both (src/lib/server/automations.ts).
	 */
	import Modal from '$lib/Modal/Index.svelte';
	import Toggle from '$lib/Components/Toggle.svelte';
	import { states } from '$lib/Stores';
	import { base } from '$app/paths';
	import { onDestroy, onMount } from 'svelte';

	export let isOpen: boolean;

	type Point = { time: string; pct: number; kelvin: number };
	let settings: any;
	let status: any;
	let error = '';

	async function api(body?: Record<string, unknown>) {
		try {
			const res = await fetch(`${base}/_api/automations`, {
				method: body ? 'POST' : 'GET',
				headers: { 'Content-Type': 'application/json' },
				...(body ? { body: JSON.stringify(body) } : {})
			});
			if (!res.ok) throw new Error(await res.text());
			const data = await res.json();
			settings = settings && body?.action !== 'save' ? settings : data.settings;
			status = data.status;
			error = '';
		} catch (e) {
			error = 'Could not reach the automations. Check that you are signed in.';
			console.error(e);
		}
	}

	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	function save() {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => api({ action: 'save', settings }), 500);
	}

	let poll: ReturnType<typeof setInterval>;
	onMount(() => {
		api();
		poll = setInterval(() => api(), 5000);
	});
	onDestroy(() => {
		clearInterval(poll);
		clearTimeout(saveTimer);
	});

	const name = (id: string) => $states?.[id]?.attributes?.friendly_name || id;

	/* ---------- brightness chart ---------- */
	const W = 560;
	const H = 150;
	const PAD = { l: 42, r: 22, t: 12, b: 22 };
	const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
	const x = (m: number) => PAD.l + (m / 1440) * (W - PAD.l - PAD.r);
	const y = (pct: number) => PAD.t + (1 - pct / 100) * (H - PAD.t - PAD.b);

	$: curve = (status?.curve || []) as Point[];
	$: line = curve.map((p, i) => `${i ? 'L' : 'M'}${x(i * 30).toFixed(1)} ${y(p.pct).toFixed(1)}`).join(' ');
	$: area = curve.length ? `${line} L${x(1440)} ${y(0)} L${x(0)} ${y(0)} Z` : '';
	$: nowMin = status ? toMin(status.now) : 0;
	$: sunUp = status ? toMin(status.sunrise) : 0;
	$: sunDown = status ? toMin(status.sunset) : 0;

	let hover: { m: number; pct: number; kelvin: number } | null = null;
	function onMove(e: PointerEvent) {
		const svg = e.currentTarget as SVGSVGElement;
		const r = svg.getBoundingClientRect();
		const m = Math.max(0, Math.min(1440, (((e.clientX - r.left) / r.width) * W - PAD.l) / (W - PAD.l - PAD.r) * 1440));
		const i = Math.min(curve.length - 1, Math.round(m / 30));
		if (curve[i]) hover = { m: i * 30, pct: curve[i].pct, kelvin: curve[i].kelvin };
	}
	const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

	const levels = [
		['morning', 'After wake-up', 'until there is daylight'],
		['day', 'Daylight', 'the sun lights the rooms'],
		['evening', 'Evening', 'after sunset'],
		['bedtimeLevel', 'At bedtime', 'dims in the two hours before'],
		['night', 'Night', 'from an hour after bedtime']
	];

	/* ---------- movie mode ---------- */
	$: tv = status?.movie?.tv;
	$: movieState = status?.movie?.state;
	$: tvLine = !tv?.online
		? 'TV is off or not reachable'
		: tv.playback === 'playing' || tv.playback === 'paused'
			? `${tv.playback === 'playing' ? 'Playing' : 'Paused'}${tv.title ? `: ${tv.title}` : ''}${tv.playbox ? ' in PlayBox' : ''}`
			: tv.playbox
				? 'PlayBox is open, nothing playing'
				: 'TV is on, nothing playing';
</script>

{#if isOpen}
	<Modal>
		<span slot="title">Automations</span>

		{#if error}
			<p class="error">{error}</p>
		{/if}

		{#if settings && status}
			<div class="panel">
				<!-- auto brightness -->
				<section>
					<div class="head">
						<div>
							<h3>Auto brightness</h3>
							<p class="hint">Low while there is daylight, bright in the evening, dimmer towards bedtime.</p>
						</div>
						<Toggle bind:checked={settings.adaptive.enabled} on:change={save} />
					</div>

					<div class="facts">
						<span>Sunrise <b>{status.sunrise}</b></span>
						<span>Sunset <b>{status.sunset}</b></span>
						<span>Now <b>{status.target.pct}%</b>{settings.adaptive.warmth ? ` · ${status.target.kelvin} K` : ''}</span>
					</div>

					<!-- today's curve -->
					<div class="chart">
						<svg
							viewBox="0 0 {W} {H}"
							role="img"
							aria-label="Brightness through the day, from {status.curve[0]?.pct}% at midnight; now {status.target.pct}%"
							on:pointermove={onMove}
							on:pointerleave={() => (hover = null)}
						>
							<!-- daylight band -->
							<rect x={x(sunUp)} y={PAD.t} width={Math.max(0, x(sunDown) - x(sunUp))} height={H - PAD.t - PAD.b} class="daylight" />
							<!-- grid -->
							{#each [0, 50, 100] as g}
								<line x1={PAD.l} x2={W - PAD.r} y1={y(g)} y2={y(g)} class="grid" />
								<text x={PAD.l - 6} y={y(g) + 4} class="tick" text-anchor="end">{g}%</text>
							{/each}
							{#each [0, 6, 12, 18, 24] as h}
								<text x={x(h * 60)} y={H - 6} class="tick" text-anchor="middle">{String(h).padStart(2, '0')}:00</text>
							{/each}
							<path d={area} class="area" />
							<path d={line} class="line" />
							<!-- now -->
							<line x1={x(nowMin)} x2={x(nowMin)} y1={PAD.t} y2={H - PAD.b} class="now" />
							<circle cx={x(nowMin)} cy={y(status.target.pct)} r="4.5" class="dot" />
							{#if hover}
								<line x1={x(hover.m)} x2={x(hover.m)} y1={PAD.t} y2={H - PAD.b} class="cross" />
								<circle cx={x(hover.m)} cy={y(hover.pct)} r="4" class="dot hover" />
							{/if}
						</svg>
						{#if hover}
							<div class="tip" style:left="{(x(hover.m) / W) * 100}%">
								<b>{hhmm(hover.m)}</b> · {hover.pct}%{settings.adaptive.warmth ? ` · ${hover.kelvin} K` : ''}
							</div>
						{/if}
					</div>

					<div class="times">
						<label>
							<span>Wake-up</span>
							<input type="time" bind:value={settings.adaptive.wake} on:change={save} />
						</label>
						<label>
							<span>Bedtime</span>
							<input type="time" bind:value={settings.adaptive.bedtime} on:change={save} />
						</label>
					</div>

					{#each levels as [key, label, hint]}
						<div class="level">
							<div class="row">
								<span class="label">{label} <span class="hint inline">{hint}</span></span>
								<span class="value">{settings.adaptive[key]}%</span>
							</div>
							<input type="range" min="1" max="100" bind:value={settings.adaptive[key]} on:change={save} aria-label="{label} brightness" />
						</div>
					{/each}

					<label class="switch-row">
						<span>
							<span class="label">Warmer light in the evening</span>
							<span class="hint">White bulbs go from daylight white to candle warm towards bedtime.</span>
						</span>
						<Toggle bind:checked={settings.adaptive.warmth} on:change={save} />
					</label>

					{#if status.manual.length}
						<div class="paused">
							<span class="hint">Set by hand, so auto brightness leaves them until they are switched off:</span>
							{#each status.manual as id}
								<span class="chip">
									{name(id)}
									<button on:click={() => api({ action: 'resume', entities: [id] })}>Back to auto</button>
								</span>
							{/each}
						</div>
					{/if}
				</section>

				<!-- movie mode -->
				<section>
					<div class="head">
						<div>
							<h3>Movie mode</h3>
							<p class="hint">When a film plays on the living-room TV, the lights that are on go to the Movie scene and come back when it ends.</p>
						</div>
						<Toggle bind:checked={settings.movie.enabled} on:change={save} />
					</div>

					<div class="tv" class:playing={movieState === 'playing'}>
						<span class="tv-dot" class:on={tv?.online}></span>
						<span>{tvLine}</span>
						{#if movieState !== 'idle'}
							<span class="chip active">Movie mode {movieState === 'paused' ? 'paused' : 'on'}</span>
						{/if}
					</div>

					<div class="segmented">
						<button class:selected={settings.movie.source === 'playbox'} on:click={() => ((settings.movie.source = 'playbox'), save())}
							>PlayBox films and episodes</button
						>
						<button class:selected={settings.movie.source === 'any'} on:click={() => ((settings.movie.source = 'any'), save())}
							>Any video on the TV</button
						>
					</div>

					<div class="level">
						<div class="row">
							<span class="label">Light during the film</span>
							<span class="value">{settings.movie.level}%</span>
						</div>
						<input type="range" min="1" max="60" bind:value={settings.movie.level} on:change={save} aria-label="Movie brightness" />
					</div>

					<div class="row">
						<span class="label">When the film is paused</span>
					</div>
					<div class="segmented">
						<button class:selected={settings.movie.pause === 'soft'} on:click={() => ((settings.movie.pause = 'soft'), save())}
							>Soft warm light</button
						>
						<button class:selected={settings.movie.pause === 'keep'} on:click={() => ((settings.movie.pause = 'keep'), save())}
							>Keep the Movie light</button
						>
					</div>

					<div class="row try">
						<span class="hint">Try it without a film:</span>
						<span class="buttons">
							<button class="chip" on:click={() => api({ action: 'test_movie', state: 'playing' })}>Play</button>
							<button class="chip" on:click={() => api({ action: 'test_movie', state: 'paused' })}>Pause</button>
							<button class="chip" on:click={() => api({ action: 'test_movie', state: 'idle' })}>Stop</button>
							{#if status.movie.test}
								<button class="chip" on:click={() => api({ action: 'test_movie', state: null })}>Follow the TV again</button>
							{/if}
						</span>
					</div>
				</section>
			</div>
		{:else if !error}
			<p class="hint">Loading…</p>
		{/if}
	</Modal>
{/if}

<style>
	.panel {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin-top: 0.6rem;
		color: #ecebe7;
	}
	section {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		padding: 1rem;
		border-radius: 1.1rem;
		background: rgba(255, 255, 255, 0.04);
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
	}
	.head :global(label.switch),
	.switch-row :global(label.switch) {
		flex-shrink: 0;
	}
	h3 {
		margin: 0 0 0.2rem;
		font-size: 1.1rem;
		font-weight: 600;
	}
	.hint {
		display: block;
		margin: 0;
		font-size: 0.82rem;
		color: #a5a5aa;
		font-weight: 400;
	}
	.hint.inline {
		display: inline;
		margin-left: 0.3rem;
	}
	.error {
		color: #ffb3b3;
	}
	.facts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 1.2rem;
		font-size: 0.88rem;
		color: #c9c8c4;
	}
	.facts b {
		color: #f3f1ec;
		font-variant-numeric: tabular-nums;
	}

	.chart {
		position: relative;
	}
	.chart svg {
		display: block;
		width: 100%;
		height: auto;
		touch-action: pan-y;
	}
	.daylight {
		fill: rgba(255, 214, 120, 0.07);
	}
	.grid {
		stroke: rgba(255, 255, 255, 0.07);
		stroke-width: 1;
	}
	.tick {
		fill: #8d8d93;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	.area {
		fill: rgba(255, 184, 107, 0.14);
	}
	.line {
		fill: none;
		stroke: #ffb86b;
		stroke-width: 2;
		stroke-linejoin: round;
	}
	.now {
		stroke: rgba(255, 255, 255, 0.35);
		stroke-dasharray: 3 3;
	}
	.cross {
		stroke: rgba(255, 255, 255, 0.25);
	}
	.dot {
		fill: #ffb86b;
		stroke: #26272b;
		stroke-width: 2;
	}
	.dot.hover {
		fill: #f3f1ec;
	}
	.tip {
		position: absolute;
		top: -0.4rem;
		transform: translateX(-50%);
		padding: 0.25rem 0.55rem;
		border-radius: 0.5rem;
		background: #111214;
		color: #ecebe7;
		font-size: 0.78rem;
		white-space: nowrap;
		pointer-events: none;
		font-variant-numeric: tabular-nums;
	}

	.times {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.6rem;
	}
	.times label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.85rem;
		color: #a5a5aa;
	}
	input[type='time'] {
		font: inherit;
		font-size: 1rem;
		padding: 0.55rem 0.7rem;
		border-radius: 0.7rem;
		border: 1px solid rgba(255, 255, 255, 0.1);
		background: #2c2d32;
		color: #f3f1ec;
		color-scheme: dark;
	}
	.level {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.6rem;
	}
	.label {
		font-size: 0.92rem;
		font-weight: 600;
	}
	.value {
		font-size: 0.88rem;
		color: #a5a5aa;
		font-variant-numeric: tabular-nums;
	}
	input[type='range'] {
		width: 100%;
		accent-color: #ffb86b;
	}
	.switch-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
	}
	.switch-row > span {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.paused {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.75rem;
		border: 0;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.08);
		color: #ecebe7;
		font: inherit;
		font-size: 0.82rem;
	}
	button.chip {
		cursor: pointer;
	}
	.chip button {
		border: 0;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: #ffb86b;
		color: #26272b;
		font: inherit;
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
	}
	.chip.active {
		background: rgba(255, 184, 107, 0.18);
		color: #ffcf9a;
		margin-left: auto;
	}

	.tv {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.7rem 0.8rem;
		border-radius: 0.8rem;
		background: rgba(255, 255, 255, 0.05);
		font-size: 0.9rem;
	}
	.tv-dot {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
		background: #6f6f75;
		flex: none;
	}
	.tv-dot.on {
		background: #5bd07d;
	}
	.segmented {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.3rem;
		padding: 0.25rem;
		border-radius: 0.8rem;
		background: rgba(255, 255, 255, 0.06);
	}
	.segmented button {
		padding: 0.55rem 0.4rem;
		border: 0;
		border-radius: 0.6rem;
		background: transparent;
		color: #ecebe7;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.segmented button.selected {
		background: #f3f1ec;
		color: #1d1e21;
		font-weight: 600;
	}
	.try {
		flex-wrap: wrap;
	}
	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
</style>
