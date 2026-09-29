# whatseerr

Notifications from [Seerr](https://github.com/seerr-team/seerr) (Jellyseerr) straight to a
WhatsApp group: when a requested movie or series becomes available, whatseerr posts its poster,
title, synopsis and requester to your group.

> **Status: early development.** The webhook pipeline is in place; WhatsApp delivery (Baileys) is
> the next milestone. See [docs/SPEC.md](docs/SPEC.md) for the roadmap.

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

\* Needed to deliver messages; can be left empty for the first start while pairing.

## Development

Requires Node.js 24+.

```bash
npm ci
npm run check   # format, lint, typecheck, tests, build
WEBHOOK_SECRET=dev-secret-change-me npm run dev
```

Contributions follow [Conventional Commits](https://www.conventionalcommits.org/).

## License

[GPL-3.0](LICENSE)
