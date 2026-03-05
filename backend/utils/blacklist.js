// ============================================
// Domain Blacklist Filter
// ============================================
// Prevents storing links from unwanted domains.
// ============================================

/**
 * Domains to ignore. Any URL whose hostname
 * ends with one of these entries is discarded.
 */
export const BLACKLISTED_DOMAINS = [
    'linkedin.com',
    'wa.me',
    't.me',
];

/**
 * Check if a URL belongs to a blacklisted domain.
 *
 * @param {string} url - Full URL string
 * @returns {boolean} true if the domain is blacklisted
 */
export function isBlacklisted(url) {
    try {
        const hostname = new URL(url).hostname.toLowerCase();
        return BLACKLISTED_DOMAINS.some(
            (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
        );
    } catch {
        return false;
    }
}
