import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { cache } from 'react';

import { GITHUB_URL, SITE_URL } from '@/lib/seo';

export type Release = {
	version: string;
	date: string | null;
	body: string;
	url: string | null;
	unreleased: boolean;
};

type GithubRelease = {
	tag_name: string;
	body: string | null;
	html_url: string;
	draft: boolean;
	published_at: string | null;
};

const RELEASES_API =
	'https://api.github.com/repos/almeidazs/better-drizzle/releases?per_page=100';
const NOTES_DIR = join(process.cwd(), '../../release-notes');
const VERSION_FILE = /^\d+\.\d+\.\d+.*\.md$/;

/** `v0.3.0` and `better-drizzle@0.1.1`; the discontinued scoped plugin tags are skipped. */
const versionOf = (tag: string) =>
	tag.match(/^(?:v|better-drizzle@)(\d+\.\d+\.\d+.*)$/)?.[1];

/** Auto-generated or empty bodies give way to a local draft. */
const isPlaceholder = (body: string) =>
	body.trim().length < 200 || /^## What's Changed/m.test(body);

const compareVersions = (a: string, b: string) => {
	const left = a.split(/[.-]/).map(Number);
	const right = b.split(/[.-]/).map(Number);
	for (let i = 0; i < 3; i++)
		if (left[i] !== right[i]) return (right[i] ?? 0) - (left[i] ?? 0);
	return 0;
};

const parseNote = (source: string) => {
	const match = source.match(/^---\n([\s\S]*?)\n---\n?/);
	const data: Record<string, string> = Object.create(null);
	if (match)
		for (const line of match[1].split('\n')) {
			const index = line.indexOf(':');
			if (index > 0)
				data[line.slice(0, index).trim()] = line
					.slice(index + 1)
					.replace(/#.*/, '')
					.trim();
		}
	return {
		data,
		body: (match ? source.slice(match[0].length) : source).trim(),
	};
};

const readNotes = async () => {
	const notes: Release[] = [];
	let files: string[] = [];
	try {
		files = await readdir(NOTES_DIR);
	} catch {
		return notes;
	}

	for (const file of files) {
		if (file !== 'unreleased.md' && !VERSION_FILE.test(file)) continue;
		const { data, body } = parseNote(
			await readFile(join(NOTES_DIR, file), 'utf8'),
		);
		if (!data.version) continue;
		notes.push({
			version: data.version,
			date: data.date || null,
			body,
			url: data.tag ? `${GITHUB_URL}/releases/tag/${data.tag}` : null,
			unreleased: data.unreleased === 'true',
		});
	}
	return notes;
};

const fetchReleases = async () => {
	try {
		const headers: Record<string, string> = {
			Accept: 'application/vnd.github+json',
		};
		if (process.env.GITHUB_TOKEN)
			headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
		const response = await fetch(RELEASES_API, {
			headers,
			next: { revalidate: 3600 },
		});
		if (!response.ok) return [];
		return (await response.json()) as GithubRelease[];
	} catch {
		return [];
	}
};

/** Every release, newest first, with the upcoming version on top. */
export const getReleases = cache(async (): Promise<Release[]> => {
	const [notes, github] = await Promise.all([readNotes(), fetchReleases()]);
	const releases = new Map<string, Release>();

	for (const note of notes) releases.set(note.version, note);

	for (const release of github) {
		const version = versionOf(release.tag_name);
		if (!version || release.draft) continue;
		const body = (release.body ?? '')
			.replace(/\r\n/g, '\n')
			.replace(/^## better-drizzle \S+\s*\n/, '')
			// Version headings are h2, so release sections nest below them.
			.replace(/^## /gm, '### ')
			.trim();
		const note = releases.get(version);
		const useNote = note && isPlaceholder(body);
		releases.set(version, {
			version,
			date: release.published_at?.slice(0, 10) ?? note?.date ?? null,
			body: useNote ? note.body : body,
			url: release.html_url,
			unreleased: false,
		});
	}

	return [...releases.values()].sort((a, b) =>
		a.unreleased === b.unreleased
			? compareVersions(a.version, b.version)
			: a.unreleased
				? -1
				: 1,
	);
});

export const releaseAnchor = (release: Release) =>
	release.unreleased ? 'unreleased' : `v${release.version}`;

export const releaseTitle = (release: Release) =>
	release.unreleased ? `${release.version} (unreleased)` : release.version;

/** Site-relative links made absolute, for `/changelog.md` and RSS. */
export const absoluteLinks = (markdown: string) =>
	markdown.replace(/\]\(\//g, `](${SITE_URL}/`);

export const changelogMarkdown = (releases: Release[]) => {
	let output = `# better-drizzle changelog\n\n> Every better-drizzle release, newest first. Source: ${GITHUB_URL}/releases\n`;
	for (const release of releases) {
		output += `\n## ${releaseTitle(release)}`;
		if (release.date) output += ` - ${release.date}`;
		output += `\n\n${absoluteLinks(release.body)}\n`;
		if (release.url) output += `\nRelease: ${release.url}\n`;
	}
	return output;
};
