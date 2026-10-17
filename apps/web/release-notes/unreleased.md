---
version: 0.4.0
unreleased: true
---

`0.4.0` adds tenant isolation: the experimental [`better-drizzle/tenant`](/docs/plugins/tenant) plugin, built on a new core primitive for plugin authors, [model scopes](/docs/plugins/writing-plugins#model-scopes). The soft-delete plugin moves onto model scopes, which changes what nested reads return.

### Behavior changes

- **Soft-deleted rows are hidden in nested reads.** `better-drizzle/soft-delete` used to filter only the root query, so deleted rows appeared in `include`, relation `select`, relation filters (`some`, `every`, `none`, `is`, `isNot`), `include._count`, and relation sorts. They are hidden there now. The `deleted` argument still controls the root rows only. `connect`, `disconnect`, and `set` no longer reach deleted rows. `$withoutPlugins()` still reads deleted rows at every level. See [soft delete](/docs/plugins/soft-delete#what-is-filtered).
- **Transactions rethrow callback errors unwrapped.** An error thrown inside the `transaction(...)` callback, including a nested one, now reaches the caller as the same object instead of a `BetterDrizzleError` with code `OPERATION_ERROR` and operation `"transaction"`. `onTransactionError` hooks still receive the normalized error. See [transactions](/docs/advanced/transactions). ([#81](https://github.com/almeidazs/better-drizzle/pull/81))
- **Soft deletes and restores keep other scopes.** The inner update of a soft `delete()` / `deleteMany()` and of `restore()` / `restoreById()` runs through `$withoutPlugins({ keepScopes: true })` instead of `$withoutPlugins()`, so on a tenant-scoped client it only touches that tenant's rows.

### Features

- **Tenant plugin (experimental).** `better-drizzle/tenant` scopes every model that has a tenant column: root reads, relation loads and filters, `_count`, relation sorts, writes, upserts, and relation-write lookups. `db.$tenant({ ... })` returns a scoped client, `db.$withoutTenant({ reason })` an audited bypass. It stamps tenant columns on create (optional in create types and zod/ata schemas), rejects changes to them, fails closed without a tenant, denies raw SQL on scoped clients by default, and can set PostgreSQL RLS settings per transaction. Options: `columns`, `global`, `models`, `missing`, `raw`, `rls`, and `strict`. See [tenant](/docs/plugins/tenant).
- **Model scopes for plugin authors.** A plugin can declare `scope: { key, model, root, missing, mismatch, bypass, session, rawSession }`. The core ANDs each model's scope into every statement that references the model, stamps and protects scope columns on writes, and handles upsert conflicts per dialect. `extendClient` receives `scope` and `withScope(state, meta?)`; hooks, transforms, intercepts, and raw hooks receive `scopes`. Clients without scope plugins keep their previous code paths. See [model scopes](/docs/plugins/writing-plugins#model-scopes).
- **`$withoutPlugins({ keepScopes: true })`.** Skips plugin hooks and transforms but keeps model scopes. `$withoutPlugins()` without options drops every scope; on a tenant-scoped client its operations pass `meta.tenantBypass = { reason: '$withoutPlugins' }`.
- **New error codes.** `TENANT_REQUIRED` (403), `TENANT_MISMATCH` (403), `TENANT_RAW_DENIED` (403), and `TENANT_ALREADY_SCOPED` (400). See [error codes](/docs/reference/errors#error-codes).
- **`ClientExtensionTypeResolver`.** A type-level resolver for client extensions typed from the schema, passed as the seventh `definePlugin` generic. Its optional `hidden` removes table keys from the root client type.
- **`better()` returns `BetterRootClient`.** It equals `BetterDrizzleClient` unless a plugin hides models (the tenant plugin's `strict` option), in which case the hidden delegates are removed from the root client and its `$withContext()`, `extends()`, and transaction clients.

### Fixes

- **Empty updates are a no-op.** When `data` has no column values after plugin transforms, `update` returns the current row, `updateMany` returns `{ count: 0 }`, and `upsert` returns the existing row, instead of failing with Drizzle's `No values to set`. ([#82](https://github.com/almeidazs/better-drizzle/pull/82))

### Contributors

- [@almeidazs](https://github.com/almeidazs)
- [@joaotonaco](https://github.com/joaotonaco) in [#81](https://github.com/almeidazs/better-drizzle/pull/81) and [#82](https://github.com/almeidazs/better-drizzle/pull/82)
