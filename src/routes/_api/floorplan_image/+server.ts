import { readFile } from 'fs/promises';
import { basename, extname } from 'path';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const types: Record<string, string> = {
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif'
};

/** Serves an image from the data directory, e.g. /_api/floorplan_image?f=floorplan.png */
export const GET: RequestHandler = async ({ url }) => {
	const file = basename(url.searchParams.get('f') || 'floorplan.svg');
	const type = types[extname(file).toLowerCase()];
	if (!type) error(400, 'unsupported image type');
	try {
		const data = await readFile(`./data/${file}`);
		return new Response(data, { headers: { 'Content-Type': type, 'Cache-Control': 'no-cache' } });
	} catch {
		error(404, `${file} not found in data directory`);
	}
};
