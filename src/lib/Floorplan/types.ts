export interface Pin {
	id: number;
	entity_id: string;
	/** position as percent of the plan image */
	x: number;
	y: number;
	room?: string;
	name?: string;
}

export interface Room {
	name: string;
	x: number;
	y: number;
}

export interface Floorplan {
	/** image file inside the data directory */
	image: string;
	pins: Pin[];
	rooms: Room[];
	/** person.* entities shown under "People at home" */
	people: string[];
	/** entity whose temperature is shown; weather.* uses its temperature attribute */
	temperature?: string;
	/** where the Settings button opens Home Assistant; worked out from the page address if unset */
	ha_url?: string;
}
