import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** Old docs URLs, `[source, destination]`. */
const REDIRECTS = [
	['/docs/comparison', '/docs/why'],
	['/docs/changelog', '/changelog'],
];

/** @type {import('next').NextConfig} */
const config = {
	reactStrictMode: true,
	// Changelog drafts live at the repo root, outside the app.
	outputFileTracingIncludes: {
		'/changelog': ['../../release-notes/**'],
		'/changelog.md': ['../../release-notes/**'],
		'/changelog/rss.xml': ['../../release-notes/**'],
	},
	async redirects() {
		return REDIRECTS.map(([source, destination]) => ({
			source,
			destination,
			permanent: true,
		}));
	},
	async rewrites() {
		return [
			{ source: '/docs.md', destination: '/llms.mdx' },
			{ source: '/docs/:path*.md', destination: '/llms.mdx/:path*' },
		];
	},
};

export default withMDX(config);
