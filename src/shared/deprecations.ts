let warnedLegacyCount = false;

/** Warns once per process that the `_count` alias is deprecated. */
export const warnLegacyCount = () => {
	if (warnedLegacyCount) return;
	
	warnedLegacyCount = true;
	
	process.emitWarning(
		'`_count` is deprecated and will be removed in 0.5.0. Use `count` instead.',
		{
			code: 'BETTER_DRIZZLE_COUNT_DEPRECATED',
			type: 'DeprecationWarning',
		},
	);
};
