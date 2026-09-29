# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

**whatseerr** receives Seerr (Jellyseerr) webhooks and posts a message to a WhatsApp group when a
media becomes available. Scope, decisions and roadmap: [docs/SPEC.md](docs/SPEC.md). Read it
before starting a feature, and update it in the same commit when a decision changes.

Current status: milestones **M1** (harness), **M2** (WhatsApp delivery via Baileys) and **M3**
(group discovery) done. Next: **M4** (robustness). Check the milestone list in the spec before starting.

## Non-negotiable rules

1. **The GitHub repository is PUBLIC. Never commit secrets.** This includes `.env` files, tokens,
   the WhatsApp session (`data/`, any Baileys auth state), real phone numbers, real group JIDs and
   real personal data. Fixtures use fake data only (`example.com`, fake usernames). Before each
   commit, review `git diff --cached` for anything sensitive. CI runs gitleaks on every push.
2. **Every code change ends with a commit and a push** to `origin`. One logical change per commit.
3. **Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/), in
   English**: `type(scope): imperative summary` (lowercase, no final period, ≤ 72 chars).
   - Types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`, `style`.
   - Scopes: `http`, `seerr`, `whatsapp`, `notifications`, `i18n`, `config`, `docker`, `ci`,
     `deps`, `docs`, `harness`.
   - Breaking changes: `feat(config)!: …` plus a `BREAKING CHANGE:` footer.
4. **`npm run check` must pass before committing** (format, lint, typecheck, tests, build).
5. Talk to the user in **French**; write code, comments, docs, commits and logs in **English**.

## Commands

```bash
npm ci                 # install (use npm, the lockfile is package-lock.json)
npm run dev            # run with reload (needs WEBHOOK_SECRET in the environment)
npm run check          # everything CI runs: format:check, lint, typecheck, test, build
npm test               # vitest run  (single file: npx vitest run test/format.test.ts)
npm run lint:fix       # eslint --fix
npm run format         # prettier --write
docker build -t whatseerr:local .
```

Local smoke test of the webhook:

```bash
curl -X POST http://127.0.0.1:8080/webhook \
  -H "Authorization: Bearer $WEBHOOK_SECRET" -H "Content-Type: application/json" \
  --data @test/fixtures/seerr/media-available-movie.json
```

## Layout

```
src/
  index.ts                 entrypoint: config → logger → notifier → server, graceful shutdown
  config.ts                env parsing with Zod (the only place reading process.env)
  logger.ts                pino with secret redaction
  http/server.ts           Fastify app: /healthz, /readyz, /groups and /webhook (Bearer auth)
  seerr/payload.ts         Zod schema of the Seerr webhook payload
  notifications/format.ts  pure payload → OutgoingMessage mapping
  i18n/index.ts            FR/EN message catalog
  whatsapp/notifier.ts     Notifier interface + LogNotifier (DRY_RUN)
  whatsapp/baileys-notifier.ts  sends to the group through the connection (poster or text)
  whatsapp/connection.ts   socket lifecycle: QR/pairing code, reconnect, session reset
  whatsapp/policy.ts       pure disconnect → action mapping and backoff
  whatsapp/socket.ts       real Baileys socket factory and auth-state storage
  whatsapp/image.ts        poster download (timeout, size cap)
  whatsapp/groups.ts       group listing (GET /groups) and startup report
test/
  *.test.ts                Vitest tests
  fixtures/seerr/*.json    realistic Seerr payloads (fake data)
docs/SPEC.md               scope, decisions, milestones
```

## Code conventions

- TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), native ESM:
  relative imports **must end in `.js`**; use `import type` for type-only imports.
- Validate every external input (env, HTTP bodies, WhatsApp events) with Zod at the boundary;
  inside the app, rely on the inferred types.
- No `console.*` (lint error): use the injected pino logger. Never log secrets, the
  `Authorization` header, requester emails, or Baileys credentials.
- Keep logic pure and injectable: `buildServer()` receives its dependencies; the HTTP layer only
  knows the `Notifier` interface, never Baileys.
- User-facing strings go through `src/i18n` (add every key to both `fr` and `en`).
  WhatsApp formatting: `*bold*`, `_italic_`.
- Prefer small modules and named exports; no default exports.

## Testing

- Every behaviour change comes with a test. HTTP routes are tested with `app.inject()` and a fake
  `Notifier` (see `test/server.test.ts`), never with a real WhatsApp connection.
- New Seerr payload shapes → add a fixture in `test/fixtures/seerr/` and register its name in
  `test/fixtures/index.ts`.
- WhatsApp code is tested without network: `WhatsAppConnection` takes injectable `createSocket`,
  `loadAuth`, `clearAuth` and `print`; `test/whatsapp-connection.test.ts` drives a `FakeSocket`
  (an `EventEmitter` emitting `connection.update`) with Vitest fake timers. Reuse that pattern.

## Seerr notes

- Webhook agent: Settings → Notifications → Webhook. URL `http://whatseerr:8080/webhook`,
  "Authorization Header" `Bearer <WEBHOOK_SECRET>`, default JSON payload, enable "Media Available".
- All templated values are strings; `media`, `request`, `extra` can be `null`.
- The "Test" button sends `TEST_NOTIFICATION`, which is forwarded as a test message on purpose.

## Baileys notes

- Package `baileys` (v7, ESM), pinned to an exact version: the v7 line is still in release
  candidate and breaking changes are frequent. Read the changelog and rerun a real pairing before
  bumping it (Dependabot PRs for `baileys` must not be merged blindly).
- Auth state lives in `<DATA_DIR>/auth` (`useMultiFileAuthState` + `makeCacheableSignalKeyStore`).
  This directory is equivalent to a password: git-ignored, Docker volume, never logged.
- Never call `socket.logout()` on shutdown: it unlinks the device. Use `socket.end()`.
- Only one process may use a session: a second socket with the same credentials kicks the first
  (`connectionReplaced`). Never open a second connection (e.g. from a CLI) next to the server.
- Do not disable history sync entirely (`shouldSyncHistoryMessage: () => false`): Baileys needs
  the initial sync for LID mappings, otherwise sessions become unstable.
- QR and pairing codes are written raw to stdout (`print`), not through pino, so they stay
  readable in `docker logs`.
- `WHATSAPP_LOG_LEVEL` defaults to `warn`; `debug`/`trace` may log session material.
- Keep the message rate low (one message per event) to limit ban risk.
- Poster thumbnails use `sharp` (a required peer of Baileys, prebuilt for musl on amd64/arm64).

## Docker & CI/CD

- `Dockerfile`: multi-stage, TypeScript compiled on `$BUILDPLATFORM`, production deps installed per
  target arch, runs as `node`, state in `/data`, healthcheck on `/healthz`.
- `.github/workflows/ci.yml`: `npm run check` + gitleaks on every push/PR.
- `.github/workflows/docker.yml`: builds `linux/amd64,linux/arm64`; pushes to
  `ghcr.io/syfizz/whatseerr` on `main` (`latest`, `sha-…`) and on `v*.*.*` tags (semver). PRs build
  without pushing.
- Release: `git tag vX.Y.Z && git push origin vX.Y.Z`.
- Adding a new source directory or root file needed at build time requires updating the
  allow-list in `.dockerignore`.

## Definition of done

1. `npm run check` passes locally.
2. Docs updated if behaviour or configuration changed (`README.md`, `.env.example`,
   `docs/SPEC.md` milestone checkbox).
3. No secret or personal data in the diff.
4. Conventional commit in English, pushed to GitHub.
