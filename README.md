# whatseerr

Notifications from [Seerr](https://github.com/seerr-team/seerr) (Jellyseerr) straight to a
WhatsApp group: when a requested movie or series becomes available, whatseerr posts its poster,
title, synopsis and requester to your group.

> **Status: early development.** Webhook handling and WhatsApp delivery work; group discovery and
> robustness features are next. See [docs/SPEC.md](docs/SPEC.md) for the roadmap.

> **Warning:** whatseerr uses [Baileys](https://github.com/WhiskeySockets/Baileys), an unofficial
> WhatsApp Web client. Use a dedicated phone number: WhatsApp may ban accounts using unofficial
> clients.

## Quick start (Docker)

```bash
cp .env.example .env              # then set WEBHOOK_SECRET (openssl rand -hex 32)
cp compose.example.yaml compose.yaml
docker compose up -d
docker compose logs -f whatseerr  # scan the QR code with WhatsApp > Linked devices
```

Image: `ghcr.io/syfizz/whatseerr` (`linux/amd64`, `linux/arm64`).

## Seerr configuration

In Seerr, open **Settings → Notifications → Webhook**:

| Setting              | Value                           |
| -------------------- | ------------------------------- |
| Webhook URL          | `http://whatseerr:8080/webhook` |
| Authorization Header | `Bearer <WEBHOOK_SECRET>`       |
| JSON Payload         | default template                |
| Notification types   | **Media Available**             |

Use the **Test** button to check the connection: a test message is sent to the group.

## Configuration

| Variable                 | Required | Default | Description                                                  |
| ------------------------ | -------- | ------- | ------------------------------------------------------------ |
| `WEBHOOK_SECRET`         | yes      |         | Shared secret with Seerr (≥ 16 chars)                        |
| `WHATSAPP_GROUP_JID`     | yes\*    |         | Target group, e.g. `120363012345678901@g.us`                 |
| `WHATSAPP_PAIRING_PHONE` | no       |         | Pair with a code instead of a QR code (digits, country code) |
| `LANGUAGE`               | no       | `fr`    | Message language: `fr` or `en`                               |
| `PORT`                   | no       | `8080`  | HTTP port                                                    |
| `LOG_LEVEL`              | no       | `info`  | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |
| `DATA_DIR`               | no       | `/data` | WhatsApp session directory (keep it private)                 |
| `WHATSAPP_LOG_LEVEL`     | no       | `warn`  | Log level of the Baileys WhatsApp library                    |
| `DRY_RUN`                | no       | `false` | Log messages instead of sending them to WhatsApp             |

\* Needed to deliver messages; can be left empty for the first start while pairing.

## Pairing

On first start, whatseerr prints a QR code in its logs (`docker compose logs -f whatseerr`).
On the phone, open **WhatsApp → Linked devices → Link a device** and scan it. If scanning is
impractical, set `WHATSAPP_PAIRING_PHONE` (e.g. `33612345678`): an 8-character code is printed
instead, to enter under **Link with phone number**.

The session is stored in the `/data` volume: keep it private, it grants access to the account.
If the device is unlinked from the phone, whatseerr clears the session and shows a new QR code.

## Finding the group JID

Add the paired WhatsApp account to the target group. Once connected without
`WHATSAPP_GROUP_JID`, whatseerr prints the groups of the account in its logs:

```text
WhatsApp groups of this account. Set WHATSAPP_GROUP_JID to the target one and restart:
  120363012345678901@g.us  Movie night (12 members)
```

The same list is available at any time as JSON:

```bash
curl -H "Authorization: Bearer $WEBHOOK_SECRET" http://localhost:8080/groups
```

Copy the JID into `.env` and restart the container.

## Endpoints

| Endpoint        | Description                                                                       |
| --------------- | --------------------------------------------------------------------------------- |
| `POST /webhook` | Seerr webhook (requires `Authorization: Bearer <WEBHOOK_SECRET>`)                 |
| `GET /healthz`  | Liveness: the process is up                                                       |
| `GET /groups`   | WhatsApp groups of the account (requires the Bearer secret)                       |
| `GET /readyz`   | Readiness: `200` when WhatsApp is connected and a group is configured, else `503` |

## Development

Requires Node.js 26+.

```bash
npm ci
npm run check   # format, lint, typecheck, tests, build
WEBHOOK_SECRET=dev-secret-change-me npm run dev
```

Contributions follow [Conventional Commits](https://www.conventionalcommits.org/).

## License

[GPL-3.0](LICENSE)
