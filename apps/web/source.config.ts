import type { LLMsOptions } from 'fumadocs-core/mdx-plugins';
import {
	defineConfig,
	defineDocs,
	frontmatterSchema,
} from 'fumadocs-mdx/config';
import { z } from 'zod';

import { DIALECT_LABELS, DIALECTS, dialectList } from './lib/dialects';

type Stringify = NonNullable<LLMsOptions['stringify']>;

const attribute = (node: Parameters<Stringify>[0], name: string) => {
	if (node.type !== 'mdxJsxFlowElement' && node.type !== 'mdxJsxTextElement')
		return;
	for (const attr of node.attributes)
		if (attr.type === 'mdxJsxAttribute' && attr.name === name)
			return typeof attr.value === 'string' ? attr.value : undefined;
};

/**
 * Turns the site's MDX components into plain Markdown for the `.md` pages and
 * `llms.txt` files, so agents never see JSX.
 */
const stringify: Stringify = (node, _parent, state, info) => {
	if (node.type !== 'mdxJsxFlowElement' && node.type !== 'mdxJsxTextElement')
		return;
	const children = () =>
		node.type === 'mdxJsxTextElement'
			? state.containerPhrasing(node, info)
			: state.containerFlow(node, info);

	switch (node.name) {
		case 'Since':
			return `(Added in ${attribute(node, 'version')})`;
		case 'Dialect': {
			const labels = dialectList(attribute(node, 'only') ?? '').map(
				(dialect) => DIALECT_LABELS[dialect],
			);
			return `**${labels.join(', ')} only:**\n\n${children()}`;
		}
		case 'Tab':
		case 'TabsContent':
		case 'CodeBlockTab': {
			const value = attribute(node, 'value');
			return value ? `**${value}**\n\n${children()}` : children();
		}
		case 'Callout': {
			const title =
				attribute(node, 'title') ??
				(attribute(node, 'type') === 'warn' ? 'Warning' : 'Note');
			const body = `**${title}:** ${children()}`;
			return body
				.split('\n')
				.map((line) => (line ? `> ${line}` : '>'))
				.join('\n');
		}
		case 'Card': {
			const title = attribute(node, 'title') ?? '';
			const href = attribute(node, 'href');
			const text = children().trim();
			const link = href ? `[${title}](${href})` : title;
			return text ? `- ${link}: ${text}` : `- ${link}`;
		}
		case 'Accordion':
			return `**${attribute(node, 'title') ?? ''}**\n\n${children()}`;
		case 'TypeTable': {
			for (const attr of node.attributes)
				if (
					attr.type === 'mdxJsxAttribute' &&
					attr.name === 'type' &&
					attr.value &&
					typeof attr.value !== 'string'
				)
					return `\`\`\`js\n${attr.value.value}\n\`\`\``;
			return;
		}
		case 'CopyPrompt':
		case 'TabsList':
		case 'TabsTrigger':
		case 'CodeBlockTabsList':
		case 'CodeBlockTabsTrigger':
			node.data = { ...node.data, _stringify: { text: '' } };
			return;
		default:
			return children() || undefined;
	}
};

export const docs = defineDocs({
	dir: 'content/docs',
	docs: {
		// Compile each page on request instead of every page up front.
		async: true,
		postprocess: {
			includeProcessedMarkdown: { headingIds: false, stringify },
		},
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
