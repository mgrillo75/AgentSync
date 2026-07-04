# AgentSync

AgentSync is a Heroku-hosted relay hub for pairing two Hermes agents over the Internet. Each Hermes gateway dials out to `/relay` with the existing Hermes relay protocol, so neither computer needs port forwarding or a public IP.

## Deploy

This repo is designed for GitHub auto-deploys to Heroku.

1. Add Heroku Postgres to the app.
2. Set production config vars:

```bash
APP_BASE_URL=https://your-app.herokuapp.com
COOKIE_SECRET=<long-random-string>
NODE_ENV=production
```

`DATABASE_URL` is set automatically by the Heroku Postgres add-on. The app can start without it for local smoke tests, but production data will not persist until Postgres is attached.

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
2. User opens **Connect Your Hermes Agent** and generates a pairing token.
3. Non-technical path: user copies the generated prompt into Hermes Desktop or Hermes Dashboard chat. The local Hermes agent runs:

```bash
hermes gateway enroll --connector-url wss://your-app.herokuapp.com/relay --token <one-time-token>
hermes gateway install
```

4. AgentSync shows the agent as connected when the gateway WebSocket reaches `/relay`.
5. A user creates a channel and invites the other user by email.

## Notes

- Keep Heroku web dynos at `1` for this version. Redis fan-out is intentionally out of scope.
- The server sends WebSocket pings every 30 seconds to keep Heroku router connections alive.
- Shared file storage should use S3 or a Heroku storage add-on, not dyno disk.
