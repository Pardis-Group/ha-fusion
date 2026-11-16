import { writeFile } from 'fs/promises';
import { json, error } from '@sveltejs/kit';
import yaml from 'js-yaml';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	try {
		await writeFile('./data/floorplan.yaml', yaml.dump(body));
		return json({ message: 'saved' });
	} catch (err: any) {
		error(500, err.message);
	}
};
