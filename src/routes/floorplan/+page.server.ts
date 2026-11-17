import { readFile } from 'fs/promises';
import { dev } from '$app/environment';
import yaml from 'js-yaml';
import type { Configuration } from '$lib/Types';
import type { Floorplan } from '$lib/Floorplan/types';

async function loadYaml(file: string) {
	try {
		return (yaml.load(await readFile(file, 'utf8')) as any) || {};
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
			console.error(`Error reading ${file}:`, error);
		}
		return {};
	}
}

export async function load({ request }): Promise<{
	configuration: Configuration;
	floorplan: Floorplan;
	theme: any;
	translations: any;
}> {
	const dir = dev ? './static' : './build/client';
	const [configuration, floorplan, dashboard, en] = await Promise.all([
		loadYaml('./data/configuration.yaml'),
		loadYaml('./data/floorplan.yaml'),
		loadYaml('./data/dashboard.yaml'),
		readFile(`${dir}/translations/en.json`, 'utf8').then(JSON.parse).catch(() => ({}))
	]);
	const theme = await loadYaml(`${dir}/themes/${dashboard.theme || 'godis'}.yaml`);

	configuration.hassUrl = process.env.HASS_URL || request.headers.get('X-Proxy-Target');

	floorplan.image = floorplan.image || 'floorplan.svg';
	floorplan.pins = floorplan.pins || [];
	floorplan.rooms = floorplan.rooms || [];
	floorplan.people = floorplan.people || [];

	return { configuration, floorplan, theme, translations: en };
}
