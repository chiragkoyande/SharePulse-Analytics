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
const CHAT_FETCH_RETRY_COUNT = Math.max(1, Number(process.env.CHAT_FETCH_RETRY_COUNT || 12));
const CHAT_FETCH_RETRY_DELAY_MS = Math.max(250, Number(process.env.CHAT_FETCH_RETRY_DELAY_MS || 3000));
const HISTORY_SCAN_START_DELAY_MS = Math.max(0, Number(process.env.HISTORY_SCAN_START_DELAY_MS || 8000));
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
const DEFAULT_SESSION_KEY = '__default__';
const sessionRuntime = new Map(); // key -> runtime info for UI/API

// Map: whatsappGroupId -> workspace_id (UUID)
let groupWorkspaceMap = new Map();
// Set of all monitored WhatsApp group IDs
let targetGroupSet = new Set();
let mappingRefreshTimer = null;
let activeClient = null;
const workspaceClients = new Map(); // workspace_id -> Client
const workspaceClientInitInProgress = new Set();
let historyScanInProgress = false;
const pendingGroupHistoryScans = new Set();
let pendingScanRetryTimer = null;

function isChatLoadingError(err) {
    const msg = String(err?.message || err || '').toLowerCase();
    return msg.includes('waitforchatloading');
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWhatsAppGroupId(rawId) {
    const value = String(rawId || '').trim();
    if (!value) return '';
    if (value.includes('@')) return value;
    return `${value}@g.us`;
}

function normalizeWorkspaceId(rawWorkspaceId) {
    const value = String(rawWorkspaceId || '').trim();
    return value || null;
}

function workspaceSessionKey(workspaceId = null) {
    return workspaceId ? `ws:${workspaceId}` : DEFAULT_SESSION_KEY;
}

function updateSessionRuntime(workspaceId, patch) {
    const key = workspaceSessionKey(workspaceId);
    const prev = sessionRuntime.get(key) || {
        workspace_id: workspaceId || null,
        status: 'idle',
        qr: null,
        error: null,
        updated_at: new Date().toISOString(),
    };
    const next = {
        ...prev,
        ...patch,
        workspace_id: workspaceId || null,
        updated_at: new Date().toISOString(),
    };
    sessionRuntime.set(key, next);
    return next;
}

function getSessionRuntime(workspaceId = null) {
    const key = workspaceSessionKey(workspaceId);
    return sessionRuntime.get(key) || {
        workspace_id: workspaceId || null,
        status: 'idle',
        qr: null,
        error: null,
        updated_at: null,
    };
}

function hasAnyReadyClient() {
    return !!activeClient || workspaceClients.size > 0;
}

function sanitizeWorkspaceForClientId(workspaceId) {
    return String(workspaceId || '')
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 56);
}

function resolveSessionClientId(workspaceId = null) {
    if (!workspaceId) return WWEBJS_CLIENT_ID;
    return `ws_${sanitizeWorkspaceForClientId(workspaceId)}`;
}

function getClientForWorkspace(workspaceId = null) {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    if (normalizedWorkspaceId && workspaceClients.has(normalizedWorkspaceId)) {
        return workspaceClients.get(normalizedWorkspaceId);
    }
    return activeClient;
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

        // Queue automatic backfill only for groups added after initial bootstrap.
        if (hasAnyReadyClient() && prevTargets.size > 0) {
            for (const groupId of targetGroupSet) {
                if (!prevTargets.has(groupId)) {
                    pendingGroupHistoryScans.add(groupId);
                }
            }
            if (pendingGroupHistoryScans.size > 0) {
                schedulePendingGroupHistoryScans(250);
            }
        }

        // Workspace sessions are started on explicit connect / scan requests.
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
        const t = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SharePulse/1.0)' },
            redirect: 'follow',
        });
        clearTimeout(t);
        // Read only the first 16KB to avoid downloading entire pages
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let html = '';
        while (html.length < 16384) {
            const { done, value } = await reader.read();
            if (done) break;
            html += decoder.decode(value, { stream: true });
        }
        try { reader.cancel(); } catch { /* ignore */ }

        // Try <title> tag (handles multiline and entities)
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        if (titleMatch && titleMatch[1]) {
            const title = titleMatch[1].replace(/\s+/g, ' ').trim();
            if (title) return title;
        }

        // Fallback: og:title meta tag
        const ogMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
            || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
        if (ogMatch && ogMatch[1]) {
            const ogTitle = ogMatch[1].trim();
            if (ogTitle) return ogTitle;
        }

        // Last resort: use the hostname from the URL
        return fallbackTitle(url);
    } catch {
        return fallbackTitle(url);
    }
}

function fallbackTitle(url) {
    try {
        const hostname = new URL(url).hostname.replace(/^www\./, '');
        return hostname;
    } catch {
        return url;
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
            title: title || fallbackTitle(url),
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

async function handleMessage(message, source = 'message', expectedWorkspaceId = null) {
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
    if (expectedWorkspaceId && workspaceId !== expectedWorkspaceId) return;
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

async function scanHistoryBySearch(client, normalizedGroupId, workspaceId, effectiveLimit) {
    console.log(`   🔎 Falling back to search-based history scan for ${normalizedGroupId.slice(0, 12)}…`);
    let saved = 0;
    let skipped = 0;
    let scannedMessages = 0;
    const seenIds = new Set();
    let page = 1;
    const pageSizeBase = Math.min(HISTORY_SCAN_BATCH_SIZE, 200);

    while (effectiveLimit <= 0 || scannedMessages < effectiveLimit) {
        const remaining = effectiveLimit > 0 ? (effectiveLimit - scannedMessages) : pageSizeBase;
        const pageSize = Math.min(pageSizeBase, remaining);
        let messages = [];
        try {
            messages = await client.searchMessages('http', {
                chatId: normalizedGroupId,
                page,
                limit: pageSize,
            });
        } catch (err) {
            console.warn(`   ⚠️  Search fallback failed on page ${page}: ${err?.message || err}`);
            break;
        }

        if (!messages || messages.length === 0) break;
        page += 1;

        for (const msg of messages) {
            const msgId = msg?.id?._serialized;
            if (msgId && seenIds.has(msgId)) continue;
            if (msgId) seenIds.add(msgId);

            scannedMessages++;
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

        if (messages.length < pageSize) break;
    }

    if (scannedMessages === 0) {
        console.log('   ℹ️  Search fallback returned no messages');
        return false;
    }
    if (DEBUG_GROUP_MATCH) {
        console.log(`   ℹ️  Fallback scanned messages: ${scannedMessages}`);
    }
    console.log(`   ✅ ${saved} new, ⏭️ ${skipped} skipped (search fallback)`);
    return true;
}

async function scanHistoryForGroup(client, targetGroupId, reason = 'startup', expectedWorkspaceId = null) {
    const normalizedGroupId = normalizeWhatsAppGroupId(targetGroupId);
    if (!normalizedGroupId) return;
    const workspaceId = groupWorkspaceMap.get(normalizedGroupId) || null;
    if (expectedWorkspaceId && workspaceId !== expectedWorkspaceId) return;
    const effectiveLimit = reason === 'admin-add'
        ? GROUP_ADD_HISTORY_SCAN_LIMIT
        : HISTORY_SCAN_LIMIT;
    const limitLabel = effectiveLimit > 0 ? effectiveLimit : 'all';

    console.log(`\n  📂 Scanning: ${normalizedGroupId.slice(0, 12)}… (workspace: ${workspaceId || 'unmapped'}, reason: ${reason}, limit: ${limitLabel})`);

    let chat;
    try { chat = await client.getChatById(normalizedGroupId); }
    catch { console.log('  ⚠️  Could not find group'); return; }
    if (!chat) return;
    try { await chat.syncHistory(); } catch { /* best effort */ }

    let saved = 0;
    let skipped = 0;
    let scannedMessages = 0;
    let beforeMsgId = null;

    // Scan in batches so recent links are consistently covered even with large history.
    while (effectiveLimit <= 0 || scannedMessages < effectiveLimit) {
        const remaining = effectiveLimit > 0 ? (effectiveLimit - scannedMessages) : HISTORY_SCAN_BATCH_SIZE;
        const batchLimit = Math.min(HISTORY_SCAN_BATCH_SIZE, remaining);
        const options = beforeMsgId ? { limit: batchLimit, before: beforeMsgId } : { limit: batchLimit };
        let messages = null;
        for (let attempt = 1; attempt <= CHAT_FETCH_RETRY_COUNT; attempt++) {
            try {
                messages = await chat.fetchMessages(options);
                break;
            } catch (err) {
                if (!isChatLoadingError(err)) throw err;
                if (attempt >= CHAT_FETCH_RETRY_COUNT) {
                    console.warn(`   ⚠️  Chat loading failed for ${normalizedGroupId.slice(0, 12)}… after ${attempt} retries; skipping this group scan for now`);
                    messages = null;
                    break;
                }
                try { await chat.syncHistory(); } catch { /* best effort */ }
                const waitMs = CHAT_FETCH_RETRY_DELAY_MS * attempt;
                console.warn(`   ⚠️  Chat loading not ready for ${normalizedGroupId.slice(0, 12)}… (retry ${attempt}/${CHAT_FETCH_RETRY_COUNT - 1})`);
                await sleep(waitMs);
            }
        }
        if (messages === null) {
            const fallbackDone = await scanHistoryBySearch(client, normalizedGroupId, workspaceId, effectiveLimit);
            if (fallbackDone) return;
            break;
        }
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

async function scanHistory(client, expectedWorkspaceId = null) {
    historyScanInProgress = true;
    const scopeLabel = expectedWorkspaceId ? `workspace ${expectedWorkspaceId}` : 'all workspaces';
    console.log(`\n📜 Scanning old messages for links (${scopeLabel})...`);
    for (const targetGroupId of targetGroupSet) {
        await scanHistoryForGroup(client, targetGroupId, 'startup', expectedWorkspaceId);
    }
    console.log(`\n📊 History scan complete!\n`);
    historyScanInProgress = false;
}

async function processPendingGroupHistoryScans() {
    if (!hasAnyReadyClient() || pendingGroupHistoryScans.size === 0) return;

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
            const workspaceId = groupWorkspaceMap.get(normalizedGroupId) || null;
            const client = getClientForWorkspace(workspaceId);
            if (!client) {
                pendingGroupHistoryScans.add(normalizedGroupId);
                if (workspaceId) {
                    startWorkspaceSession(workspaceId).catch((err) => {
                        console.warn(`⚠️  Could not start workspace bot session (${workspaceId}) for queued scan: ${err?.message || err}`);
                    });
                }
                continue;
            }
            await scanHistoryForGroup(client, normalizedGroupId, 'admin-add', workspaceId);
        }
    } finally {
        historyScanInProgress = false;
        if (pendingGroupHistoryScans.size > 0) {
            schedulePendingGroupHistoryScans(1000);
        }
    }
}

export function requestGroupHistoryScan(whatsappGroupId, workspaceId = null) {
    const groupId = normalizeWhatsAppGroupId(whatsappGroupId);
    if (!groupId) {
        return { queued: false, reason: 'Missing group id' };
    }
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);

    pendingGroupHistoryScans.add(groupId);
    schedulePendingGroupHistoryScans(750);
    if (normalizedWorkspaceId) {
        startWorkspaceSession(normalizedWorkspaceId).catch((err) => {
            console.warn(`⚠️  Could not start workspace bot session (${normalizedWorkspaceId}) on scan request: ${err?.message || err}`);
        });
    }

    return {
        queued: true,
        groupId,
        workspaceId: normalizedWorkspaceId,
        botReady: !!getClientForWorkspace(normalizedWorkspaceId),
    };
}

function sessionLabel(workspaceId = null) {
    return workspaceId ? `workspace:${workspaceId}` : 'default';
}

function createBotClient(workspaceId = null) {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const label = sessionLabel(normalizedWorkspaceId);
    const sessionClientId = resolveSessionClientId(normalizedWorkspaceId);
    updateSessionRuntime(normalizedWorkspaceId, { status: 'initializing', qr: null, error: null, client_id: sessionClientId });

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: sessionClientId, dataPath: WWEBJS_DATA_PATH }),
        authTimeoutMs: AUTH_TIMEOUT_MS,
        qrMaxRetries: QR_MAX_RETRIES,
        takeoverOnConflict: true,
        takeoverTimeoutMs: 0,
        puppeteer: getPuppeteerOptions(),
    });
    let initWarningTimer = null;
    if (normalizedWorkspaceId) workspaceClients.set(normalizedWorkspaceId, client);

    client.on('qr', (qr) => {
        if (initWarningTimer) { clearTimeout(initWarningTimer); initWarningTimer = null; }
        updateSessionRuntime(normalizedWorkspaceId, { status: 'qr', qr, error: null });
        console.log(`\n📱 Scan this QR code with WhatsApp (${label}):\n`);
        qrcode.generate(qr, { small: true });
    });

    client.on('loading_screen', (pct, msg) => console.log(`⏳ [${label}] Loading: ${pct}% ${msg || ''}`));
    client.on('authenticated', () => {
        if (initWarningTimer) { clearTimeout(initWarningTimer); initWarningTimer = null; }
        updateSessionRuntime(normalizedWorkspaceId, { status: 'authenticated', error: null });
        console.log(`🔐 [${label}] Authenticated`);
    });
    client.on('change_state', (s) => console.log(`ℹ️  [${label}] WA state: ${s}`));

    client.on('ready', async () => {
        if (initWarningTimer) { clearTimeout(initWarningTimer); initWarningTimer = null; }
        if (!normalizedWorkspaceId) activeClient = client;
        updateSessionRuntime(normalizedWorkspaceId, { status: 'ready', qr: null, error: null });
        console.log(`\n✅ WhatsApp client ready (${label})!`);
        try {
            if (DEBUG_GROUP_MATCH) {
                try {
                    const chats = await client.getChats();
                    const groups = chats.filter((c) => c.isGroup).slice(0, 30);
                    console.log(`📋 [${label}] Visible WhatsApp groups (${groups.length} shown):`);
                    groups.forEach((g) => console.log(`   • ${g.name || 'Unnamed'} -> ${g.id?._serialized || 'unknown'}`));
                } catch (err) {
                    console.warn(`⚠️  [${label}] Could not list groups: ${err.message}`);
                }
            }
            await loadGroupMapping();
            if (!mappingRefreshTimer) {
                mappingRefreshTimer = setInterval(() => {
                    loadGroupMapping().catch((err) => {
                        console.warn(`⚠️  Group mapping refresh failed: ${err.message}`);
                    });
                }, GROUP_MAPPING_REFRESH_MS);
                console.log(`🔄 Group mapping auto-refresh every ${Math.round(GROUP_MAPPING_REFRESH_MS / 1000)}s`);
            }
            console.log(`🔍 [${label}] Monitoring groups…`);
            if (HISTORY_SCAN_START_DELAY_MS > 0) {
                console.log(`⏳ [${label}] Waiting ${Math.round(HISTORY_SCAN_START_DELAY_MS / 1000)}s before history scan…`);
                await sleep(HISTORY_SCAN_START_DELAY_MS);
            }
            await scanHistory(client, normalizedWorkspaceId);
            await processPendingGroupHistoryScans();
            console.log(`⏳ [${label}] Waiting for new messages…\n`);
        } catch (err) {
            console.error(`⚠️  [${label}] Ready-handler error: ${err?.message || err}`);
        }
    });

    client.on('auth_failure', (msg) => {
        updateSessionRuntime(normalizedWorkspaceId, { status: 'auth_failure', error: String(msg || 'auth failure') });
        if (normalizedWorkspaceId) workspaceClients.delete(normalizedWorkspaceId);
        console.error(`❌ [${label}] Auth failure:`, msg);
    });
    client.on('disconnected', () => {
        console.warn(`⚠️  [${label}] Disconnected — reconnecting in 5s`);
        if (normalizedWorkspaceId) workspaceClients.delete(normalizedWorkspaceId);
        else activeClient = null;
        updateSessionRuntime(normalizedWorkspaceId, { status: 'disconnected' });
        if (!activeClient && workspaceClients.size === 0 && mappingRefreshTimer) {
            clearInterval(mappingRefreshTimer);
            mappingRefreshTimer = null;
        }
        setTimeout(() => client.initialize().catch(() => { }), 5000);
    });

    client.on('message', async (m) => {
        try {
            await handleMessage(m, 'message', normalizedWorkspaceId);
        } catch (err) {
            console.error(`❌ [${label}] Message handler error: ${err?.message || err}`);
        }
    });
    client.on('message_create', async (m) => {
        try {
            await handleMessage(m, 'message_create', normalizedWorkspaceId);
        } catch (err) {
            console.error(`❌ [${label}] message_create handler error: ${err?.message || err}`);
        }
    });

    console.log(`\n🚀 Initializing WhatsApp client (${label})…\n`);
    initWarningTimer = setTimeout(() => {
        updateSessionRuntime(normalizedWorkspaceId, { status: 'initializing-slow' });
        console.warn(`⚠️  [${label}] Init taking >${INIT_WARNING_TIMEOUT_MS / 1000}s`);
    }, INIT_WARNING_TIMEOUT_MS);

    client.initialize().catch((err) => {
        if (initWarningTimer) { clearTimeout(initWarningTimer); initWarningTimer = null; }
        if (normalizedWorkspaceId) workspaceClients.delete(normalizedWorkspaceId);
        updateSessionRuntime(normalizedWorkspaceId, { status: 'fatal', error: String(err?.message || err) });
        console.error(`❌ [${label}] Fatal:`, err?.message || err);
    });

    return client;
}

async function startWorkspaceSession(workspaceId) {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    if (!normalizedWorkspaceId) return null;

    // If a client exists, check if it's still alive
    if (workspaceClients.has(normalizedWorkspaceId)) {
        const runtime = getSessionRuntime(normalizedWorkspaceId);
        // If the session is in a healthy or transitioning state, return existing client
        if (['initializing', 'initializing-slow', 'qr', 'authenticated', 'ready'].includes(runtime.status)) {
            return workspaceClients.get(normalizedWorkspaceId);
        }
        // Stale/dead client — destroy it and allow re-creation
        console.log(`♻️  [workspace:${normalizedWorkspaceId}] Destroying stale client (status: ${runtime.status})`);
        try { await workspaceClients.get(normalizedWorkspaceId).destroy(); } catch { /* ignore */ }
        workspaceClients.delete(normalizedWorkspaceId);
    }

    if (workspaceClientInitInProgress.has(normalizedWorkspaceId)) return null;

    const runtime = getSessionRuntime(normalizedWorkspaceId);
    if (['initializing', 'initializing-slow', 'qr', 'authenticated', 'ready'].includes(runtime.status)) {
        return null;
    }

    workspaceClientInitInProgress.add(normalizedWorkspaceId);
    try {
        return createBotClient(normalizedWorkspaceId);
    } finally {
        workspaceClientInitInProgress.delete(normalizedWorkspaceId);
    }
}

export async function ensureWorkspaceBotSession(workspaceId) {
    return startWorkspaceSession(workspaceId);
}

export function getWorkspaceBotSessionStatus(workspaceId = null) {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const client = getClientForWorkspace(normalizedWorkspaceId);
    const runtime = getSessionRuntime(normalizedWorkspaceId);
    return {
        ...runtime,
        workspace_id: normalizedWorkspaceId,
        connected: !!client,
        has_qr: !!runtime.qr,
    };
}

export async function getWorkspaceAvailableGroups(workspaceId) {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const client = getClientForWorkspace(normalizedWorkspaceId);
    if (!client) return [];
    const chats = await client.getChats();
    return (chats || [])
        .filter((chat) => chat?.isGroup)
        .map((chat) => ({
            id: normalizeWhatsAppGroupId(chat?.id?._serialized),
            name: chat?.name || 'Unnamed Group',
        }))
        .filter((row) => row.id)
        .sort((a, b) => a.name.localeCompare(b.name));
}

export function startBot() {
    const defaultClient = createBotClient(null);

    return {
        async destroy() {
            const clients = [];
            if (defaultClient) clients.push(defaultClient);
            for (const client of workspaceClients.values()) clients.push(client);
            for (const client of clients) {
                try { await client.destroy(); } catch { /* ignore */ }
            }
            workspaceClients.clear();
            activeClient = null;
            if (mappingRefreshTimer) {
                clearInterval(mappingRefreshTimer);
                mappingRefreshTimer = null;
            }
        },
    };
}

export { fetchPageTitle };
export async function generateSummary() { return null; }
export async function detectPhishing() { return false; }
