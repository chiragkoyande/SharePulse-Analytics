import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;

function getCipherKey() {
    const secret = process.env.ACCESS_REQUEST_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret) throw new Error('Missing ACCESS_REQUEST_SECRET');
    return crypto.createHash('sha256').update(secret).digest();
}

export function encryptRequestPassword(plainPassword) {
    const key = getCipherKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGO, key, iv);
    const encrypted = Buffer.concat([
        cipher.update(String(plainPassword), 'utf8'),
        cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptRequestPassword(payload) {
    if (!payload || typeof payload !== 'string') throw new Error('Missing encrypted password');

    const [ivB64, tagB64, dataB64] = payload.split('.');
    if (!ivB64 || !tagB64 || !dataB64) throw new Error('Invalid encrypted password payload');

    const key = getCipherKey();
    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));

    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(dataB64, 'base64url')),
        decipher.final(),
    ]);

    return decrypted.toString('utf8');
}
