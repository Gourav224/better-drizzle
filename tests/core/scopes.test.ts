import type { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';

import { type ScopeEvent, createScopeDb } from './scopes.fixture';

let sqlite: Database | undefined;

const setup = (options?: Parameters<typeof createScopeDb>[0]) => {
	const created = createScopeDb(options);
	sqlite = created.sqlite;
	return created;
};

afterEach(() => {
	sqlite?.close();
	sqlite = undefined;
});

const EU = { region: 'eu' };
const EU_SCOPES = { region: EU };

describe('model scope propagation', () => {
	test('scoped clients carry the state; the original client stays unscoped', () => {
		const { db, eu } = setup();

		expect(db.$region).toBeUndefined();
		expect(eu.$region).toEqual(EU);
		expect(eu.$inRegion('us').$region).toEqual({ region: 'us' });
		expect(eu.$region).toEqual(EU);
	});

	test('$withContext keeps the scope', () => {
		const { eu } = setup();

		expect(eu.$withContext({ requestId: 'r1' }).$region).toEqual(EU);
	});

	test('transactions and nested savepoints keep the scope', async () => {
		const events: ScopeEvent[] = [];
		const { eu } = setup({ events });

		const seen = await eu.transaction(async (tx) => {
			await tx.users.findMany();
			const nested = await tx.transaction(async (inner) => {
				await inner.users.findMany();
				return inner.$region;
			});
			return [tx.$region, nested];
		});

		expect(seen).toEqual([EU, EU]);
		expect(events.filter((event) => event.hook === 'beforeQuery')).toEqual([
			{ hook: 'beforeQuery', scopes: EU_SCOPES },
			{ hook: 'beforeQuery', scopes: EU_SCOPES },
		]);
	});

	test('implicit relation-write transactions keep the scope', async () => {
		const events: ScopeEvent[] = [];
		const { eu } = setup({ events });

		await eu.posts.create({
			data: {
				author: { connect: { id: 1 } },
				id: 10,
				region: 'eu',
				title: 'connected',
			},
		});

		expect(events.filter((event) => event.hook === 'beforeCreate')).toEqual(
			[{ hook: 'beforeCreate', inTransaction: true, scopes: EU_SCOPES }],
		);
	});

	test('extends() survives derived clients and keeps the scope', () => {
		const { eu } = setup();
		const extended = eu.extends({ tag: 'extended' });
		const derived = extended.$withContext({ requestId: 'r1' });

		expect(derived.tag).toBe('extended');
		expect(derived.$region).toEqual(EU);
	});

	test('plugin hooks, transforms, and intercepts see ctx.scopes', async () => {
		const events: ScopeEvent[] = [];
		const { db, eu } = setup({ events });

		await eu.users.findMany();
		await db.notes.findMany();

		expect(events).toEqual([
			{ hook: 'beforeQuery', scopes: EU_SCOPES },
			{ hook: 'transform', scopes: EU_SCOPES },
			{ hook: 'intercept', scopes: EU_SCOPES },
			{ hook: 'beforeQuery', scopes: {} },
			{ hook: 'transform', scopes: {} },
			{ hook: 'intercept', scopes: {} },
		]);
	});

	test('$withoutPlugins() drops the scope and reports bypass meta', async () => {
		const metas: unknown[] = [];
		const { db, eu } = setup({
			hooks: { beforeQuery: (context) => void metas.push(context.meta) },
		});

		await eu.users.$withoutPlugins().findMany();
		await eu.users.$withoutPlugins({ keepScopes: true }).findMany();
		await db.users.$withoutPlugins().findMany();

		expect(metas).toEqual([
			{ regionBypass: '$withoutPlugins' },
			undefined,
			undefined,
		]);
	});

	test('$withoutPlugins() relation writes keep dropping the scope', async () => {
		const metas: unknown[] = [];
		const events: ScopeEvent[] = [];
		const { eu } = setup({
			events,
			hooks: { beforeCreate: (context) => void metas.push(context.meta) },
		});

		await eu.posts.$withoutPlugins().create({
			data: {
				author: { connect: { id: 2 } },
				id: 11,
				region: 'us',
				title: 'bypassed',
			},
		});

		expect(metas).toEqual([{ regionBypass: '$withoutPlugins' }]);
		expect(events).toEqual([]);
	});
});
