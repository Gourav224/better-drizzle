import {
	defineConfig,
	defineDocs,
	frontmatterSchema,
} from 'fumadocs-mdx/config';
import { z } from 'zod';

import { DIALECTS } from './lib/dialects';

export const docs = defineDocs({
	dir: 'content/docs',
	docs: {
		// Compile each page on request instead of every page up front.
		async: true,
		schema: frontmatterSchema.extend({
			seoTitle: z.string().optional(),
			seoDescription: z.string().optional(),
			// Databases the page applies to; omit when it applies to all.
			dialects: z.array(z.enum(DIALECTS)).optional(),
		}),
	},
});

export default defineConfig({
	mdxOptions: {
		rehypeCodeOptions: {
			// The default JS regex engine mis-colors the first line of the first
			// dual-theme block it highlights (every light token turns keyword red).
			engine: 'oniguruma',
			themes: {
				light: 'github-light',
				dark: 'github-dark',
			},
		},
	},
});
