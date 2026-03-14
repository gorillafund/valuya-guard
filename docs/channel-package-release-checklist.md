# Channel Package Release Checklist

Release these packages in dependency order:

1. `@valuya/channel-access-core`
2. `@valuya/bot-channel-core`
3. `@valuya/bot-channel-app-core`
4. `@valuya/bot-channel-server-core`
5. `@valuya/bot-channel-bootstrap-core`
6. `@valuya/whatsapp-channel-access`
7. `@valuya/telegram-channel-access`
8. `@valuya/whatsapp-bot-channel`
9. `@valuya/telegram-bot-channel`

Recommended checks before publish:

1. Build and test each package locally.
2. Run `npm pack --dry-run` with a writable cache, for example:
   - `NPM_CONFIG_CACHE=/tmp/npm-cache npm pack --dry-run`
3. Confirm the package has:
   - `dist` output
   - correct `main`, `types`, and `exports`
   - semver dependencies instead of `workspace:^`
4. Confirm `.env.example` presets are included for the bot-channel packages.

Notes:

- The root `.npmrc` expects `NPM_TOKEN`. If it is unset, `pnpm` and `npm` warn while reading config.
- That warning does not block local builds, but it will matter for actual publish.
