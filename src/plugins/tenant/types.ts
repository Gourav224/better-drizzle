import type {
	AnyPlugin,
	AnySchema,
	BetterDrizzleClient,
	ClientExtensionTypeResolver,
	ExtendedClient,
	InsertModelFor,
	TableKey,
} from 'better-drizzle';

/** Column keys of a `columns` option. */
export type TenantColumnKeys<Columns> = Columns extends readonly (infer Key)[]
	? Key & string
	: Columns & string;

/**
 * Per-model override: the tenant columns the model uses, the same with
 * `nullable`, or `false` to leave the model unscoped (same as `global`).
 */
export type TenantModelOverride<Column extends string = string> =
	| readonly Column[]
	| { readonly columns: readonly Column[]; readonly nullable?: boolean }
	| false;

/** What raw SQL may do on a tenant-scoped client. */
export type TenantRawMode = 'deny' | 'allow' | 'set-local';

/** What an operation on a scoped model does without a tenant value. */
export type TenantMissingMode = 'throw' | 'allow';

/**
 * Configuration accepted by {@link tenant}.
 *
 * @typeParam Columns - Tenant column keys.
 * @typeParam Global  - Table keys that are never scoped.
 * @typeParam Models  - Per-model overrides keyed by table key.
 * @typeParam Strict  - Hides scoped models from the root client type.
 */
export type TenantOptions<
	Columns extends string | readonly string[] = string | readonly string[],
	Global extends readonly string[] = readonly string[],
	Models extends Readonly<
		Record<string, TenantModelOverride<TenantColumnKeys<Columns>>>
	> = Readonly<
		Record<string, TenantModelOverride<TenantColumnKeys<Columns>>>
	>,
	Strict extends boolean = boolean,
> = {
	/**
	 * Tenant column keys. Each model is scoped by the configured columns it
	 * has; a model with none must be listed in `global` (junctions reached
	 * only through `.through()` between scoped models inherit their scope).
	 */
	columns: Columns;
	/** Table keys that are never filtered nor stamped. */
	global?: Global;
	/**
	 * Without a tenant value: `'throw'` fails with `TENANT_REQUIRED` before
	 * SQL runs; `'allow'` runs unfiltered on the missing columns (use only
	 * while migrating).
	 *
	 * @default 'throw'
	 */
	missing?: [Strict] extends [true] ? 'throw' : TenantMissingMode;
	/** Per-model overrides keyed by table key. */
	models?: Models;
	/**
	 * Raw SQL on tenant-scoped clients: `'deny'` throws `TENANT_RAW_DENIED`
	 * unless the call passes `{ tenant: 'trusted' }`; `'allow'` runs it;
	 * `'set-local'` runs it inside a transaction with the `rls` settings.
	 *
	 * @default 'deny'
	 */
	raw?: TenantRawMode;
	/**
	 * PostgreSQL only: runs `set_config(setting, value, true)` for every
	 * active tenant column inside the transaction of each operation. The
	 * setting defaults to `app.<database column name>`.
	 */
	rls?:
		| boolean
		| {
				readonly settings?: Readonly<
					Partial<Record<TenantColumnKeys<Columns>, string>>
				>;
		  };
	/**
	 * Hides scoped models from the root client type; `$tenant()` and
	 * `$withoutTenant()` clients expose them. Requires `missing: 'throw'`.
	 *
	 * @default false
	 */
	strict?: Strict;
};

type ColumnValue<Schema extends AnySchema, Column extends string> = {
	[Name in TableKey<Schema>]: Column extends keyof InsertModelFor<
		Schema,
		Name
	>
		? NonNullable<InsertModelFor<Schema, Name>[Column]>
		: never;
}[TableKey<Schema>];

/**
 * Values accepted by `$tenant()`, typed from the insert type of each column
 * (a union when the type differs across models).
 */
export type TenantValues<Schema extends AnySchema, Column extends string> = {
	[Key in Column]?: ColumnValue<Schema, Key>;
};

/** Options of `$withoutTenant()`. */
export type TenantBypassOptions = {
	/** Why the tenant scope is bypassed; reaches hooks as `meta.tenantBypass`. */
	reason: string;
};

type PreserveClientExtensions<Client, Base> = [
	Exclude<keyof Client, keyof Base>,
] extends [never]
	? Base
	: ExtendedClient<Base, Pick<Client, Exclude<keyof Client, keyof Base>>>;

/** `$tenant()`: scopes a client; `$tenant.values` holds the active values. */
export type TenantMethod<
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
	Column extends string,
> = {
	<This extends object>(
		this: This,
		values: TenantValues<Schema, Column>,
	): PreserveClientExtensions<
		This,
		BetterDrizzleClient<Schema, Meta, Plugins>
	>;
	(
		values: TenantValues<Schema, Column>,
	): BetterDrizzleClient<Schema, Meta, Plugins>;
	/** The active tenant values; empty outside `$tenant()`. */
	readonly values: Readonly<TenantValues<Schema, Column>>;
};

/** Client properties added by the tenant plugin. */
export type TenantClientExtension<
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
	Column extends string,
> = {
	/**
	 * Returns a client scoped to `values`. On a scoped client it narrows with
	 * columns not set yet; setting a set column throws `TENANT_ALREADY_SCOPED`.
	 */
	$tenant: TenantMethod<Schema, Meta, Plugins, Column>;
	/**
	 * Returns a client without the tenant scope. Every operation passes
	 * `meta.tenantBypass = { reason }` to hooks.
	 */
	$withoutTenant<This extends object>(
		this: This,
		options: TenantBypassOptions,
	): PreserveClientExtensions<
		This,
		BetterDrizzleClient<Schema, Meta, Plugins>
	>;
	$withoutTenant(
		options: TenantBypassOptions,
	): BetterDrizzleClient<Schema, Meta, Plugins>;
};

type HasColumn<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Column,
> = [Extract<Column, keyof InsertModelFor<Schema, Name>>] extends [never]
	? false
	: true;

/** Table keys the tenant plugin scopes. */
export type TenantScopedModels<
	Schema extends AnySchema,
	Column extends string,
	Global,
	Models,
> = {
	[Name in TableKey<Schema>]: Name extends Global
		? never
		: Name extends keyof Models
			? Models[Name] extends false
				? never
				: Name
			: HasColumn<Schema, Name, Column> extends true
				? Name
				: never;
}[TableKey<Schema>];

type SchemaOf<Schema> = Schema extends AnySchema ? Schema : never;
type PluginsOf<Plugins> = Plugins extends readonly AnyPlugin[]
	? Plugins
	: never;

/** Type-level resolver of the tenant client extension and strict hiding. */
export interface TenantExtension<
	Column extends string,
	Global,
	Models,
	Strict extends boolean,
> extends ClientExtensionTypeResolver {
	readonly extension: TenantClientExtension<
		SchemaOf<this['schema']>,
		this['meta'],
		PluginsOf<this['plugins']>,
		Column
	>;
	readonly hidden: [Strict] extends [true]
		? TenantScopedModels<SchemaOf<this['schema']>, Column, Global, Models>
		: never;
}

/** `models` mapped to the `generated` override shape. */
export type TenantGeneratedModels<Global extends readonly string[], Models> = {
	readonly [
		Name in keyof Models | Global[number]
	]: Name extends Global[number]
		? false
		: Name extends keyof Models
			? Models[Name] extends {
					readonly columns: infer Columns extends readonly string[];
				}
				? Columns
				: Models[Name] extends readonly string[] | false
					? Models[Name]
					: never
			: never;
};
