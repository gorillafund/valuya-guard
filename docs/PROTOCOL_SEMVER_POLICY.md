# Protocol SemVer Policy

This policy defines versioning rules for `@valuya/protocol`.

## Rules

- Major (`X.0.0`): breaking wire-level changes.
- Minor (`0.X.0`): backward-compatible protocol capability additions.
- Patch (`0.0.X`): non-breaking corrections (docs, manifest metadata, typo fixes, internal refactors that do not change protocol behavior).

## What counts as a breaking change

- Removing or renaming exported protocol constants.
- Changing endpoint constants in a way that makes existing clients invalid.
- Changing subject header constant semantics.
- Any wire contract changes that require consumer code updates.

## What counts as a minor change

- Adding new endpoint constants.
- Adding new optional protocol metadata fields.
- Extending manifest content in a backward-compatible way.

## What counts as a patch change

- Correcting descriptions, comments, or docs only.
- Refactoring without changing exported values.
- Fixing build/manifest generation bugs while keeping manifest contract stable.

## Examples

- Remove `ENDPOINTS.agentProductsPrepare` -> major.
- Add `ENDPOINTS.agentChallengesCreate` -> minor.
- Fix manifest generator error message only -> patch.

## PR requirement

If `packages/protocol/src/**` changes, the PR must include a `.changeset/*.md` file. CI will fail otherwise with:

`Protocol changed but no changeset found. Run \`pnpm changeset\`.`
