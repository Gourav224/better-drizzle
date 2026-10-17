/** Marks the release that added an API; Markdown output reads `(Added in x)`. */
export function Since({ version }: { version: string }) {
	return (
		<span className="border-brand/40 bg-brand-soft text-brand ms-1.5 inline-flex items-center rounded-md border px-1.5 py-0.5 align-middle text-[0.7rem] leading-none font-medium whitespace-nowrap">
			Added in {version}
		</span>
	);
}
