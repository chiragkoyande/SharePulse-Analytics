// ============================================
// URL Normalizer & Hasher
// ============================================
// Normalizes URLs for consistent deduplication
// and generates MD5 hashes for fast lookups.
// ============================================

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
