# SharePulse Analytics

![Repo Stars](https://img.shields.io/github/stars/chiragkoyande/SharePulse-Analytics?style=for-the-badge)
![Last Commit](https://img.shields.io/github/last-commit/chiragkoyande/SharePulse-Analytics?style=for-the-badge)
![Issues](https://img.shields.io/github/issues/chiragkoyande/SharePulse-Analytics?style=for-the-badge)
![License](https://img.shields.io/badge/license-ISC-blue?style=for-the-badge)

SharePulse Analytics is a full-stack SaaS-style dashboard that monitors a WhatsApp group, extracts shared links, deduplicates and scores them, and gives admins a secure access workflow for team members.

## Why This Project
- Built for communities that share too many links and lose valuable resources in chat history.
- Turns noisy messages into a searchable, ranked, and saved knowledge feed.
- Includes admin approval workflow, user voting, and ownership marker endpoints for production-like operation.

Owner: [Chirag Koyande](https://github.com/chiragkoyande)  
Repository: <https://github.com/chiragkoyande/SharePulse-Analytics>

## Quick Start (Fastest Path)
```bash
git clone https://github.com/chiragkoyande/SharePulse-Analytics.git
cd SharePulse-Analytics
# then follow setup sections below for backend + frontend env and run
```

## Highlights
| Capability | What You Get |
|---|---|
| WhatsApp Ingestion | Real-time + startup history scan from one target group |
| Link Intelligence | URL hashing, dedup, title extraction, domain analytics |
| Team Workflow | Access requests, approve/reject, role promotion, revoke |
| Engagement Signals | Like/dislike voting and top-domain trend visibility |
| Personal Workflow | Save/unsave links + CSV export |
| Ownership Proof | `/version` and `/health` include runtime ownership marker |

## What It Does
- Monitors one target WhatsApp group in near real time.
- Scans message history on startup to backfill links.
- Extracts URL + domain + page title and stores normalized hashes.
- Prevents duplicates and tracks share/vote engagement.
- Provides role-based access flow (request, approve/reject, revoke, promote).
- Lets users save links and export data to CSV.
- Sends approval emails via SMTP (Gmail app-password friendly).

## Tech Stack
- Backend: Node.js, Express, `whatsapp-web.js`, Supabase JS
- Frontend: React + Vite
- Database/Auth: Supabase Postgres + Supabase Auth
- Mail: Nodemailer SMTP

## Architecture
```text
WhatsApp Group
   -> Bot ingestion (whatsapp-web.js)
   -> Supabase (resources, votes, saves, users, requests)
   -> Express API (auth/admin/resources/version)
   -> React Dashboard
```

## Product Snapshot
- Branded dashboard shell with quick admin actions.
- Top domains and popular links insights blocks.
- Searchable resource feed with vote/save actions.
- Request-access login flow for controlled onboarding.

## Repository Structure
```text
.
├── schema.sql
├── migration_v2.sql
├── migration_v3_auth.sql
├── migration_v3_votes.sql
├── migration_v4_access_request_password.sql
├── migration_v5_resource_saves.sql
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
- WhatsApp account for QR-linked session
- Chrome/Chromium available on machine (or Puppeteer-managed browser)

## 1) Database Setup (Supabase)
Run SQL files in this order from Supabase SQL Editor:

1. `schema.sql`
2. `migration_v2.sql`
3. `migration_v3_auth.sql`
4. `migration_v3_votes.sql`
5. `migration_v4_access_request_password.sql`
6. `migration_v5_resource_saves.sql`

## 2) Backend Setup
Create `backend/.env`:

```env
# Required
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
TARGET_GROUP_ID=120363XXXXXXXXXXXX@g.us

# Server
PORT=3001

# Admin bootstrap
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=change_this_password
ADMIN_RESET_PASSWORD_ON_START=false

# WhatsApp bot runtime
HEADLESS=true
# CHROME_PATH=/usr/bin/google-chrome
# WWEBJS_CLIENT_ID=default
# WWEBJS_DATA_PATH=./.wwebjs_auth
# AUTH_TIMEOUT_MS=120000
# QR_MAX_RETRIES=5
# INIT_WARNING_TIMEOUT_MS=45000
# HISTORY_SCAN_LIMIT=2000
# TITLE_FETCH_TIMEOUT_MS=2000
# RECENT_HASH_CACHE_SIZE=50000
# DEBUG_GROUP_MATCH=false

# SMTP (approval notification emails)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_16_char_gmail_app_password
SMTP_FROM="SharePulse Analytics <your_email@gmail.com>"

# Runtime ownership marker (/health and /version)
APP_NAME="SharePulse Analytics"
APP_OWNER="Chirag Koyande"
APP_REPO_URL="https://github.com/chiragkoyande/SharePulse-Analytics"
# Optional: auto fallback order is COMMIT_SHA -> GITHUB_SHA -> RENDER_GIT_COMMIT -> git rev-parse
COMMIT_SHA=70b6239
# Optional: defaults to server start timestamp
BUILD_DATE="2026-03-06T10:30:00.000Z"
```

Install and run backend:

```bash
cd backend
npm install
npm run dev
```

## 3) Frontend Setup
Create `frontend/.env`:

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_API_URL=http://localhost:3001
```

Install and run frontend:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## Access Workflow
1. User submits request from login page (`/auth/request-access`).
2. Admin reviews pending requests in Admin panel.
3. Admin approves (`/admin/approve`) or rejects.
4. On approval, Supabase auth account is created/updated, `app_users` status is activated, and an email is sent if SMTP is configured.
5. User signs in using requested email/password.

## API Reference

Base URL: `http://localhost:3001`

### Public / Utility
- `GET /health` -> server status + ownership metadata
- `GET /version` -> ownership marker object
- `GET /resources?sort=newest|popular&limit=100&offset=0`
- `GET /resources/search?q=keyword`
- `GET /stats`
- `GET /export/csv`

### Auth
- `POST /auth/request-access`
- `POST /auth/login`

### User (Bearer token required)
- `POST /vote` body: `{ "url_hash": "...", "vote": "like" | "dislike" }`
- `GET /saved-links`
- `POST /save-link` body: `{ "url_hash": "...", "save": true | false }`

### Admin (Bearer token + admin role required)
- `GET /admin/requests?status=pending`
- `POST /admin/approve` body: `{ "email": "user@example.com" }`
- `POST /admin/reject` body: `{ "email": "user@example.com" }`
- `GET /admin/users`
- `POST /admin/promote` body: `{ "email": "user@example.com" }`
- `POST /admin/revoke` body: `{ "email": "user@example.com" }`

## Ownership Marker Example
`GET /version`:

```json
{
  "success": true,
  "ownership": {
    "appName": "SharePulse Analytics",
    "owner": "Chirag Koyande",
    "repoUrl": "https://github.com/chiragkoyande/SharePulse-Analytics",
    "commitSha": "70b6239",
    "buildDate": "2026-03-05T23:21:13.323Z"
  }
}
```

## Troubleshooting

### `EADDRINUSE: address already in use :::3001`
Another backend is already running.

```bash
lsof -ti :3001 | xargs -r kill -9
cd backend && npm run dev
```

### `Cannot GET /version`
Usually old backend process is running. Restart backend and retry.

### WhatsApp init error: browser already running
Use one bot session at a time, or change:
- `WWEBJS_CLIENT_ID`
- `WWEBJS_DATA_PATH`

If session is corrupted, stop bot and remove `.wwebjs_auth`, then re-link QR.

### Approval email not sent
Check:
- `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` in `backend/.env`
- Gmail account has 2FA enabled
- `SMTP_PASS` is a Google app password (not normal Gmail password)

## Roadmap
- Multi-workspace support (separate groups per tenant).
- Better anti-phishing scoring and trust labels.
- Weekly digest emails with top resources.
- Domain watchlists and alerts.

## Support This Repo
- Star the repo to increase discovery.
- Open issues with reproducible logs and screenshots.
- Contribute focused PRs (one feature/fix per PR).

## Security and Privacy Notes
- Backend uses Supabase service role key; never expose it to frontend.
- Bot stores link-level analytics only; no raw chat payload persistence.
- Role checks enforce active users and admin-only routes.
- Keep `.env` files private and out of git.

## License
ISC
