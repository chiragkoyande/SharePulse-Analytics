# SharePulse Analytics

[![Stars](https://img.shields.io/github/stars/chiragkoyande/SharePulse-Analytics?style=for-the-badge)](https://github.com/chiragkoyande/SharePulse-Analytics/stargazers)
[![Last Commit](https://img.shields.io/github/last-commit/chiragkoyande/SharePulse-Analytics?style=for-the-badge)](https://github.com/chiragkoyande/SharePulse-Analytics/commits/main)
[![Issues](https://img.shields.io/github/issues/chiragkoyande/SharePulse-Analytics?style=for-the-badge)](https://github.com/chiragkoyande/SharePulse-Analytics/issues)
[![License](https://img.shields.io/badge/license-ISC-blue?style=for-the-badge)](./LICENSE)

Turn WhatsApp link chaos into a live intelligence feed.

SharePulse Analytics tracks links shared in WhatsApp groups, organizes them by workspace, and shows what content actually drives engagement.

## The Real Use Case

If your community drops 100+ links in chats every week, you lose valuable resources in scroll history.

SharePulse solves that by giving you:
- Automatic link capture from selected WhatsApp groups
- A clean dashboard of what was shared
- Engagement signals (votes, saves, share count)
- Workspace-level access control for teams

## Who It Is For

- Community admins running multiple WhatsApp groups
- Learning communities (cybersecurity, dev, design, startup)
- Internal teams using WhatsApp for resource sharing
- Founders building niche knowledge SaaS from chat data

## What Happens In 60 Seconds

1. Connect WhatsApp bot session.
2. Add workspace.
3. Map WhatsApp group to workspace.
4. Bot scans history + listens for new messages.
5. Dashboard shows ranked links, top domains, and engagement.

## Product Features

- Live WhatsApp ingestion (`message`, `message_create`)
- History backfill on startup and admin-triggered rescan
- Workspace-based group mapping
- Link dedupe with workspace-aware behavior
- Save links and vote (like/dislike)
- Admin approval flow with workspace assignment
- CSV export
- Ownership marker endpoints (`/health`, `/version`)

## Why It Feels Like SaaS

- Multi-workspace architecture
- Admin panel for members, requests, and groups
- Role model: `super_admin`, `owner`, `admin`, `member`
- Operational controls (rescan queue, health/version metadata)

## Architecture

```text
WhatsApp Groups
  -> Bot (whatsapp-web.js)
  -> URL extraction + hash + dedupe
  -> Supabase (resources, workspace tables, auth tables)
  -> Express API (auth/admin/workspaces/resources)
  -> React Dashboard (workspace-scoped views)
```

## Tech Stack

- Backend: Node.js, Express, whatsapp-web.js, Supabase JS
- Frontend: React + Vite
- Database/Auth: Supabase Postgres + Supabase Auth
- Email: SMTP (Nodemailer)

## Quick Start

```bash
git clone https://github.com/chiragkoyande/SharePulse-Analytics.git
cd SharePulse-Analytics
```

### 1) Run SQL migrations in Supabase

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

### 2) Configure backend env (`backend/.env`)

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
PORT=3001
HEADLESS=true

ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=change_this_password
ACCESS_REQUEST_SECRET=replace_with_long_secret

# Optional tuning
DEBUG_GROUP_MATCH=false
PROCESS_SELF_MESSAGES=true
```

### 3) Configure frontend env (`frontend/.env`)

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_API_URL=http://localhost:3001
```

### 4) Run app

```bash
cd backend && npm install && npm run dev
# new terminal
cd frontend && npm install && npm run dev
```

Open `http://localhost:5173`

## API Snapshot

- `POST /auth/request-access`
- `POST /auth/login`
- `GET /workspaces`
- `POST /workspaces/:workspace_id/groups`
- `GET /resources?workspace_id=`
- `POST /vote`
- `POST /save-link`
- `GET /admin/requests`
- `POST /admin/approve`
- `POST /admin/rescan-history`

## Common Issues

### Links seen in terminal but not dashboard
- You are viewing another workspace in UI
- Link is blacklisted (for example `linkedin.com` by default)
- Link already exists in same workspace (counted as re-share)

### Port already in use (`EADDRINUSE`)

```bash
lsof -ti :3001 | xargs -r kill -9
```

## Security Notes

- Never expose `SUPABASE_SERVICE_ROLE_KEY` to frontend
- Keep `.env` files private
- Use strong `ACCESS_REQUEST_SECRET`
- Use app-password for SMTP, not account password

## Owner

- Builder: [Chirag Koyande](https://github.com/chiragkoyande)
- Repo: <https://github.com/chiragkoyande/SharePulse-Analytics>

## License

ISC
