/**
 * Regex to match explicit protocol URLs.
 */
const URL_REGEX = /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,63}\b(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)/gi;

/**
 * Regex to match bare domains (www.example.com/path, example.ai/docs).
 * Excludes an existing protocol to avoid duplicate captures.
 */
const BARE_DOMAIN_REGEX = /\b(?!(?:https?:\/\/))(?:www\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?:\/[^\s<>"'`)]*)?/gi;

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

    const protocolMatches = message.match(URL_REGEX) || [];
    const bareDomainMatches = message.match(BARE_DOMAIN_REGEX) || [];

    const cleaned = [...protocolMatches, ...bareDomainMatches]
        .map((url) => url.replace(TRAILING_PUNCTUATION, ''))
        .map((url) => normalizeUrl(url))
        .filter((url) => isValidUrl(url));

    return [...new Set(cleaned)];
}

/**
 * Adds https:// when users share bare domains without protocol.
 *
 * @param {string} urlString
 * @returns {string}
 */
export function normalizeUrl(urlString) {
    if (!urlString) return '';
    if (/^https?:\/\//i.test(urlString)) return urlString;
    return `https://${urlString}`;
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
