import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import { existsSync } from 'node:fs';
import fetch from 'node-fetch';
import { supabase } from './db.js';
import { extractUrls, extractDomain } from './utils/urlExtractor.js';
import { hashUrl, hashUrlForWorkspace } from './utils/urlHasher.js';
import { isBlacklisted } from './utils/blacklist.js';

const HEADLESS = process.env.HEADLESS !== 'false';
const CHROME_PATH = process.env.CHROME_PATH?.trim();
const WWEBJS_CLIENT_ID = process.env.WWEBJS_CLIENT_ID?.trim() || 'default';
const WWEBJS_DATA_PATH = process.env.WWEBJS_DATA_PATH?.trim() || './.wwebjs_auth';
const AUTH_TIMEOUT_MS = Number(process.env.AUTH_TIMEOUT_MS || 120000);
const QR_MAX_RETRIES = Number(process.env.QR_MAX_RETRIES || 5);
const INIT_WARNING_TIMEOUT_MS = Number(process.env.INIT_WARNING_TIMEOUT_MS || 45000);
const HISTORY_SCAN_LIMIT = Number(process.env.HISTORY_SCAN_LIMIT || 2000);
const GROUP_ADD_HISTORY_SCAN_LIMIT = Number(process.env.GROUP_ADD_HISTORY_SCAN_LIMIT || 0); // 0 = scan all
const TITLE_FETCH_TIMEOUT_MS = Number(process.env.TITLE_FETCH_TIMEOUT_MS || 2000);
const RECENT_HASH_CACHE_SIZE = Number(process.env.RECENT_HASH_CACHE_SIZE || 50000);
const DEBUG_GROUP_MATCH = process.env.DEBUG_GROUP_MATCH === 'true';
const HISTORY_SCAN_BATCH_SIZE = Number(process.env.HISTORY_SCAN_BATCH_SIZE || 200);
const GROUP_MAPPING_REFRESH_MS = Number(process.env.GROUP_MAPPING_REFRESH_MS || 30000);
const PROCESS_SELF_MESSAGES = process.env.PROCESS_SELF_MESSAGES !== 'false';
const BLACKLIST_LOG_WINDOW_MS = Number(process.env.BLACKLIST_LOG_WINDOW_MS || 600000); // 10 min
const SYSTEM_CHROME_CANDIDATES = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
];
const processedMessageIds = new Set();
const recentUrlHashes = new Set();
const recentUrlHashQueue = [];
const blacklistedLogTimestamps = new Map();
let mismatchLogCount = 0;

// Map: whatsappGroupId -> workspace_id (UUID)
let groupWorkspaceMap = new Map();
// Set of all monitored WhatsApp group IDs
let targetGroupSet = new Set();
let mappingRefreshTimer = null;
let activeClient = null;
let historyScanInProgress = false;
const pendingGroupHistoryScans = new Set();
let pendingScanRetryTimer = null;

function normalizeWhatsAppGroupId(rawId) {
    const value = String(rawId || '').trim();
    if (!value) return '';
    if (value.includes('@')) return value;
    return `${value}@g.us`;
}

function schedulePendingGroupHistoryScans(delayMs = 750) {
    if (pendingScanRetryTimer) clearTimeout(pendingScanRetryTimer);
    pendingScanRetryTimer = setTimeout(() => {
        processPendingGroupHistoryScans().catch((err) => {
            console.error(`❌ Queued group history scan failed: ${err.message}`);
        });
    }, delayMs);
}

function collectMessageUrls(message) {
    const sources = [
        message?.body,
        message?.caption,
        message?.description,
    ].filter((v) => typeof v === 'string' && v.trim().length > 0);

    const combinedText = sources.join('\n');
    const urlsFromText = extractUrls(combinedText);

    const urlsFromNative = Array.isArray(message?.links)
        ? message.links
            .map((entry) => {
                if (typeof entry === 'string') return entry;
                if (entry && typeof entry === 'object') return entry.link || entry.url || '';
                return '';
            })
            .filter(Boolean)
        : [];

    return [...new Set([...urlsFromText, ...urlsFromNative])];
}

/**
 * Load group→workspace mapping from workspace_groups table.
 * Only loads active groups.
 */
async function loadGroupMapping() {
    try {
        const prevTargets = new Set(targetGroupSet);
        const prevTargetSize = targetGroupSet.size;
        const prevMappedSize = groupWorkspaceMap.size;

        const { data, error } = await supabase
            .from('workspace_groups')
            .select('whatsapp_group_id, workspace_id, name, status')
            .eq('status', 'active');

        if (error) {
            console.warn('⚠️  Could not load workspace group mapping:', error.message);
            return;
        }

        groupWorkspaceMap = new Map();
        targetGroupSet = new Set();

        for (const wg of (data || [])) {
            const normalizedGroupId = normalizeWhatsAppGroupId(wg.whatsapp_group_id);
            if (normalizedGroupId) {
                groupWorkspaceMap.set(normalizedGroupId, wg.workspace_id);
                targetGroupSet.add(normalizedGroupId);
                console.log(`   📂 Workspace group: "${wg.name}" → ${normalizedGroupId}`);
            }
        }

        // Fallback: also check env for TARGET_GROUP_ID(S) not yet in DB
        const envIds = [];
        if (process.env.TARGET_GROUP_IDS) {
            envIds.push(...process.env.TARGET_GROUP_IDS.split(',').map(s => s.trim()).filter(Boolean));
        } else if (process.env.TARGET_GROUP_ID) {
            envIds.push(process.env.TARGET_GROUP_ID.trim());
        }

        for (const envGroupId of envIds) {
            const normalizedGroupId = normalizeWhatsAppGroupId(envGroupId);
            if (!normalizedGroupId) continue;
            if (!targetGroupSet.has(normalizedGroupId)) {
                targetGroupSet.add(normalizedGroupId);
                // No workspace mapping — resources will have workspace_id = null
                console.log(`   📂 Env group (no workspace): ${normalizedGroupId}`);
            }
        }

        const changed = prevTargetSize !== targetGroupSet.size || prevMappedSize !== groupWorkspaceMap.size;
        if (changed || DEBUG_GROUP_MATCH) {
            console.log(`   ✅ ${targetGroupSet.size} group(s) monitored, ${groupWorkspaceMap.size} mapped to workspaces`);
        }

        // Queue automatic backfill for newly seen groups while bot is running.
        if (activeClient) {
            for (const groupId of targetGroupSet) {
                if (!prevTargets.has(groupId)) {
                    pendingGroupHistoryScans.add(groupId);
                }
            }
            if (pendingGroupHistoryScans.size > 0) {
                schedulePendingGroupHistoryScans(250);
            }
        }
    } catch (err) {
        console.error('❌ loadGroupMapping error:', err.message);
    }
}

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

function shouldLogBlacklisted(url) {
    const key = hashUrl(url);
    const now = Date.now();
    const last = blacklistedLogTimestamps.get(key) || 0;
    if (now - last < BLACKLIST_LOG_WINDOW_MS) return false;
    blacklistedLogTimestamps.set(key, now);
    if (blacklistedLogTimestamps.size > 10000) {
        const cutoff = now - BLACKLIST_LOG_WINDOW_MS;
        for (const [k, ts] of blacklistedLogTimestamps.entries()) {
            if (ts < cutoff) blacklistedLogTimestamps.delete(k);
        }
    }
    return true;
}

function getPuppeteerOptions() {
    const options = {
        headless: HEADLESS,
        args: [
            '--no-sandbox', '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas',
            '--no-first-run', '--disable-gpu',
        ],
    };
    if (CHROME_PATH) {
        if (existsSync(CHROME_PATH)) {
            options.executablePath = CHROME_PATH;
            console.log(`   Browser: custom Chrome (${CHROME_PATH})`);
        } else {
            console.warn(`   ⚠️  CHROME_PATH not found: ${CHROME_PATH}`);
        }
    } else {
        const found = SYSTEM_CHROME_CANDIDATES.find((p) => existsSync(p));
        if (found) {
            options.executablePath = found;
            console.log(`   Browser: auto-detected (${found})`);
        } else {
            console.log('   Browser: Puppeteer-managed');
        }
    }
    return options;
}

async function fetchPageTitle(url) {
    try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), TITLE_FETCH_TIMEOUT_MS);
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResourceBot/1.0)' },
        });
        clearTimeout(t);
        const html = await response.text();
        const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
        if (match && match[1]) return match[1].trim() || 'New Resource';
        return 'New Resource';
    } catch {
        return 'New Resource';
    }
}

async function resolveResourceHash({ legacyHash, scopedHash, workspaceId }) {
    try {
        const hashes = [...new Set([legacyHash, scopedHash])];
        const { data, error } = await supabase
            .from('resources')
            .select('id, workspace_id, url_hash, share_count')
            .in('url_hash', hashes)
            .limit(5);
        if (error) throw error;
        if (!data || data.length === 0) {
            return { skip: false, hashToUse: scopedHash, reason: 'new', existing: null };
        }

        // If this URL existed before workspace rollout (workspace_id=null),
        // bind it to the current workspace when we see it again from that group.
        const existingForWorkspace = data.find((row) => row.workspace_id === workspaceId);
        if (workspaceId && existingForWorkspace) {
            return {
                skip: true,
                hashToUse: existingForWorkspace.url_hash,
                reason: 'duplicate-same-workspace',
                existing: existingForWorkspace,
            };
        }

        const legacyUnmapped = data.find((row) => !row.workspace_id && row.url_hash === legacyHash);
        if (workspaceId && legacyUnmapped) {
            const { error: adoptErr } = await supabase
                .from('resources')
                .update({ workspace_id: workspaceId })
                .eq('id', legacyUnmapped.id);
            if (!adoptErr) {
                console.log(`  🔁 Existing legacy link mapped to workspace (hash: ${legacyHash.slice(0, 8)}…)`);
            }
            return {
                skip: true,
                hashToUse: legacyHash,
                reason: 'adopted-legacy',
                existing: legacyUnmapped,
            };
        }

        if (workspaceId) {
            const existsInOtherWorkspace = data.some((row) => row.workspace_id && row.workspace_id !== workspaceId);
            if (existsInOtherWorkspace) {
                // Allow same URL in another workspace by using workspace-aware hash.
                const alreadyScoped = data.find((row) => row.url_hash === scopedHash);
                if (alreadyScoped) {
                    return {
                        skip: true,
                        hashToUse: scopedHash,
                        reason: 'duplicate-workspace-hash',
                        existing: alreadyScoped,
                    };
                }
                return { skip: false, hashToUse: scopedHash, reason: 'cross-workspace-new', existing: null };
            }
        }

        // Non-workspace (env/unmapped) fallback keeps legacy global dedupe.
        return { skip: true, hashToUse: legacyHash, reason: 'duplicate-legacy', existing: data[0] || null };
    } catch (error) {
        console.error(`  ❌ Dedup check failed (legacy:${legacyHash.slice(0, 8)}…): ${error.message}`);
        return { skip: false, hashToUse: scopedHash, reason: 'dedup-error-continue', existing: null };
    }
}

async function bumpShareCount(existing, reason) {
    if (!existing?.id) return;
    const current = Number(existing.share_count || 1);
    const next = current + 1;
    const { error } = await supabase
        .from('resources')
        .update({ share_count: next })
        .eq('id', existing.id);
    if (error) {
        console.error(`  ❌ Share count update failed (${reason}): ${error.message}`);
        return;
    }
    if (DEBUG_GROUP_MATCH) {
        console.log(`  🔁 Share count +1 (${reason}): ${next}`);
    }
}

async function saveResourceToDB({ url, urlHash, title, domain, workspaceId }) {
    try {
        const insertData = {
            url,
            url_hash: urlHash,
            title: title || 'New Resource',
            domain: domain || 'unknown',
        };
        if (workspaceId) insertData.workspace_id = workspaceId;

        const { error } = await supabase.from('resources').insert(insertData);
        if (error) {
            if (error.code === '23505') return { saved: false, duplicate: true };
            throw error;
        }
        console.log(`  ✅ Saved (hash: ${urlHash.slice(0, 8)}…, ws: ${workspaceId || 'none'})`);
        return { saved: true, duplicate: false };
    } catch (error) {
        console.error(`  ❌ Insert error: ${error.message}`);
        return { saved: false, duplicate: false };
    }
}

async function handleMessage(message, source = 'message') {
    const messageId = message?.id?._serialized;
    if (messageId) {
        if (processedMessageIds.has(messageId)) return;
        processedMessageIds.add(messageId);
        if (processedMessageIds.size > 5000) {
            processedMessageIds.delete(processedMessageIds.values().next().value);
        }
    }

    const chat = await message.getChat();
    if (!chat.isGroup) return;

    const chatGroupId = normalizeWhatsAppGroupId(chat.id?._serialized);
    if (message?.fromMe && !PROCESS_SELF_MESSAGES) {
        if (DEBUG_GROUP_MATCH) {
            console.log(`ℹ️  Self message in group ${chatGroupId} (skipped)`);
        }
        return;
    }

    if (!targetGroupSet.has(chatGroupId)) {
        if (DEBUG_GROUP_MATCH && mismatchLogCount < 5) {
            mismatchLogCount++;
            console.log(`ℹ️  Ignoring group ${chatGroupId} (not monitored)`);
        }
        return;
    }

    const workspaceId = groupWorkspaceMap.get(chatGroupId) || null;
    const urls = collectMessageUrls(message);
    if (urls.length === 0) return;

    console.log(`\n🔗 ${urls.length} link(s) in ${chatGroupId.slice(0, 12)}… [${source}]`);

    for (const url of urls) {
        if (isBlacklisted(url)) {
            if (DEBUG_GROUP_MATCH && shouldLogBlacklisted(url)) {
                console.log(`  ⛔ Blacklisted URL skipped: ${url}`);
            }
            continue;
        }
        const legacyHash = hashUrl(url);
        const scopedHash = hashUrlForWorkspace(url, workspaceId);
        if (hasRecentHash(scopedHash) || hasRecentHash(legacyHash)) {
            if (DEBUG_GROUP_MATCH) console.log(`  ⏭️  Recent cache skip: ${legacyHash.slice(0, 8)}…`);
            continue;
        }

        const dedup = await resolveResourceHash({ legacyHash, scopedHash, workspaceId });
        if (dedup.skip) {
            if (dedup.reason === 'duplicate-same-workspace' || dedup.reason === 'adopted-legacy' || dedup.reason === 'duplicate-legacy') {
                await bumpShareCount(dedup.existing, dedup.reason);
            }
            if (DEBUG_GROUP_MATCH) console.log(`  ⏭️  ${dedup.reason}: ${dedup.hashToUse.slice(0, 8)}…`);
            markRecentHash(dedup.hashToUse);
            continue;
        }

        const title = await fetchPageTitle(url);
        const domain = extractDomain(url);
        const result = await saveResourceToDB({ url, urlHash: dedup.hashToUse, title, domain, workspaceId });
        if (result.saved || result.duplicate) markRecentHash(dedup.hashToUse);
    }
}

async function scanHistoryForGroup(client, targetGroupId, reason = 'startup') {
    const normalizedGroupId = normalizeWhatsAppGroupId(targetGroupId);
    if (!normalizedGroupId) return;
    const workspaceId = groupWorkspaceMap.get(normalizedGroupId) || null;
    const effectiveLimit = reason === 'admin-add'
        ? GROUP_ADD_HISTORY_SCAN_LIMIT
        : HISTORY_SCAN_LIMIT;
    const limitLabel = effectiveLimit > 0 ? effectiveLimit : 'all';

    console.log(`\n  📂 Scanning: ${normalizedGroupId.slice(0, 12)}… (workspace: ${workspaceId || 'unmapped'}, reason: ${reason}, limit: ${limitLabel})`);

    let chat;
    try { chat = await client.getChatById(normalizedGroupId); }
    catch { console.log('  ⚠️  Could not find group'); return; }
    if (!chat) return;

    let saved = 0;
    let skipped = 0;
    let scannedMessages = 0;
    let beforeMsgId = null;

    // Scan in batches so recent links are consistently covered even with large history.
    while (effectiveLimit <= 0 || scannedMessages < effectiveLimit) {
        const remaining = effectiveLimit > 0 ? (effectiveLimit - scannedMessages) : HISTORY_SCAN_BATCH_SIZE;
        const batchLimit = Math.min(HISTORY_SCAN_BATCH_SIZE, remaining);
        const options = beforeMsgId ? { limit: batchLimit, before: beforeMsgId } : { limit: batchLimit };
        const messages = await chat.fetchMessages(options);
        if (!messages || messages.length === 0) break;

        for (const msg of messages) {
            scannedMessages++;
            beforeMsgId = msg?.id?._serialized || beforeMsgId;
            const urls = collectMessageUrls(msg);
            if (urls.length === 0) continue;

            for (const url of urls) {
                if (isBlacklisted(url)) {
                    if (DEBUG_GROUP_MATCH && shouldLogBlacklisted(url)) {
                        console.log(`   ⛔ Blacklisted URL skipped: ${url}`);
                    }
                    continue;
                }
                const legacyHash = hashUrl(url);
                const scopedHash = hashUrlForWorkspace(url, workspaceId);
                if (hasRecentHash(scopedHash) || hasRecentHash(legacyHash)) { skipped++; continue; }

                const dedup = await resolveResourceHash({ legacyHash, scopedHash, workspaceId });
                if (dedup.skip) {
                    if (dedup.reason === 'duplicate-same-workspace' || dedup.reason === 'adopted-legacy' || dedup.reason === 'duplicate-legacy') {
                        await bumpShareCount(dedup.existing, dedup.reason);
                    }
                    markRecentHash(dedup.hashToUse);
                    skipped++;
                    continue;
                }
                const title = await fetchPageTitle(url);
                const domain = extractDomain(url);
                const result = await saveResourceToDB({ url, urlHash: dedup.hashToUse, title, domain, workspaceId });
                if (result.saved) { saved++; markRecentHash(dedup.hashToUse); }
                if (result.duplicate) { skipped++; markRecentHash(dedup.hashToUse); }
            }
        }

        if (messages.length < batchLimit) break;
    }

    if (scannedMessages === 0) {
        console.log('   ℹ️  No messages returned from WhatsApp history API');
        return;
    }

    if (DEBUG_GROUP_MATCH) {
        console.log(`   ℹ️  Scanned messages: ${scannedMessages}`);
    }

    console.log(`   ✅ ${saved} new, ⏭️ ${skipped} skipped`);
}

async function scanHistory(client) {
    historyScanInProgress = true;
    console.log('\n📜 Scanning old messages for links...');
    for (const targetGroupId of targetGroupSet) {
        await scanHistoryForGroup(client, targetGroupId, 'startup');
    }
    console.log(`\n📊 History scan complete!\n`);
    historyScanInProgress = false;
}

async function processPendingGroupHistoryScans() {
    if (!activeClient || pendingGroupHistoryScans.size === 0) return;

    if (historyScanInProgress) {
        schedulePendingGroupHistoryScans(2000);
        return;
    }

    historyScanInProgress = true;
    try {
        await loadGroupMapping();
        const queue = [...pendingGroupHistoryScans];
        pendingGroupHistoryScans.clear();

        for (const groupId of queue) {
            const normalizedGroupId = normalizeWhatsAppGroupId(groupId);
            if (!normalizedGroupId || !targetGroupSet.has(normalizedGroupId)) {
                console.log(`⚠️  Group ${groupId} is not active in workspace_groups/env; skip queued scan`);
                continue;
            }
            await scanHistoryForGroup(activeClient, normalizedGroupId, 'admin-add');
        }
    } finally {
        historyScanInProgress = false;
        if (pendingGroupHistoryScans.size > 0) {
            schedulePendingGroupHistoryScans(1000);
        }
    }
}

export function requestGroupHistoryScan(whatsappGroupId) {
    const groupId = normalizeWhatsAppGroupId(whatsappGroupId);
    if (!groupId) {
        return { queued: false, reason: 'Missing group id' };
    }

    pendingGroupHistoryScans.add(groupId);
    schedulePendingGroupHistoryScans(750);

    return {
        queued: true,
        groupId,
        botReady: !!activeClient,
    };
}

export function startBot() {

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: WWEBJS_CLIENT_ID, dataPath: WWEBJS_DATA_PATH }),
        authTimeoutMs: AUTH_TIMEOUT_MS,
        qrMaxRetries: QR_MAX_RETRIES,
        takeoverOnConflict: true,
        takeoverTimeoutMs: 0,
        puppeteer: getPuppeteerOptions(),
    });
    let initWarningTimer = null;

    client.on('qr', (qr) => {
        if (initWarningTimer) { clearTimeout(initWarningTimer); initWarningTimer = null; }
        console.log('\n📱 Scan this QR code with WhatsApp:\n');
        qrcode.generate(qr, { small: true });
    });

    client.on('loading_screen', (pct, msg) => console.log(`⏳ Loading: ${pct}% ${msg || ''}`));
    client.on('authenticated', () => {
        if (initWarningTimer) { clearTimeout(initWarningTimer); initWarningTimer = null; }
        console.log('🔐 Authenticated');
    });
    client.on('change_state', (s) => console.log(`ℹ️  WA state: ${s}`));

    client.on('ready', async () => {
        if (initWarningTimer) { clearTimeout(initWarningTimer); initWarningTimer = null; }
        activeClient = client;
        console.log('\n✅ WhatsApp client ready!');
        if (DEBUG_GROUP_MATCH) {
            try {
                const chats = await client.getChats();
                const groups = chats.filter((c) => c.isGroup).slice(0, 30);
                console.log(`📋 Visible WhatsApp groups (${groups.length} shown):`);
                groups.forEach((g) => console.log(`   • ${g.name || 'Unnamed'} -> ${g.id?._serialized || 'unknown'}`));
            } catch (err) {
                console.warn(`⚠️  Could not list groups: ${err.message}`);
            }
        }
        await loadGroupMapping();
        if (mappingRefreshTimer) clearInterval(mappingRefreshTimer);
        mappingRefreshTimer = setInterval(() => {
            loadGroupMapping().catch((err) => {
                console.warn(`⚠️  Group mapping refresh failed: ${err.message}`);
            });
        }, GROUP_MAPPING_REFRESH_MS);
        console.log(`🔄 Group mapping auto-refresh every ${Math.round(GROUP_MAPPING_REFRESH_MS / 1000)}s`);
        console.log('🔍 Monitoring groups…');
        await scanHistory(client);
        await processPendingGroupHistoryScans();
        console.log('⏳ Waiting for new messages…\n');
    });

    client.on('auth_failure', (msg) => console.error('❌ Auth failure:', msg));
    client.on('disconnected', () => {
        console.warn('⚠️  Disconnected — reconnecting in 5s');
        activeClient = null;
        if (mappingRefreshTimer) {
            clearInterval(mappingRefreshTimer);
            mappingRefreshTimer = null;
        }
        setTimeout(() => client.initialize().catch(() => { }), 5000);
    });

    client.on('message', async (m) => {
        try {
            await handleMessage(m, 'message');
        } catch (err) {
            console.error(`❌ Message handler error: ${err?.message || err}`);
        }
    });
    client.on('message_create', async (m) => {
        try {
            await handleMessage(m, 'message_create');
        } catch (err) {
            console.error(`❌ message_create handler error: ${err?.message || err}`);
        }
    });

    console.log('\n🚀 Initializing WhatsApp client…\n');
    initWarningTimer = setTimeout(() => {
        console.warn(`⚠️  Init taking >${INIT_WARNING_TIMEOUT_MS / 1000}s`);
    }, INIT_WARNING_TIMEOUT_MS);

    client.initialize().catch((err) => {
        if (initWarningTimer) { clearTimeout(initWarningTimer); initWarningTimer = null; }
        console.error('❌ Fatal:', err?.message || err);
    });

    return client;
}

export async function generateSummary() { return null; }
export async function detectPhishing() { return false; }
