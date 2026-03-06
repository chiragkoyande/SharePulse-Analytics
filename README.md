# SharePulse Analytics

[![Stars](https://img.shields.io/github/stars/chiragkoyande/SharePulse-Analytics?style=for-the-badge)](https://github.com/chiragkoyande/SharePulse-Analytics/stargazers)
[![Forks](https://img.shields.io/github/forks/chiragkoyande/SharePulse-Analytics?style=for-the-badge)](https://github.com/chiragkoyande/SharePulse-Analytics/network/members)
[![Last Commit](https://img.shields.io/github/last-commit/chiragkoyande/SharePulse-Analytics?style=for-the-badge)](https://github.com/chiragkoyande/SharePulse-Analytics/commits/main)
[![Issues](https://img.shields.io/github/issues/chiragkoyande/SharePulse-Analytics?style=for-the-badge)](https://github.com/chiragkoyande/SharePulse-Analytics/issues)
[![License](https://img.shields.io/badge/license-ISC-blue?style=for-the-badge)](./LICENSE)

SharePulse Analytics is a workspace-aware SaaS dashboard that monitors WhatsApp groups, extracts shared links, ranks engagement, and gives admins controlled user access.

- Owner: [Chirag Koyande](https://github.com/chiragkoyande)
- Repository: <https://github.com/chiragkoyande/SharePulse-Analytics>

## Table of Contents

- [What This Solves](#what-this-solves)
- [Core Capabilities](#core-capabilities)
- [Tech Stack](#tech-stack)
- [Setup](#setup)
- [API Overview](#api-overview)
- [Troubleshooting](#troubleshooting)

## What This Solves

Communities share important links in chat, but those links are hard to find later. SharePulse Analytics turns chat noise into a searchable, ranked knowledge feed with admin control.

## Core Capabilities

- Real-time WhatsApp link ingestion (`message` + `message_create` handlers)
- Startup and on-demand history scan for old links
- Workspace-based group mapping (`workspace_groups`)
- Workspace-scoped analytics and resource feeds
- Engagement actions (vote, save, CSV export)
- Request-access workflow with admin approval/rejection
- Role model: `super_admin`, workspace `owner/admin/member`
- Runtime ownership marker at `/health` and `/version`

## Product Highlights

| Area | Included |
|---|---|
| Ingestion | Live + historical link capture from monitored groups |
| Dedup & Scoring | URL normalization/hash + share/vote signals |
| Access Control | Request access, approve/reject, promote/revoke |
| Workspace Model | Separate group-to-workspace mapping and visibility |
| Personal UX | Save links and filter saved-only |
| Ops | Health/version metadata and explicit boot logs |

## Tech Stack

- Backend: Node.js, Express, `whatsapp-web.js`, Supabase JS
- Frontend: React + Vite
- Database/Auth: Supabase Postgres + Supabase Auth
- Email: Nodemailer (SMTP)

## System Flow

```text
WhatsApp Group Messages
  -> Bot Ingestion (backend/bot.js)
  -> URL extraction + normalization + hashing
  -> Supabase tables (resources, votes, saves, members, requests)
  -> Express APIs (auth/admin/workspaces/resources)
  -> React dashboard (workspace-scoped UI)
```

## Repository Layout

```text
.
├── schema.sql
├── migration_v2.sql
├── migration_v3_auth.sql
├── migration_v3_votes.sql
├── migration_v4_access_request_password.sql
├── migration_v5_resource_saves.sql
├── migration_v6_groups.sql
├── migration_v7_workspaces.sql
├── migration_v8_access_request_workspace.sql
├── backend/
│   ├── index.js
│   ├── bot.js
│   ├── db.js
│   ├── middleware/
│   ├── routes/
│   └── utils/
└── frontend/
    ├── src/
    ├── index.html
    └── vite.config.js
```

## Prerequisites

- Node.js 18+ (Node 22 recommended)
- Supabase project
- WhatsApp account for QR session
- Chrome/Chromium (or Puppeteer-managed browser)

## Setup

### 1) Clone

```bash
git clone https://github.com/chiragkoyande/SharePulse-Analytics.git
cd SharePulse-Analytics
```

### 2) Database Migrations (Supabase SQL Editor)

Run in order:

1. `schema.sql`
2. `migration_v2.sql`
3. `migration_v3_auth.sql`
4. `migration_v3_votes.sql`
5. `migration_v4_access_request_password.sql`
6. `migration_v5_resource_saves.sql`
7. `migration_v6_groups.sql`
8. `migration_v7_workspaces.sql`
9. `migration_v8_access_request_workspace.sql`

### 3) Backend Environment (`backend/.env`)

```env
# Required
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Runtime
PORT=3001
HEADLESS=true
# CHROME_PATH=/usr/bin/google-chrome

# Optional legacy fallback group from env (DB groups are preferred)
# TARGET_GROUP_ID=120363XXXXXXXXXXXX@g.us

# Admin bootstrap
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=change_this_password
ADMIN_RESET_PASSWORD_ON_START=false

# Access request crypto
ACCESS_REQUEST_SECRET=replace_with_long_random_secret

# Bot tuning
AUTH_TIMEOUT_MS=120000
QR_MAX_RETRIES=8
INIT_WARNING_TIMEOUT_MS=45000
HISTORY_SCAN_LIMIT=2000
GROUP_ADD_HISTORY_SCAN_LIMIT=0
HISTORY_SCAN_BATCH_SIZE=200
GROUP_MAPPING_REFRESH_MS=30000
TITLE_FETCH_TIMEOUT_MS=2000
RECENT_HASH_CACHE_SIZE=50000
PROCESS_SELF_MESSAGES=true
DEBUG_GROUP_MATCH=false
BLACKLIST_LOG_WINDOW_MS=600000

# SMTP (approval emails)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_gmail_16_char_app_password
SMTP_FROM="SharePulse Analytics <your_email@gmail.com>"

# Runtime ownership marker
APP_NAME="SharePulse Analytics"
APP_OWNER="Chirag Koyande"
APP_REPO_URL="https://github.com/chiragkoyande/SharePulse-Analytics"
# Optional fallback order: COMMIT_SHA -> GITHUB_SHA -> RENDER_GIT_COMMIT -> git rev-parse
# COMMIT_SHA=abc1234
# BUILD_DATE=2026-03-06T11:30:00.000Z
```

### Backend Env Quick Reference

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side DB/Auth admin access |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Initial super admin bootstrap |
| `ACCESS_REQUEST_SECRET` | Encrypt request-time password before approval |
| `PROCESS_SELF_MESSAGES` | Capture links sent by your own WhatsApp account |
| `DEBUG_GROUP_MATCH` | Extra bot logs for group matching and skip reasons |

### 4) Frontend Environment (`frontend/.env`)

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_API_URL=http://localhost:3001
```

### Frontend Env Quick Reference

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Browser-side Supabase URL |
| `VITE_SUPABASE_ANON_KEY` | Public Supabase anon key |
| `VITE_API_URL` | Backend API base URL |

### 5) Install + Run

```bash
# backend
cd backend
npm install
npm run dev

# frontend (new terminal)
cd ../frontend
npm install
npm run dev
```

Open: <http://localhost:5173>

## Deployment Notes

- Backend can run on Render/Railway/Fly with persistent env vars.
- Frontend can run on Vercel/Netlify with `VITE_API_URL` set to backend URL.
- Keep WhatsApp auth state directory (`.wwebjs_auth`) persistent when possible.
- In production, use process manager or platform auto-restart for backend service.

## API Overview

Base URL: `http://localhost:3001`

### Utility

- `GET /health`
- `GET /version`

### Auth

- `POST /auth/request-access`
- `POST /auth/login`

### Workspace

- `GET /workspaces`
- `POST /workspaces`
- `GET /workspaces/:workspace_id/members`
- `POST /workspaces/:workspace_id/members`
- `GET /workspaces/:workspace_id/groups`
- `POST /workspaces/:workspace_id/groups`

### Resource & Engagement

- `GET /resources?workspace_id=&sort=newest|popular&limit=&offset=`
- `GET /resources/search?q=&workspace_id=`
- `GET /stats?workspace_id=`
- `POST /vote`
- `GET /saved-links`
- `POST /save-link`
- `GET /export/csv?workspace_id=`
- `DELETE /resources/:id` (admin/super admin)

### Admin

- `GET /admin/requests?status=pending`
- `POST /admin/approve`
- `POST /admin/reject`
- `GET /admin/users?workspace_id=`
- `POST /admin/promote`
- `POST /admin/revoke`
- `POST /admin/rescan-history`

### Quick API Examples

```bash
# Check version marker
curl http://localhost:3001/version

# Queue rescan for a specific group (admin token required)
curl -X POST http://localhost:3001/admin/rescan-history \\
  -H \"Content-Type: application/json\" \\
  -H \"Authorization: Bearer <ADMIN_JWT>\" \\
  -d '{\"whatsapp_group_id\":\"120363XXXXXXXXXXXX@g.us\"}'
```

## Access Workflow

1. User submits access request from login page.
2. Admin reviews request in Admin panel.
3. Admin assigns/uses workspace and approves or rejects.
4. On approval: auth user + app user + workspace membership are ensured.
5. Optional approval email is sent via SMTP.

## WhatsApp Group Onboarding Checklist

1. Open WhatsApp Web account that receives target groups.
2. Add a workspace in Admin panel.
3. Add WhatsApp group ID to that workspace.
4. Wait for queue log (`history_scan` queued) or run `POST /admin/rescan-history`.
5. Confirm terminal shows monitored group and scan output.

### Group ID Format Tips

- Recommended format: `120363XXXXXXXXXXXX@g.us`
- If you paste only numeric part, backend normalizes to `@g.us`
- Group must be visible in the same WhatsApp account session used by the bot

## Dedup and Share Behavior

- Link hashing is URL-normalization based.
- Same URL in same workspace is treated as duplicate and share count can increase.
- Same URL across different workspaces is supported with workspace-aware hashing.
- Some domains are intentionally ignored by blacklist (for example LinkedIn by default).

## Runtime Log Meanings

- `✅ Saved` -> new resource inserted
- `⏭️ duplicate-same-workspace` -> same link already exists in that workspace
- `🔁 Share count +1` -> repeat share increased engagement
- `⛔ Blacklisted URL skipped` -> URL matches blocked domain list
- `⚠️ Could not find group` -> bot account cannot access that group id

## Troubleshooting

### `EADDRINUSE: address already in use :::3001`

Another process is already using port 3001.

```bash
lsof -ti :3001 | xargs -r kill -9
cd backend && npm run dev
```

### `Cannot GET /version`

Old backend process is running. Restart backend and retry.

### WhatsApp auth/browser lock errors

Use one session at a time or separate these vars:

- `WWEBJS_CLIENT_ID`
- `WWEBJS_DATA_PATH`

If session is broken, stop server and remove `.wwebjs_auth`, then re-authenticate.

### Links visible in terminal but not in dashboard

Common causes:

- Link is blacklisted
- Duplicate in same workspace (now counted as re-share)
- Frontend is on different workspace than where link was ingested

## FAQ

### Why are LinkedIn links not saved?
`linkedin.com` is blacklisted by default in `backend/utils/blacklist.js`.

### Why do I see duplicate logs?
If same URL is re-shared, dedupe logic skips creating a new row and updates engagement counters.

### Can one URL exist in multiple workspaces?
Yes. Workspace-aware hashing allows same normalized URL across different workspaces.

## Ownership Marker (`/version`)

```json
{
  "success": true,
  "ownership": {
    "appName": "SharePulse Analytics",
    "owner": "Chirag Koyande",
    "repoUrl": "https://github.com/chiragkoyande/SharePulse-Analytics",
    "commitSha": "abc1234",
    "buildDate": "2026-03-06T11:30:00.000Z"
  }
}
```

## Security Notes

- Never expose `SUPABASE_SERVICE_ROLE_KEY` in frontend.
- Keep all `.env` files out of Git.
- Use strong `ACCESS_REQUEST_SECRET`.
- Use SMTP app passwords, not normal mailbox passwords.

## Roadmap

- Better trust scoring and phishing hints
- Weekly top-links digest
- Better admin analytics and moderation actions
- Advanced filters and saved views

## Contributing

- Keep PRs focused (one feature/fix per PR).
- Include logs/screenshots for bug reports.
- Add migration notes if database schema changes.

## License

ISC
