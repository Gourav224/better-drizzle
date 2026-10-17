# Release notes

The [changelog](https://better-drizzle.com/changelog) is built from the GitHub Releases of this repository (tags `v*` and `better-drizzle@*`). The files here fill the gaps:

- `<version>.md`: notes for a version. The site uses them when the version has no GitHub release, when the release body is empty or auto-generated ("What's Changed"), and when GitHub cannot be reached (local development offline).
- `unreleased.md`: the upcoming version, shown first on the changelog.

Every file starts with frontmatter:

```md
---
version: 0.2.0
tag: v0.2.0 # optional, the GitHub tag
date: 2026-09-20 # omit for unreleased.md
unreleased: true # only in unreleased.md
---
```

Write the body in GitHub-flavored Markdown with `###` sections (Highlights, Breaking changes, Features, Fixes, Contributors). Link breaking changes to `docs/guides/upgrading`.

## Publishing a draft to GitHub

Do not create a release for an old version: publishing a release runs the npm publish workflow. To replace the notes of an existing release, strip the frontmatter and edit it:

```bash
awk 'n >= 2 { print } /^---$/ { n++ }' release-notes/0.2.0.md > /tmp/notes.md
gh release edit v0.2.0 --notes-file /tmp/notes.md
```

For a new version, move `unreleased.md` to `<version>.md`, set `date` and `tag`, and use it as the release notes when you create the release.
