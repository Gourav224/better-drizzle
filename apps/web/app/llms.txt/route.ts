import { GITHUB_URL, NPM_URL, SITE_URL } from '@/lib/seo';
import { getDocsSections, markdownUrl } from '@/lib/source';

import pkg from '../../../../package.json';

export const revalidate = false;

const subpaths = Object.keys(pkg.exports)
	.filter((path) => path !== '.')
	.map((path) => `\`better-drizzle/${path.slice(2)}\``)
	.join(', ');

/**
 * llms.txt (https://llmstxt.org) generated from the docs, so new pages and
 * plugins show up without editing this file.
 */
export function GET() {
	const sections = getDocsSections()
		.map((section) => {
			const links = section.pages
				.map((page) => {
					const description = page.data.description
						? `: ${page.data.description}`
						: '';
					return `- [${page.data.title}](${SITE_URL}${markdownUrl(page.url)})${description}`;
				})
				.join('\n');
			return `## ${section.title ?? 'Docs'}\n\n${links}`;
		})
		.join('\n\n');

	const body = `# better-drizzle

> ${pkg.description} better-drizzle wraps an existing Drizzle client and gives every table a small, typed API (findMany, create, upsert, paginate, cursor, include, transactions, hooks, plugins) without hiding Drizzle or rebuilding an ORM.

- Latest release: ${pkg.version} (some pages document unreleased APIs marked "Added in <version>"; check the version in the project's package.json and the changelog before using them).
- Requires \`drizzle-orm\` ${pkg.peerDependencies['drizzle-orm']} (Drizzle ORM 1.x with \`defineRelations\`). Projects on drizzle-orm 0.x must use better-drizzle 0.2.x.
- Databases: PostgreSQL, MySQL, SQLite.
- Install: \`npm install better-drizzle drizzle-orm@1.0.0-rc.4\`
- Setup: \`const db = better(drizzle({ client, relations }))\`, then \`db.<table>.findMany(...)\`. Raw Drizzle stays available.
- Official plugins are subpath exports of the same package: ${subpaths}. There are no separate \`@better-drizzle/*\` packages.
- Every page is available as Markdown by appending \`.md\` to its URL.
- Full docs in one file: ${SITE_URL}/llms-full.txt
- Changelog: ${SITE_URL}/changelog.md
- Agent skill: \`npx skills add almeidazs/better-drizzle\`

${sections}

## Optional

- [GitHub repository](${GITHUB_URL}): source code and issues.
- [npm package](${NPM_URL}): published versions.
`;

	return new Response(body, {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	});
}
