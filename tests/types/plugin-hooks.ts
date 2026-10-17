// Type-level assertions; checked by `bunx tsc --noEmit`, never executed.
import { definePlugin } from 'better-drizzle/plugins';

const seen: unknown[] = [];

// Side-effect-only before hooks return nothing.
void definePlugin({
	id: 'observe',
	hooks: {
		beforeCreate(context) {
			seen.push(context.args);
		},
		async beforeUpdate(context) {
			seen.push(context.args);
		},
	},
});

// Returning data still has to match the operation payload.
void definePlugin({
	id: 'replace',
	hooks: {
		// @ts-expect-error a number is not a create payload
		beforeCreate: () => 1,
	},
});
