// ============================================
// WhatsApp Bot Module (v2 — Privacy-First)
// ============================================
// Monitors target group for URLs, scrapes
// metadata, saves resources to Supabase.
//
// DATA MINIMIZATION: This module does NOT
// store any personal user data — no phone
// numbers, sender names, or message payloads.
// ============================================

import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import { existsSync } from 'node:fs';
import fetch from 'node-fetch';
import { supabase } from './db.js';
import { extractUrls, extractDomain } from './utils/urlExtractor.js';
import { hashUrl } from './utils/urlHasher.js';
import { isBlacklisted } from './utils/blacklist.js';

const TARGET_GROUP_ID = process.env.TARGET_GROUP_ID;
const HEADLESS = process.env.HEADLESS !== 'false';
const CHROME_PATH = process.env.CHROME_PATH?.trim();
const WWEBJS_CLIENT_ID = process.env.WWEBJS_CLIENT_ID?.trim() || 'default';
const WWEBJS_DATA_PATH = process.env.WWEBJS_DATA_PATH?.trim() || './.wwebjs_auth';
const AUTH_TIMEOUT_MS = Number(process.env.AUTH_TIMEOUT_MS || 120000);
const QR_MAX_RETRIES = Number(process.env.QR_MAX_RETRIES || 5);
const INIT_WARNING_TIMEOUT_MS = Number(process.env.INIT_WARNING_TIMEOUT_MS || 45000);
const HISTORY_SCAN_LIMIT = Number(process.env.HISTORY_SCAN_LIMIT || 2000);
const TITLE_FETCH_TIMEOUT_MS = Number(process.env.TITLE_FETCH_TIMEOUT_MS || 2000);
const RECENT_HASH_CACHE_SIZE = Number(process.env.RECENT_HASH_CACHE_SIZE || 50000);
const DEBUG_GROUP_MATCH = process.env.DEBUG_GROUP_MATCH === 'true';
const SYSTEM_CHROME_CANDIDATES = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
];
const processedMessageIds = new Set();
const recentUrlHashes = new Set();
const recentUrlHashQueue = [];
let mismatchLogCount = 0;

function hasRecentHash(urlHash) {
    return recentUrlHashes.has(urlHash);
}

function markRecentHash(urlHash) {
    if (recentUrlHashes.has(urlHash)) return;
    recentUrlHashes.add(urlHash);
    recentUrlHashQueue.push(urlHash);

    if (recentUrlHashQueue.length > RECENT_HASH_CACHE_SIZE) {
        const oldest = recentUrlHashQueue.shift();
        if (oldest) recentUrlHashes.delete(oldest);
    }
}

function getPuppeteerOptions() {
    const options = {
        headless: HEADLESS,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--disable-gpu',
        ],
    };

    if (CHROME_PATH) {
        if (existsSync(CHROME_PATH)) {
            options.executablePath = CHROME_PATH;
            console.log(`   Browser: custom Chrome (${CHROME_PATH})`);
        } else {
            console.warn(`   ⚠️  CHROME_PATH not found: ${CHROME_PATH}`);
            console.warn('   ⚠️  Falling back to Puppeteer-managed browser.');
        }
    } else {
        const detectedChrome = SYSTEM_CHROME_CANDIDATES.find((path) => existsSync(path));
        if (detectedChrome) {
            options.executablePath = detectedChrome;
            console.log(`   Browser: auto-detected system Chrome (${detectedChrome})`);
        } else {
            console.log('   Browser: Puppeteer-managed (set CHROME_PATH to override)');
        }
    }

    return options;
}

// ── Page Title Scraper ───────────────────────

async function fetchPageTitle(url) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TITLE_FETCH_TIMEOUT_MS);

        const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResourceBot/1.0)' },
        });

        clearTimeout(timeoutId);
        const html = await response.text();
        const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);

        if (match && match[1]) {
            const title = match[1].trim();
            console.log(`  📄 Title scraped successfully`);
            return title || 'New Resource';
        }
        return 'New Resource';
    } catch (error) {
        const reason = error.name === 'AbortError' ? 'timeout' : 'fetch error';
        console.log(`  ⚠️  Title fetch failed (${reason})`);
        return 'New Resource';
    }
}

// ── Dedup Handler (Hash-Based) ───────────────

/**
 * Check if this URL hash already exists.
 * If yes, return true.
 * If no, return false (caller should insert).
 */
async function handleDedup(urlHash) {
    try {
        const { data, error } = await supabase
            .from('resources')
            .select('id')
            .eq('url_hash', urlHash)
            .limit(1);

        if (error) throw error;

        if (data && data.length > 0) {
            console.log(`  🔁 Duplicate detected — skipped insert (hash: ${urlHash.slice(0, 8)}…)`);
            return true;
        }

        return false;
    } catch (error) {
        console.error(`  ❌ Dedup check error: ${error.message}`);
        return false;
    }
}

// ── Save Resource ────────────────────────────

/**
 * Insert a new resource. Only stores:
 * url, url_hash, title, domain
 *
 * NO personal data is stored.
 */
async function saveResource({ url, urlHash, title, domain }) {
    try {
        const { error } = await supabase.from('resources').insert({
            url,
            url_hash: urlHash,
            title: title || 'New Resource',
            domain: domain || 'unknown',
        });

        if (error) {
            // Unique-constraint race safety if another worker inserts same hash first.
            if (error.code === '23505') {
                console.log(`  🔁 Duplicate detected — skipped insert (hash: ${urlHash.slice(0, 8)}…)`);
                return { saved: false, duplicate: true };
            }
            throw error;
        }

        console.log(`  ✅ Insert success (hash: ${urlHash.slice(0, 8)}…)`);
        return { saved: true, duplicate: false };
    } catch (error) {
        console.error(`  ❌ Insert error: ${error.message}`);
        return { saved: false, duplicate: false };
    }
}

// ── Message Handler ──────────────────────────

async function handleMessage(message, source = 'message') {
    if (message?.fromMe) return;
    const messageId = message?.id?._serialized;
    if (messageId) {
        if (processedMessageIds.has(messageId)) return;
        processedMessageIds.add(messageId);
        if (processedMessageIds.size > 5000) {
            const firstKey = processedMessageIds.values().next().value;
            processedMessageIds.delete(firstKey);
        }
    }

    const chat = await message.getChat();

    if (!chat.isGroup) return;
    if (chat.id._serialized !== TARGET_GROUP_ID) {
        if (DEBUG_GROUP_MATCH && mismatchLogCount < 5) {
            mismatchLogCount += 1;
            console.log(`ℹ️  Ignoring group ${chat.id._serialized} (target: ${TARGET_GROUP_ID})`);
        }
        return;
    }

    const body = message.body;
    if (!body) return;

    const urls = extractUrls(body);
    if (urls.length === 0) return;

    // DO NOT log sender info or message body
    console.log(`\n🔗 ${urls.length} link(s) detected in monitored group [${source}]`);

    for (const url of urls) {
        // Blacklist check
        if (isBlacklisted(url)) {
            console.log(`  🚫 Blacklisted domain — skipped`);
            continue;
        }

        const urlHash = hashUrl(url);
        console.log(`  📥 URL detected — hash: ${urlHash.slice(0, 8)}…`);

        // Fast local skip for links seen recently in this process.
        if (hasRecentHash(urlHash)) {
            console.log(`  🔁 Duplicate detected (cache) — skipped`);
            continue;
        }

        // DB dedup before title fetch keeps recognition fast for duplicates.
        const isDupe = await handleDedup(urlHash);
        if (isDupe) {
            markRecentHash(urlHash);
            continue;
        }

        const title = await fetchPageTitle(url);
        const domain = extractDomain(url);

        const result = await saveResource({ url, urlHash, title, domain });
        if (result.saved || result.duplicate) markRecentHash(urlHash);
    }
}

// ── Scan Historical Messages ─────────────────

/**
 * Fetches old messages from the target group and
 * saves any URLs found. Runs once on bot startup.
 *
 * NO personal data (sender, message body) is stored.
 */
async function scanHistory(client) {
    try {
        console.log('\n📜 Scanning old messages for links...');

        const chat = await client.getChatById(TARGET_GROUP_ID);
        if (!chat) {
            console.log('⚠️  Could not find target group for history scan.');
            return;
        }

        const messages = await chat.fetchMessages({ limit: HISTORY_SCAN_LIMIT });
        console.log(`   Found ${messages.length} messages to scan`);

        let savedCount = 0;
        let skipCount = 0;

        for (const message of messages) {
            const body = message.body;
            if (!body) continue;

            const urls = extractUrls(body);
            if (urls.length === 0) continue;

            for (const url of urls) {
                // Blacklist check
                if (isBlacklisted(url)) continue;

                const urlHash = hashUrl(url);

                if (hasRecentHash(urlHash)) {
                    skipCount++;
                    continue;
                }

                const isDupe = await handleDedup(urlHash);
                if (isDupe) {
                    markRecentHash(urlHash);
                    skipCount++;
                    continue;
                }

                const title = await fetchPageTitle(url);
                const domain = extractDomain(url);

                const result = await saveResource({ url, urlHash, title, domain });

                if (result.saved) {
                    savedCount++;
                    markRecentHash(urlHash);
                }
                if (result.duplicate) {
                    skipCount++;
                    markRecentHash(urlHash);
                }
            }
        }

        console.log(`\n📊 History scan complete!`);
        console.log(`   ✅ Saved: ${savedCount} new links`);
        console.log(`   ⏭️  Skipped: ${skipCount} duplicates\n`);
    } catch (error) {
        console.error('❌ History scan error:', error.message);
    }
}

// ── Start Bot ────────────────────────────────

export function startBot() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🤖 SharePulse Analytics Bot (v2)');
    console.log(`   Headless: ${HEADLESS}`);
    console.log(`   Privacy:  PII-free ingestion`);
    console.log(`   Target:   ${TARGET_GROUP_ID}`);
    console.log(`   History:  last ${HISTORY_SCAN_LIMIT} messages`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const client = new Client({
        authStrategy: new LocalAuth({
            clientId: WWEBJS_CLIENT_ID,
            dataPath: WWEBJS_DATA_PATH,
        }),
        authTimeoutMs: AUTH_TIMEOUT_MS,
        qrMaxRetries: QR_MAX_RETRIES,
        takeoverOnConflict: true,
        takeoverTimeoutMs: 0,
        puppeteer: getPuppeteerOptions(),
    });
    let initWarningTimer = null;

    client.on('qr', (qr) => {
        if (initWarningTimer) {
            clearTimeout(initWarningTimer);
            initWarningTimer = null;
        }
        console.log('\n📱 Scan this QR code with WhatsApp:\n');
        qrcode.generate(qr, { small: true });
    });

    client.on('loading_screen', (percent, message) => {
        console.log(`⏳ Loading WhatsApp Web: ${percent}% ${message || ''}`.trim());
    });

    client.on('authenticated', () => {
        if (initWarningTimer) {
            clearTimeout(initWarningTimer);
            initWarningTimer = null;
        }
        console.log('🔐 Authenticated with WhatsApp');
    });

    client.on('change_state', (state) => {
        console.log(`ℹ️  WA state: ${state}`);
    });

    client.on('ready', async () => {
        if (initWarningTimer) {
            clearTimeout(initWarningTimer);
            initWarningTimer = null;
        }
        console.log('\n✅ WhatsApp client is ready!');
        console.log('🔍 Monitoring target group for URLs...');

        // Scan old messages from the target group
        await scanHistory(client);

        console.log('⏳ Waiting for new messages with URLs...\n');
    });

    client.on('auth_failure', (msg) => {
        console.error('❌ Auth failure:', msg || 'Unknown reason');
    });

    client.on('disconnected', (reason) => {
        console.warn('⚠️  Disconnected — attempting reconnect in 5s');
        setTimeout(() => {
            client.initialize().catch((err) => console.error('❌ Reconnect failed'));
        }, 5000);
    });

    client.on('message', async (message) => {
        try {
            await handleMessage(message, 'message');
        } catch (error) {
            console.error('❌ Message processing error');
        }
    });

    client.on('message_create', async (message) => {
        try {
            await handleMessage(message, 'message_create');
        } catch (error) {
            console.error('❌ Message processing error');
        }
    });

    console.log('\n🚀 Initializing WhatsApp client...\n');
    initWarningTimer = setTimeout(() => {
        console.warn(`⚠️  Initialization is taking longer than ${INIT_WARNING_TIMEOUT_MS / 1000}s.`);
        console.warn('   If QR is not visible: set HEADLESS=true and scan QR from terminal.');
        console.warn('   If still stuck: delete .wwebjs_auth and re-authenticate once.');
    }, INIT_WARNING_TIMEOUT_MS);

    client.initialize().catch((err) => {
        if (initWarningTimer) {
            clearTimeout(initWarningTimer);
            initWarningTimer = null;
        }
        console.error('❌ Fatal: Could not initialize bot');
        console.error(`   Reason: ${err?.message || err}`);
        console.error('   Tips:');
        console.error('   1) Ensure Chrome is installed or unset CHROME_PATH to use Puppeteer-managed browser');
        console.error('   2) Set HEADLESS=true to print QR in terminal if UI launch fails');
        console.error('   3) Delete .wwebjs_auth if session is corrupted, then re-authenticate');
    });

    return client;
}

// ── Placeholders ─────────────────────────────
export async function generateSummary(_text) { return null; }
export async function detectPhishing(_url) { return false; }
