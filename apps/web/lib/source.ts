import { docs } from 'collections/server';
import type { Node } from 'fumadocs-core/page-tree';
import { loader } from 'fumadocs-core/source';
import { icons } from 'lucide-react';
import { createElement } from 'react';

import { SITE_URL } from '@/lib/seo';

export const source = loader({
	baseUrl: '/docs',
	source: docs.toFumadocsSource(),
	plugins: [
		{
			name: 'dialects',
			// Marks database-specific pages so CSS can hide them in the sidebar.
			transformPageTree: {
				file(node, filePath) {
					if (!filePath) return node;
					const file = this.storage.read(filePath);
					if (file?.format !== 'page') return node;
					const { dialects } = file.data as { dialects?: string[] };
					if (dialects)
						node.name = createElement(
							'span',
							{
								key: 'name',
								'data-dialect-page': dialects.join(' '),
							},
							node.name,
						);
					return node;
				},
			},
		},
	],
	icon(icon) {
		if (!icon) return;
		if (icon in icons)
			return createElement(icons[icon as keyof typeof icons]);
	},
});

export type DocsPage = NonNullable<ReturnType<typeof source.getPage>>;

/** `/docs/querying/reads` -> `/docs/querying/reads.md` */
export const markdownUrl = (url: string) => `${url}.md`;

/** A docs page as plain Markdown, for `.md` URLs and `llms-full.txt`. */
export async function getPageMarkdown(page: DocsPage) {
	const body = await page.data.getText('processed');
	const description = page.data.description
		? `> ${page.data.description}\n\n`
		: '';
	const dialects = (page.data as { dialects?: string[] }).dialects;
	const scope = dialects ? `Applies to: ${dialects.join(', ')}\n\n` : '';

	return `# ${page.data.title}\n\n${description}URL: ${SITE_URL}${page.url}\n\n${scope}${body.trim()}\n`;
}

export type DocsSection = { title?: string; pages: DocsPage[] };

/**
 * Docs pages grouped like the sidebar: one section per `---Step---` separator
 * or folder, in `meta.json` order.
 */
export function getDocsSections() {
	const sections: DocsSection[] = [{ pages: [] }];
	const add = (url: string) => {
		const page = source.getPage(url.split('/').slice(2));
		if (page) sections.at(-1)?.pages.push(page);
	};
	const walk = (nodes: Node[]) => {
		for (const node of nodes) {
			if (node.type === 'separator') {
				sections.push({
					title:
						typeof node.name === 'string' ? node.name : undefined,
					pages: [],
				});
				continue;
			}
			if (node.type === 'page') {
				add(node.url);
				continue;
			}
			// Folders get their own section, then the outer one continues.
			const outer = sections.at(-1)?.title;
			sections.push({
				title: typeof node.name === 'string' ? node.name : outer,
				pages: [],
			});
			if (node.index) add(node.index.url);
			walk(node.children);
			sections.push({ title: outer, pages: [] });
		}
	};

	walk(source.getPageTree().children);
	return sections.filter((section) => section.pages.length > 0);
}
