import { defineRelations } from 'drizzle-orm';

import * as schema from './schema';

export const relations = defineRelations(schema, (r) => ({
	users: {
		posts: r.many.posts(),
		comments: r.many.comments(),
		profile: r.one.profiles({ from: r.users.id, to: r.profiles.userId }),
		accounts: r.many.accounts(),
		orders: r.many.orders(),
		groups: r.many.groups({
			from: r.users.id.through(r.memberships.userId),
			to: r.groups.id.through(r.memberships.groupId),
		}),
	},
	profiles: {
		user: r.one.users({ from: r.profiles.userId, to: r.users.id }),
	},
	posts: {
		author: r.one.users({ from: r.posts.authorId, to: r.users.id }),
		comments: r.many.comments(),
		// `tags` is the text[] column used by the array examples.
		labels: r.many.tags({
			from: r.posts.id.through(r.postTags.postId),
			to: r.tags.id.through(r.postTags.tagId),
		}),
	},
	comments: {
		post: r.one.posts({ from: r.comments.postId, to: r.posts.id }),
		author: r.one.users({ from: r.comments.authorId, to: r.users.id }),
	},
	tags: {
		posts: r.many.posts({
			from: r.tags.id.through(r.postTags.tagId),
			to: r.posts.id.through(r.postTags.postId),
		}),
	},
	postTags: {},
	groups: {
		users: r.many.users({
			from: r.groups.id.through(r.memberships.groupId),
			to: r.users.id.through(r.memberships.userId),
		}),
	},
	memberships: {},
	accounts: {
		user: r.one.users({ from: r.accounts.userId, to: r.users.id }),
	},
	orders: {
		user: r.one.users({ from: r.orders.userId, to: r.users.id }),
	},
	jobs: {},
	organizations: {
		projects: r.many.projects(),
	},
	projects: {
		organization: r.one.organizations({
			from: r.projects.organizationId,
			to: r.organizations.id,
		}),
	},
}));
