// Type-level assertions; checked by `bunx tsc --noEmit`, never executed.
import { createDb } from '../core/order-by-relations.fixture';

declare const db: ReturnType<typeof createDb>;

db.posts.findMany({
	orderBy: [
		{
			author: {
				profile: { bio: { direction: 'desc', nulls: 'last' } },
			},
		},
		{ author: { posts: { count: 'asc' } } },
		{ id: 'asc' },
	],
});
db.authors.findMany({ orderBy: { posts: { count: 'desc' } } });
db.posts.findMany({ orderBy: { tags: { count: 'asc' } } });
db.authors.findMany({
	include: { posts: { orderBy: { author: { name: 'asc' } } } },
});
// @ts-expect-error To-many relations sort by count only.
db.authors.findMany({ orderBy: { posts: { title: 'asc' } } });
// @ts-expect-error One relations take a field map, not count.
db.posts.findMany({ orderBy: { author: { count: 'asc' } } });
// @ts-expect-error Unknown orderBy keys are rejected.
db.posts.findMany({ orderBy: { writer: { name: 'asc' } } });
