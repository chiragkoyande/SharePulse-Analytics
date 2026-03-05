// ============================================
// Server Entry Point
// ============================================

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { testConnection, supabase } from './db.js';
import resourceRoutes from './routes/resources.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import { startBot } from './bot.js';

const app = express();
const PORT = process.env.PORT || 3001;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_RESET_PASSWORD_ON_START = process.env.ADMIN_RESET_PASSWORD_ON_START === 'true';

// ── Middleware ────────────────────────────────

app.use(cors());
app.use(express.json());

app.use((req, _res, next) => {
    if (req.path !== '/health') console.log(`→ ${req.method} ${req.path}`);
    next();
});

// ── Routes ───────────────────────────────────

app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/', authRoutes);
app.use('/admin', adminRoutes);
app.use('/', resourceRoutes);

// ── Error Handler ────────────────────────────

app.use((err, _req, res, _next) => {
    console.error('❌ API Error:', err.message);
    res.status(err.status || 500).json({ success: false, error: err.message });
});

// ── Seed First Admin ─────────────────────────

async function seedAdmin() {
    if (!ADMIN_EMAIL) {
        console.log('ℹ️  No ADMIN_EMAIL set — skip admin seeding.');
        return;
    }

    const email = ADMIN_EMAIL.toLowerCase().trim();
    // Ensure admin exists in app_users
    const { error: appErr } = await supabase
        .from('app_users')
        .upsert({ email, role: 'admin', status: 'active' }, { onConflict: 'email' });
    if (appErr) {
        console.error(`❌ Could not upsert admin in app_users: ${appErr.message}`);
        return;
    }

    // Ensure admin exists in Supabase Auth
    const { data: userList, error: listErr } = await supabase.auth.admin.listUsers();
    if (listErr) {
        console.error(`❌ Could not list auth users: ${listErr.message}`);
        return;
    }

    const existingAuthUser = userList?.users?.find((u) => u.email?.toLowerCase() === email);

    if (!existingAuthUser) {
        const { error: authErr } = await supabase.auth.admin.createUser({
            email,
            password: ADMIN_PASSWORD,
            email_confirm: true,
        });
        if (authErr) {
            console.error(`❌ Could not create admin auth user: ${authErr.message}`);
            return;
        }
        console.log(`🔑 Admin auth user created: ${email}`);
        return;
    }

    if (ADMIN_RESET_PASSWORD_ON_START) {
        const { error: resetErr } = await supabase.auth.admin.updateUserById(existingAuthUser.id, {
            password: ADMIN_PASSWORD,
        });
        if (resetErr) {
            console.error(`❌ Could not reset admin password: ${resetErr.message}`);
            return;
        }
        console.log(`🔐 Admin password reset on startup for: ${email}`);
    } else {
        console.log(`✅ Admin exists: ${email}`);
    }
}

// ── Startup ──────────────────────────────────

async function start() {
    const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'TARGET_GROUP_ID'];
    const missing = required.filter((k) => !process.env[k]);

    if (missing.length > 0) {
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error('❌ Missing environment variables:');
        missing.forEach((k) => console.error(`   • ${k}`));
        console.error('\n📝 Copy .env.example → .env and fill in values.');
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        process.exit(1);
    }

    const dbOk = await testConnection();
    if (!dbOk) {
        console.error('❌ Cannot start without database. Exiting.');
        process.exit(1);
    }

    // Seed first admin
    await seedAdmin();

    app.listen(PORT, () => {
        console.log(`\n🌐 API server running at http://localhost:${PORT}`);
        console.log('   GET  /health');
        console.log('   POST /auth/request-access');
        console.log('   POST /auth/login');
        console.log('   GET  /admin/requests');
        console.log('   POST /admin/approve');
        console.log('   GET  /admin/users');
        console.log('   GET  /resources');
        console.log('   POST /vote');
        console.log('   GET  /saved-links');
        console.log('   POST /save-link');
        console.log('   GET  /export/csv');
    });

    let client;
    try {
        client = startBot();
    } catch (err) {
        console.error('⚠️  Bot failed to start (API server still running):', err.message);
    }

    // Prevent unhandled rejections from crashing the server
    process.on('unhandledRejection', (err) => {
        console.error('⚠️  Unhandled rejection:', err?.message || err);
    });

    const shutdown = async () => {
        console.log('\n🛑 Shutting down...');
        try { if (client) await client.destroy(); } catch { /* ignore */ }
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

start();
