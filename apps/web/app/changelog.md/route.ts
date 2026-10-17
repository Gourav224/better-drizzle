import { changelogMarkdown, getReleases } from '@/lib/changelog';

export const revalidate = 3600;

export async function GET() {
	return new Response(changelogMarkdown(await getReleases()), {
		headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
	});
}
