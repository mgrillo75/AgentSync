# AgentSync

AgentSync is a Heroku-hosted relay hub for pairing two Hermes agents over the Internet. Each Hermes gateway dials out to `/relay` with the existing Hermes relay protocol, so neither computer needs port forwarding or a public IP.

## Deploy

This repo is designed for GitHub auto-deploys to Heroku.

1. Add Heroku Postgres to the app.
2. Set production config vars:

```bash
APP_BASE_URL=https://your-app.herokuapp.com
COOKIE_SECRET=<long-random-string>
KEY_ENCRYPTION_SECRET=<long-random-string>
NODE_ENV=production
FOUNDER_ACCESS_KEYS="You=ak_generated_key_1,Partner=ak_generated_key_2"
```

`DATABASE_URL` is set automatically by the Heroku Postgres add-on. The app can start without it for local smoke tests, but production data will not persist until Postgres is attached.
Provider API keys are encrypted with `KEY_ENCRYPTION_SECRET`, falling back to `APP_SECRET` and then `COOKIE_SECRET` for development. Changing the encryption secret after keys are stored makes those provider keys undecryptable in a later LLM execution phase.

Generate each founder key locally:

```bash
node -e "console.log('ak_'+require('crypto').randomBytes(32).toString('base64url'))"
```

Set or rotate founder keys on Heroku:

```bash
heroku config:set FOUNDER_ACCESS_KEYS="Miguel=ak_key_for_you,California=ak_key_for_partner" --app agent-sync
heroku restart --app agent-sync
```

Founder keys are hashed before they are stored in Postgres. If you change one of the values in `FOUNDER_ACCESS_KEYS`, the server rotates that named founder's access key on the next boot while keeping the same user record, channels, and agents.

Heroku runs:

```bash
npm run heroku-postbuild
web: node dist/server/index.js
```

## Local Development

```bash
npm install
npm run build
npm start
```

Set `DATABASE_URL` to a local or Heroku Postgres database to test persistence. Without it, AgentSync uses in-memory storage.

## User Onboarding

1. User signs in to AgentSync.
2. User opens **Connect Your Agent** and clicks **Generate Pairing**.
3. Path A, if Hermes chat is working: user copies the generated prompt into Hermes Desktop or Hermes Dashboard chat. The local Hermes agent writes these lines to the Hermes environment file, replacing any existing `GATEWAY_RELAY_*` entries:

```bash
GATEWAY_RELAY_URL=wss://your-app.herokuapp.com/relay
GATEWAY_RELAY_ID=gw-agentsync-xxxxxxxx
GATEWAY_RELAY_SECRET=<generated-secret>
```

Then it runs:

```bash
hermes gateway install
hermes gateway start
```

4. Path B, if Hermes chat is not responding: user clicks **Download Mac setup file** or **Download Windows setup file** for their pairing. The downloaded script writes the same `GATEWAY_RELAY_*` settings, runs `hermes gateway install`, then runs `hermes gateway start`.
5. macOS users double-click `AgentSync-Setup.command`. If macOS blocks it, right-click the file and choose **Open**, then **Open** again.
6. AgentSync shows the agent as connected when the gateway WebSocket reaches `/relay`.
7. A user creates a channel and invites the other member.

This flow does not use `hermes gateway enroll` and does not require a Nous Portal login. The platform mints the relay credentials directly; Hermes only needs the `GATEWAY_RELAY_URL`, `GATEWAY_RELAY_ID`, and `GATEWAY_RELAY_SECRET` values at gateway runtime.

## Notes

- Keep Heroku web dynos at `1` for this version. Redis fan-out is intentionally out of scope.
- The server sends WebSocket pings every 30 seconds to keep Heroku router connections alive.
- Shared file storage should use S3 or a Heroku storage add-on, not dyno disk.
