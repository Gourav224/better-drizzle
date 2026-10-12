import { randomFillSync, randomUUID } from 'node:crypto';

const HEX: string[] = [];
for (let byte = 0; byte < 256; byte += 1)
	HEX.push(byte.toString(16).padStart(2, '0'));

const COUNTER_MAX = 2 ** 42 - 1;
const pool = new Uint8Array(4096);
let offset = pool.length;
let lastMs = -1;
let counter = 0;

const take = (size: number) => {
	if (offset + size > pool.length) {
		randomFillSync(pool);
		offset = 0;
	}

	const start = offset;
	offset += size;
	return start;
};

// A fresh millisecond seeds the counter with 41 random bits; the top bit stays
// clear so the counter has room to grow before it borrows the next millisecond.
const seed = () => {
	const at = take(6);
	counter =
		(((pool[at] & 0x01) << 16) | (pool[at + 1] << 8) | pool[at + 2]) *
			2 ** 24 +
		((pool[at + 3] << 16) | (pool[at + 4] << 8) | pool[at + 5]);
};

/**
 * Generates a UUIDv7 (RFC 9562): a 48-bit Unix millisecond timestamp, a 42-bit
 * counter seeded randomly every millisecond, and 32 random bits. Values from
 * one process sort in creation order, including several in the same
 * millisecond or after the clock moves backwards.
 *
 * @returns A lowercase, hyphenated UUIDv7 string.
 */
export const uuidv7 = () => {
	const now = Date.now();

	if (now > lastMs) {
		lastMs = now;
		seed();
	} else if (counter < COUNTER_MAX) counter += 1;
	else {
		lastMs += 1;
		seed();
	}

	const ms = lastMs;
	const high = Math.floor(counter / 2 ** 24);
	const low = counter % 2 ** 24;
	const at = take(4);
	const msHigh = Math.floor(ms / 2 ** 16);
	const msLow = ms % 2 ** 16;

	return (
		HEX[(msHigh >>> 24) & 0xff] +
		HEX[(msHigh >>> 16) & 0xff] +
		HEX[(msHigh >>> 8) & 0xff] +
		HEX[msHigh & 0xff] +
		'-' +
		HEX[msLow >>> 8] +
		HEX[msLow & 0xff] +
		'-' +
		HEX[0x70 | (high >>> 14)] +
		HEX[(high >>> 6) & 0xff] +
		'-' +
		HEX[0x80 | (high & 0x3f)] +
		HEX[low >>> 16] +
		'-' +
		HEX[(low >>> 8) & 0xff] +
		HEX[low & 0xff] +
		HEX[pool[at]] +
		HEX[pool[at + 1]] +
		HEX[pool[at + 2]] +
		HEX[pool[at + 3]]
	);
};

/**
 * Generates a random UUIDv4 through `crypto.randomUUID()`.
 *
 * @returns A lowercase, hyphenated UUIDv4 string.
 */
export const uuidv4 = () => randomUUID();
