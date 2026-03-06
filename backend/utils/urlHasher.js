import { createHash } from 'crypto';

/**
 * Normalize a URL for consistent hashing:
 * - Lowercase the hostname
 * - Remove trailing slash
 * - Remove 'www.' prefix
 * - Sort query parameters
 * - Remove fragment (#)
 *
 * @param {string} rawUrl
 * @returns {string} Normalized URL string
 */
export function normalizeUrl(rawUrl) {
    try {
        const url = new URL(rawUrl);

        // Lowercase hostname and remove www.
        url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');

        // Sort query parameters
        const params = new URLSearchParams(url.searchParams);
        const sorted = new URLSearchParams([...params.entries()].sort());
        url.search = sorted.toString() ? `?${sorted.toString()}` : '';

        // Remove fragment
        url.hash = '';

        // Remove trailing slash (but keep root /)
        let normalized = url.toString();
        if (normalized.endsWith('/') && url.pathname !== '/') {
            normalized = normalized.slice(0, -1);
        }

        return normalized;
    } catch {
        // If URL parsing fails, just lowercase it
        return rawUrl.toLowerCase().trim();
    }
}

/**
 * Generate an MD5 hash of a normalized URL.
 *
 * @param {string} url - Raw URL string
 * @returns {string} MD5 hex digest
 */
export function hashUrl(url) {
    const normalized = normalizeUrl(url);
    return createHash('md5').update(normalized).digest('hex');
}

/**
 * Generate workspace-aware hash:
 * - Unmapped links keep legacy global hash
 * - Workspace links hash as "<normalized>::ws:<workspaceId>"
 * This preserves old data while allowing the same URL in multiple workspaces.
 *
 * @param {string} url
 * @param {string|null} workspaceId
 * @returns {string}
 */
export function hashUrlForWorkspace(url, workspaceId = null) {
    const normalized = normalizeUrl(url);
    if (!workspaceId) return createHash('md5').update(normalized).digest('hex');
    return createHash('md5').update(`${normalized}::ws:${workspaceId}`).digest('hex');
}
