import { better } from 'better-drizzle';
import { ata } from 'better-drizzle/ata';
import { type CacheStore, cache } from 'better-drizzle/cache';
import { softDelete } from 'better-drizzle/soft-delete';
import { tenant } from 'better-drizzle/tenant';
import { timestamps } from 'better-drizzle/timestamps';
import { zod } from 'better-drizzle/zod';
import { drizzle } from 'drizzle-orm/node-postgres';

import { relations } from './relations';

export const db = drizzle(process.env.DATABASE_URL ?? '', { relations });

// Every official plugin, so snippets from any plugin page see its API.
export const client = better(db, {
	plugins: [
		timestamps(),
		softDelete(),
		cache({ store: {} as CacheStore, ttl: '5m' }),
		tenant({
			columns: ['organizationId', 'workspaceId'],
			missing: 'allow',
		}),
		zod(),
		ata(),
	],
});
