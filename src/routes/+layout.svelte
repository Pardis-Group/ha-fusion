<script lang="ts">
	import { motion, connection } from '$lib/Stores';
	import { fade } from 'svelte/transition';
	import { Modals, closeModal } from 'svelte-modals';
	import Loader from '$lib/Components/Loader.svelte';
	import '@fontsource-variable/inter';
	import { expoOut } from 'svelte/easing';
	import { browser } from '$app/environment';
	import { get } from 'svelte/store';

	/**
	 * The dashboard's own /_api endpoints need the user's Home Assistant token
	 * (see hooks.server.ts). Add it to every same-origin /_api request.
	 */
	if (browser && !(window as any).__fusionAuthFetch) {
		(window as any).__fusionAuthFetch = true;
		const original = window.fetch.bind(window);
		window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
			const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
			if (url.origin === location.origin && url.pathname.includes('/_api/')) {
				const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
				const auth: any = (get(connection) as any)?.options?.auth;
				if (auth && !headers.has('Authorization')) {
					try {
						if (auth.expired) await auth.refreshAccessToken();
						headers.set('Authorization', `Bearer ${auth.accessToken}`);
					} catch {
						/* not signed in yet: the request goes without a token */
					}
				}
				init = { ...init, headers };
			}
			return original(input, init);
		};
	}
</script>

<svelte:head>
	<title>FUSION</title>
	<meta name="description" content="fusion" />
	<meta charset="utf-8" />
</svelte:head>

<Modals>
	<div
		slot="backdrop"
		class="backdrop"
		on:click={() => {
			closeModal();
		}}
		in:fade={{
			duration: $motion,
			easing: expoOut
		}}
		out:fade={{ duration: $motion / 2 }}
		on:keydown
		role="button"
		tabindex="0"
	></div>

	<div slot="loading">
		<Loader />
	</div>
</Modals>

<slot />

<style>
	:global(body, html) {
		margin: 0;
		padding: 0;
		-webkit-tap-highlight-color: transparent;
		box-sizing: border-box;
	}

	:global(html) {
		background-color: var(--theme-colors-background, initial);
		color: var(--theme-colors-text, initial);
		font-size: 100%;
	}

	:global(body) {
		background: black;
		font-family: var(--theme-font-family);
		user-select: none;
		-webkit-user-select: none;
		background-size: cover;
		background-repeat: no-repeat;
		background-attachment: fixed;
		transition: background-image 100ms ease;
	}

	:global(*, *::before, *::after, *:focus) {
		box-sizing: inherit;
	}

	.backdrop {
		position: fixed;
		top: 0;
		bottom: 0;
		right: 0;
		left: 0;
		z-index: 2;
		background-size: cover;
		background-repeat: no-repeat;
		background-attachment: fixed;
		transition: opacity 100ms ease-out;
	}
</style>
