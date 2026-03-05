// ============================================
// URL Extractor Utility
// ============================================
// Robust URL extraction and validation from
// raw WhatsApp message text.
// ============================================

/**
 * Regex to match http/https URLs.
 */
const URL_REGEX = /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,63}\b(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)/gi;

/**
 * Trailing punctuation to strip from matched URLs.
 */
const TRAILING_PUNCTUATION = /[.,;:!?)>\]}"']+$/;

/**
 * Extracts all valid URLs from a message string.
 *
 * @param {string} message - Raw message text.
 * @returns {string[]} Array of unique, cleaned URLs.
 */
export function extractUrls(message) {
    if (!message || typeof message !== 'string') return [];

    const rawMatches = message.match(URL_REGEX);
    if (!rawMatches) return [];

    const cleaned = rawMatches
        .map((url) => url.replace(TRAILING_PUNCTUATION, ''))
        .filter((url) => isValidUrl(url));

    return [...new Set(cleaned)];
}

/**
 * Validates a URL string.
 *
 * @param {string} urlString
 * @returns {boolean}
 */
export function isValidUrl(urlString) {
    try {
        const url = new URL(urlString);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * Extracts the hostname from a URL.
 *
 * @param {string} urlString
 * @returns {string}
 */
export function extractDomain(urlString) {
    try {
        return new URL(urlString).hostname;
    } catch {
        return 'unknown';
    }
}
