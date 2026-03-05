# 🔗 SharePulse Analytics

A full-stack system that monitors a specific WhatsApp group, automatically extracts URLs from messages, scrapes page titles, and displays everything in a beautiful React dashboard.

**Made by [Chirag Koyande](https://github.com/chirag-koyande)**

---

## ✨ Features

- 📱 **WhatsApp Monitoring** — Connects via QR scan, monitors a specific group
- 📜 **Historical Scan** — Fetches last 500 messages and extracts all existing URLs on startup
- 🔗 **URL Extraction** — Robust regex-based detection, supports multiple URLs per message
- 📄 **Auto Title Scraping** — Fetches `<title>` tag from each URL (5s timeout)
- ⏭️ **Duplicate Detection** — Database-level dedup, skips already-saved URLs
- 🔍 **Search** — Filter by URL, title, or sender name
- 📊 **Stats Dashboard** — Total resources, today's count, top domains, duplicates
- 🔖 **Saved Links** — Users can save/unsave links for quick revisit
- 📧 **Approval Email Notification** — Users get an email when admin approves access
- 🌙 **Dark/Light Mode** — Theme toggle with localStorage persistence
- 📱 **Responsive** — Desktop table view + mobile card layout

---

## 🏗️ Architecture

```
WhatsApp Group
      ↓
Node.js Bot (whatsapp-web.js + Puppeteer)
      ↓
Supabase (PostgreSQL)
      ↓
Express REST API
      ↓
React Dashboard (Vite)
```

---

## 📁 Project Structure

```
├── schema.sql                     # Database setup script
├── backend/
│   ├── package.json
│   ├── .env.example               # Environment template
│   ├── index.js                   # Express server entry point
│   ├── bot.js                     # WhatsApp bot + history scanner
│   ├── db.js                      # Supabase client
│   ├── routes/
│   │   └── resources.js           # REST API endpoints
│   └── utils/
│       └── urlExtractor.js        # URL regex extraction
└── frontend/
    ├── package.json
    ├── .env.example
    ├── vite.config.js             # Vite config with API proxy
    ├── index.html
    └── src/
        ├── App.jsx                # Main dashboard
        ├── api.js                 # Axios API client
        ├── index.css              # Design system (light/dark)
        ├── main.jsx
        └── components/
            ├── StatsCard.jsx
            ├── SearchBar.jsx
            └── ResourceTable.jsx
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** v18+ ([download](https://nodejs.org))
- **Google Chrome/Chromium** (optional if Puppeteer-managed browser is used)
- **WhatsApp** account with an active phone
- **Supabase** account ([sign up free](https://supabase.com))

---

### Step 1: Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/jod_anlyzer.git
cd jod_anlyzer
```

---

### Step 2: Create the Supabase Database

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard)
2. Create a new project (free tier works)
3. Go to **SQL Editor** → **New Query**
4. Paste the contents of `schema.sql` and click **Run**:

```sql
CREATE TABLE resources (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT DEFAULT 'New Resource',
  context TEXT,
  sender TEXT DEFAULT 'Unknown',
  group_name TEXT DEFAULT 'Unknown Group',
  created_at TIMESTAMPTZ DEFAULT now(),
  is_duplicate BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_resources_url ON resources (url);
CREATE INDEX IF NOT EXISTS idx_resources_created_at ON resources (created_at DESC);

ALTER TABLE resources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read" ON resources FOR SELECT USING (true);
CREATE POLICY "Allow service insert" ON resources FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service update" ON resources FOR UPDATE USING (true);
```

---

### Step 3: Configure Backend

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env` with your values:

```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
TARGET_GROUP_ID=temp
PORT=3001
HEADLESS=false
# Optional: only set if you want to force a specific Chrome binary
# CHROME_PATH=/usr/bin/google-chrome
# Optional: Gmail SMTP app password (for approval notification emails)
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=465
# SMTP_SECURE=true
# SMTP_USER=your_email@gmail.com
# SMTP_PASS=your_16_char_app_password
# SMTP_FROM="SharePulse Analytics <your_email@gmail.com>"
```

**Where to find Supabase keys:**
- Go to **Settings** → **API** in your Supabase dashboard
- **Project URL** → `SUPABASE_URL`
- **service_role key** (under Project API keys) → `SUPABASE_SERVICE_ROLE_KEY`

---

### Step 4: Install & Run Backend

```bash
cd backend
npm install
npm start
```

> If you set `PUPPETEER_SKIP_DOWNLOAD=true`, you must have a valid Chrome binary and set `CHROME_PATH` correctly.

---

### Step 5: Connect WhatsApp

1. If `HEADLESS=false`, a controlled browser window opens for QR scan. If `HEADLESS=true`, QR prints in terminal.
2. On your phone: **WhatsApp → Settings → Linked Devices → Link a Device**
3. Scan the QR code
4. Wait for `✅ WhatsApp client is ready!` in the terminal

> Note: `whatsapp-web.js` controls its own Puppeteer browser session. It cannot attach to your already-open personal Chrome/WhatsApp tab.

---

### Step 6: Find Your Group ID

After connecting, send a message in **any WhatsApp group**. The console will print:

```
📋 Group: "Your Group Name" → 120363XXXXXXXXXX@g.us
```

Copy the ID (ending in `@g.us`) and update `backend/.env`:

```env
TARGET_GROUP_ID=120363XXXXXXXXXX@g.us
```

Then restart the backend (`Ctrl+C` then `npm start`).

---

### Step 7: Configure & Run Frontend

Open a **new terminal**:

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Open **http://localhost:5173** in your browser 🎉

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Server health check |
| GET | `/resources` | All resources (newest first) |
| GET | `/resources?limit=50&offset=0` | Paginated resources |
| GET | `/resources/search?q=github` | Search by URL, title, or sender |
| GET | `/stats` | Total, duplicates, today's count, top 5 domains |
| GET | `/saved-links` | Current user's saved link hashes (auth required) |
| POST | `/save-link` | Save/unsave a link for current user (auth required) |

---

## 🛡️ Security Notes

- All secrets are stored in `.env` files (never committed to Git)
- `SUPABASE_SERVICE_ROLE_KEY` is **backend only** — never exposed to frontend
- SQL queries use Supabase client (parameterized, no injection risk)
- `.gitignore` excludes `.env`, `node_modules`, and WhatsApp session data

---

## 🧩 Advanced Features (Placeholders)

The codebase includes placeholder functions for:

- 🤖 `generateSummary()` — AI-powered link summarization (OpenAI/Gemini)
- 🛡️ `detectPhishing()` — Malicious URL detection (Google Safe Browsing)
- 📊 Multi-group support
- 📈 Weekly analytics

---

## 📄 License

ISC

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request
