import { ArrowRight, FileText, SearchCheck, Sparkles } from 'lucide-react';
import { RiOpenaiFill } from 'react-icons/ri';
import {
	SiClaude,
	SiCursor,
	SiGithubcopilot,
	SiWindsurf,
} from 'react-icons/si';

import { SkillCommand } from '@/components/landing/skill-command';

const AGENTS = [
	{ icon: SiClaude, name: 'Claude Code' },
	{ icon: RiOpenaiFill, name: 'Codex' },
	{ icon: SiCursor, name: 'Cursor' },
	{ icon: SiGithubcopilot, name: 'Copilot' },
	{ icon: SiWindsurf, name: 'Windsurf' },
	{ icon: RiOpenaiFill, name: 'ChatGPT' },
];

const POINTS = [
	{
		icon: Sparkles,
		title: 'A skill for coding agents',
		href: '/docs/ai',
		body: 'One command installs it in Claude Code, Codex, Cursor, Copilot, and other agents. It checks your installed version before it writes code.',
	},
	{
		icon: FileText,
		title: 'Docs as Markdown',
		href: '/llms.txt',
		body: 'llms.txt, llms-full.txt, and a .md version of every page. Copy a page as Markdown or open it in ChatGPT or Claude.',
	},
	{
		icon: SearchCheck,
		title: 'Guardrails that catch mistakes',
		href: '/docs/plugins/rules',
		body: 'The ESLint plugin flags unbounded reads and unsafe writes in the editor, and the rules plugin enforces them at runtime.',
	},
];

export function Agents() {
	return (
		<section className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-6 py-24 lg:grid-cols-2">
			<div>
				<h2 className="text-3xl font-semibold tracking-tight">
					Works with your agent
				</h2>
				<p className="text-fd-muted-foreground mt-4">
					Install the skill once. Your agent reads the current docs and
					writes the real API.
				</p>
				<ul className="text-fd-muted-foreground mt-8 flex flex-wrap gap-x-6 gap-y-4">
					{AGENTS.map((agent) => (
						<li
							key={agent.name}
							className="inline-flex items-center gap-2 text-sm font-medium"
						>
							<agent.icon className="text-fd-foreground size-5" />
							{agent.name}
						</li>
					))}
				</ul>
				<div className="mt-8">
					<SkillCommand />
				</div>
			</div>
			<ul className="flex flex-col gap-6">
				{POINTS.map((point) => (
					<li key={point.title}>
						<a href={point.href} className="group flex gap-4">
							<point.icon className="text-brand mt-0.5 size-5 shrink-0" />
							<div>
								<p className="group-hover:text-brand flex items-center gap-1.5 font-semibold transition-colors">
									{point.title}
									<ArrowRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
								</p>
								<p className="text-fd-muted-foreground mt-1 text-sm">
									{point.body}
								</p>
							</div>
						</a>
					</li>
				))}
			</ul>
		</section>
	);
}
