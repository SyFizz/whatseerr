# whatseerr

Notifications from [Seerr](https://github.com/seerr-team/seerr) (Jellyseerr) straight to a
WhatsApp group: when a requested movie or series becomes available, whatseerr posts its poster
with the title, a short synopsis and the requester.

```text
[poster]
📺 New series available

*Severance (2022)*
Requested Seasons: 1, 2

_Mark leads a team of office workers whose memories have been surgically divided between
their work and personal lives._

Requested by bob
```

> **Warning:** whatseerr uses [Baileys](https://github.com/WhiskeySockets/Baileys), an unofficial
> WhatsApp Web client. Use a **dedicated phone number**: WhatsApp may ban accounts using
> unofficial clients.

## Requirements

- Docker (image `ghcr.io/syfizz/whatseerr`, `linux/amd64` and `linux/arm64`).
- A WhatsApp account for the bot, on a phone you can unlock to link a device.
- Seerr able to reach whatseerr over HTTP (same Docker network, LAN address or reverse proxy).

## Installation

### 1. Configure

```bash
curl -O https://raw.githubusercontent.com/SyFizz/whatseerr/main/compose.example.yaml
curl -o .env https://raw.githubusercontent.com/SyFizz/whatseerr/main/.env.example
mv compose.example.yaml compose.yaml
```

In `.env`, set `WEBHOOK_SECRET` to a random value (`openssl rand -hex 32`). Leave
`WHATSAPP_GROUP_JID` empty for now.

### 2. Start and link the WhatsApp account

```bash
docker compose up -d
docker compose logs -f whatseerr
```

A QR code is printed in the logs. On the bot's phone, open **WhatsApp → Settings → Linked
devices → Link a device** and scan it. The QR code is renewed regularly: scan the latest one.

If scanning is impractical (e.g. narrow terminal), set `WHATSAPP_PAIRING_PHONE` to the bot's
number, digits only with the country code (e.g. `33612345678`), and restart: an 8-character code
is printed instead, to enter under **Link a device → Link with phone number instead**.

The session is stored in the `/data` volume, so linking is needed only once.

### 3. Choose the group

Add the bot's account to the target WhatsApp group. Once linked, whatseerr prints the groups of
the account in its logs (restart the container if the account joined the group afterwards):

```text
WhatsApp groups of this account. Set WHATSAPP_GROUP_JID to the target one and restart:
  120363012345678901@g.us  Movie night (12 members)
```

The same list is available at any time as JSON:

```bash
curl -H "Authorization: Bearer $WEBHOOK_SECRET" http://localhost:8080/groups
```

Copy the JID into `WHATSAPP_GROUP_JID` in `.env`, then `docker compose up -d` to apply it.

### 4. Configure Seerr

In Seerr, open **Settings → Notifications → Webhook**:

| Setting              | Value                                                              |
| -------------------- | ------------------------------------------------------------------ |
| Enable Agent         | checked                                                            |
| Webhook URL          | `http://whatseerr:8080/webhook` (see below)                        |
| Authorization Header | `Bearer <WEBHOOK_SECRET>` (the word `Bearer`, a space, the secret) |
| JSON Payload         | the default template                                               |
| Notification Types   | **Media Available**                                                |

The URL depends on where Seerr runs:

- **Same Docker network** (e.g. both in one Compose project): `http://whatseerr:8080/webhook`.
- **Another host**: publish the port (`ports: ["8080:8080"]` in `compose.yaml`) and use
  `http://<whatseerr-host>:8080/webhook`, or the URL of your reverse proxy.

Prefer a private address: the endpoint does not need to be reachable from the Internet.

### 5. Test

Click **Test** in the Seerr webhook settings: a test message should appear in the group within a
few seconds. From now on, each media that becomes available is announced in the group.

## Configuration

| Variable                 | Required | Default | Description                                                  |
| ------------------------ | -------- | ------- | ------------------------------------------------------------ |
| `WEBHOOK_SECRET`         | yes      |         | Shared secret with Seerr (≥ 16 chars)                        |
| `WHATSAPP_GROUP_JID`     | yes\*    |         | Target group, e.g. `120363012345678901@g.us`                 |
| `WHATSAPP_PAIRING_PHONE` | no       |         | Pair with a code instead of a QR code (digits, country code) |
| `LANGUAGE`               | no       | `fr`    | Message language: `fr` or `en`                               |
| `OVERVIEW_MAX_LENGTH`    | no       | `200`   | Synopsis length in characters, whole sentences (`0`: hidden) |
| `DEDUP_WINDOW_MINUTES`   | no       | `360`   | Announce the same media once within this window (`0`: off)   |
| `QUEUE_MAX_AGE_HOURS`    | no       | `24`    | Drop queued messages not delivered within this delay         |
| `SEND_INTERVAL_SECONDS`  | no       | `5`     | Minimum delay between two WhatsApp messages                  |
| `PORT`                   | no       | `8080`  | HTTP port                                                    |
| `LOG_LEVEL`              | no       | `info`  | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |
| `WHATSAPP_LOG_LEVEL`     | no       | `warn`  | Log level of the Baileys WhatsApp library                    |
| `DATA_DIR`               | no       | `/data` | WhatsApp session and message queue (keep it private)         |
| `DRY_RUN`                | no       | `false` | Log messages instead of sending them to WhatsApp             |

\* Needed to deliver messages; can be left empty for the first start while pairing.

## How delivery works

- **Queue.** Seerr never retries a webhook, so whatseerr stores each notification in `/data`
  before acknowledging it (`202`). Messages are sent one at a time, at least
  `SEND_INTERVAL_SECONDS` apart, and retried while WhatsApp is disconnected or waiting for
  pairing, including across restarts, until `QUEUE_MAX_AGE_HOURS`.
- **No duplicates.** Seerr sends one notification per request: a movie requested in HD and 4K, or
  a series requested season by season, would be announced several times. whatseerr announces a
  given media once per `DEDUP_WINDOW_MINUTES`.
- **Test button.** The Seerr test notification is not queued: it is sent right away, so Seerr
  reports whether WhatsApp works.
- **Poster.** If the poster cannot be downloaded, the message is sent as text only.

## Troubleshooting

Start with `docker compose logs whatseerr` and `curl http://localhost:8080/readyz`, which returns
the state of the WhatsApp connection and the number of queued messages.

| Symptom                                                 | Cause and fix                                                                                                                                                     |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seerr hangs on "Sending test notification" or times out | The request does not reach whatseerr (no `/webhook` line in the logs). Check the URL and port, and run `curl http://<url>/healthz` **from the Seerr host**.       |
| Test fails with an error, logs show `401`               | The Authorization Header must be exactly `Bearer <WEBHOOK_SECRET>`.                                                                                               |
| `/readyz`: `waiting-for-pairing`                        | Link the account (step 2). The QR code is in the logs.                                                                                                            |
| `/readyz`: `missing-group-jid`                          | Set `WHATSAPP_GROUP_JID` (step 3).                                                                                                                                |
| Warning "not a member of WHATSAPP_GROUP_JID"            | Add the bot's account to the group, or fix the JID with `GET /groups`.                                                                                            |
| `/readyz`: `stopped`                                    | WhatsApp closed the session for good: another instance uses the same `/data` (run only one), or the account was banned. See the logs, then restart.               |
| A new QR code appears after it worked                   | The device was unlinked from the phone: scan it again.                                                                                                            |
| Nothing is posted for a new media, test works           | Enable **Media Available** in the Seerr notification types. A media announced less than `DEDUP_WINDOW_MINUTES` ago is skipped (`Duplicate notification dropped`). |

`DRY_RUN=true` logs the messages instead of sending them, to check the Seerr side without
WhatsApp.

## Updating

```bash
docker compose pull && docker compose up -d
```

Image tags: `1` (latest 1.x, recommended), `1.2`, `1.2.3` (pinned), `latest` (main branch). The
WhatsApp session and the queue are kept in the volume.

## Security

- `WEBHOOK_SECRET` protects `/webhook` and `/groups`; keep it out of version control.
- The `/data` volume holds the WhatsApp session: anyone with it can use the account.
- whatseerr only sends messages to the configured group; it does not read conversations.

## Endpoints

| Endpoint        | Description                                                                       |
| --------------- | --------------------------------------------------------------------------------- |
| `POST /webhook` | Seerr webhook (requires `Authorization: Bearer <WEBHOOK_SECRET>`)                 |
| `GET /groups`   | WhatsApp groups of the account (requires the Bearer secret)                       |
| `GET /readyz`   | `200` when a message would be delivered, else `503`; state and queue size in JSON |
| `GET /healthz`  | Liveness: the process is up                                                       |

## Development

Requires Node.js 26+. Scope, decisions and roadmap: [docs/SPEC.md](docs/SPEC.md).

```bash
npm ci
npm run check   # format, lint, typecheck, tests, build
WEBHOOK_SECRET=dev-secret-change-me DRY_RUN=true npm run dev
```

Contributions follow [Conventional Commits](https://www.conventionalcommits.org/).

## License

[GPL-3.0](LICENSE)
