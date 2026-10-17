import { getReleases, releaseAnchor, releaseTitle } from '@/lib/changelog';
import { SITE_NAME, SITE_URL } from '@/lib/seo';

export const revalidate = 3600;

const escape = (value: string) =>
	value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function GET() {
	const releases = (await getReleases()).filter(
		(release) => !release.unreleased,
	);
	const items = releases
		.map((release) => {
			const link = `${SITE_URL}/changelog#${releaseAnchor(release)}`;
			const date = release.date
				? `\n\t\t\t<pubDate>${new Date(release.date).toUTCString()}</pubDate>`
				: '';
			return `\t\t<item>
			<title>${escape(`${SITE_NAME} ${releaseTitle(release)}`)}</title>
			<link>${link}</link>
			<guid>${link}</guid>${date}
			<description>${escape(release.body)}</description>
		</item>`;
		})
		.join('\n');

	return new Response(
		`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
	<channel>
		<title>${SITE_NAME} changelog</title>
		<link>${SITE_URL}/changelog</link>
		<description>Every ${SITE_NAME} release.</description>
${items}
	</channel>
</rss>
`,
		{ headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } },
	);
}
