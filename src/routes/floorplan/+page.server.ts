import { readFile } from 'fs/promises';
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

export async function load({ request }): Promise<{ configuration: Configuration; floorplan: Floorplan }> {
	const [configuration, floorplan] = await Promise.all([
		loadYaml('./data/configuration.yaml'),
		loadYaml('./data/floorplan.yaml')
	]);

	configuration.hassUrl = process.env.HASS_URL || request.headers.get('X-Proxy-Target');

	floorplan.image = floorplan.image || 'floorplan.svg';
	floorplan.pins = floorplan.pins || [];
	floorplan.rooms = floorplan.rooms || [];
	floorplan.people = floorplan.people || [];

	return { configuration, floorplan };
}
