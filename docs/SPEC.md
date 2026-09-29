# whatseerr: product and technical specification

Framing decisions taken with the project owner on 2026-09-29. Treat this file as the source of
truth for scope; update it (in the same commit) whenever a decision changes.

## Goal

Post a message to **one WhatsApp group** whenever **Seerr** (formerly Jellyseerr/Overseerr) marks
a requested movie or series as **available**.

## Decisions

| Topic              | Decision                                                                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WhatsApp transport | [Baileys](https://github.com/WhiskeySockets/Baileys) embedded in the app (WhatsApp Web multi-device protocol). A **dedicated phone number** is recommended (unofficial API → ban risk). |
| Stack              | TypeScript (strict, ESM) on Node.js 26 · Fastify 5 · Zod 4 · Pino · Vitest                                                                                                              |
| Triggering events  | `MEDIA_AVAILABLE` only. `TEST_NOTIFICATION` is also answered so the Seerr "Test" button works. Every other type is acknowledged (`202`) and ignored.                                    |
| Message format     | TMDB poster image + caption: heading (movie / series), bold title with year, extras (e.g. requested seasons), italic overview (truncated), requester.                                   |
| Target             | A single group, identified by its JID (`…@g.us`) in `WHATSAPP_GROUP_JID`.                                                                                                               |
| Pairing            | QR code printed in the container logs (`docker logs`). Optional pairing-code flow via `WHATSAPP_PAIRING_PHONE`. Session persisted in the `/data` volume.                                |
| Language           | i18n FR + EN, chosen with `LANGUAGE` (default `fr`).                                                                                                                                    |
| Webhook security   | Seerr sends `Authorization: Bearer <WEBHOOK_SECRET>`; compared in constant time.                                                                                                        |
| Distribution       | Docker image on GHCR (`ghcr.io/syfizz/whatseerr`), multi-arch `linux/amd64` + `linux/arm64`, built by GitHub Actions. Tags: `latest` (main), semver (git tags `vX.Y.Z`), short SHA.     |

## Architecture

```
Seerr ──POST /webhook──▶ Fastify ──▶ Zod payload ──▶ formatNotification() ──▶ Notifier ──▶ WhatsApp group
          (Bearer auth)   (http/)     (seerr/)        (notifications/ + i18n/)   (whatsapp/)
```

- `Notifier` is an interface; the HTTP layer never talks to Baileys directly. This keeps the
  webhook path fully testable with a fake notifier.
- WhatsApp session state (Baileys multi-file auth state) lives in `DATA_DIR` (`/data` in Docker).

## Seerr webhook payload

Seerr's Webhook agent renders a JSON template. With the default template every value is a
**string**, and optional sections (`media`, `request`, `issue`, `comment`) are `null` when not
relevant. Relevant fields:

| Field                          | Example                                            |
| ------------------------------ | -------------------------------------------------- |
| `notification_type`            | `MEDIA_AVAILABLE`, `TEST_NOTIFICATION`, …          |
| `subject`                      | `Inception (2010)`                                 |
| `message`                      | Overview / synopsis                                |
| `image`                        | TMDB poster URL                                    |
| `media.media_type`             | `movie` or `tv`                                    |
| `media.tmdbId`, `media.tvdbId` | `27205`                                            |
| `request.requestedBy_username` | `alice`                                            |
| `extra[]`                      | `{ "name": "Requested Seasons", "value": "1, 2" }` |

Realistic samples live in [`test/fixtures/seerr/`](../test/fixtures/seerr/).

## Milestones

- [x] **M1 – Harness**: project tooling, webhook endpoint with auth, payload parsing, message
      formatting (FR/EN), log-only notifier, Dockerfile, CI (checks + secret scan) and CD (GHCR).
- [x] **M2 – WhatsApp delivery (Baileys)**
  - `BaileysNotifier` implementing `Notifier`; auth state in `DATA_DIR/auth`.
  - QR code rendered in the logs; pairing code when `WHATSAPP_PAIRING_PHONE` is set.
  - Reconnect with exponential backoff (1 s → 60 s); on `loggedOut`/`multideviceMismatch`, wipe
    the session and ask to re-pair; stop on `connectionReplaced`/`forbidden`.
  - Poster downloaded by whatseerr (10 s timeout, 5 MB cap) and sent as image with caption; falls
    back to text-only if the download fails.
  - Seerr posts webhooks without any timeout, so every webhook is bounded: it fails at once with
    `503` while pairing is pending or the connection is stopped, waits at most 10 s for a
    reconnection (`503`), and at most 20 s for WhatsApp to accept the message (`502`).
  - `/readyz` reflecting the WhatsApp connection state (`/healthz` stays process liveness).
  - `DRY_RUN=true` logs messages instead of sending them.
  - Baileys pinned exactly (`7.0.0-rc14`, the v7 line is still in release candidate).
- [x] **M3 – Group discovery**: when `WHATSAPP_GROUP_JID` is unset, print the groups the account
      belongs to (JID, name, members) once connected; when it is set, warn if the account is not a
      member. `GET /groups` (same Bearer secret as the webhook) returns the list as JSON.
      _Changed from the initial CLI idea: a CLI would open a second socket with the same session,
      and WhatsApp would disconnect the running server (`connectionReplaced`)._
- [x] **M4 – Robustness**
  - Durable outbox (`DATA_DIR/outbox.json`, atomic writes): `MEDIA_AVAILABLE` is persisted, then
    acknowledged with `202`. Seerr never retries webhooks, so this is the only way not to lose a
    notification received while WhatsApp is down or the container restarts.
  - Delivery one at a time, `SEND_INTERVAL_SECONDS` apart (default 5 s); retries with backoff
    (5 s → 60 s), immediately when WhatsApp reconnects; dropped after `QUEUE_MAX_AGE_HOURS`
    (default 24 h); at most 100 queued messages.
  - De-duplication by media (`media_type` + TMDB id, title as fallback), ignoring 4K and seasons:
    Seerr sends one `MEDIA_AVAILABLE` per request. Window `DEDUP_WINDOW_MINUTES` (default 6 h),
    persisted with the queue.
  - `TEST_NOTIFICATION` bypasses the queue so the Seerr Test button reflects WhatsApp health.
- [ ] **M5 – Release**: user documentation (Seerr setup, pairing walkthrough), first `v1.0.0`
      tag.

## Out of scope (for now)

Other Seerr events (requests, approvals, issues), several groups or per-type routing, a web UI,
the official WhatsApp Cloud API, sending to individual contacts.

## Security constraints

- The GitHub repository is **public**: no secret, session file, phone number, group JID or real
  personal data may ever be committed (fixtures use fake data and `example.com`).
- Configuration comes exclusively from environment variables (`.env` is git-ignored).
- The `/data` volume grants full access to the WhatsApp account: never log or copy its content.
- Logs must not contain the webhook secret, the `Authorization` header or requester emails.
- The container runs as the unprivileged `node` user.
