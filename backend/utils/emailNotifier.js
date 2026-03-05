import nodemailer from 'nodemailer';

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE = process.env.SMTP_SECURE !== 'false';
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || (SMTP_USER ? `SharePulse Analytics <${SMTP_USER}>` : null);

let transporter = null;

function canSendEmail() {
    return !!(SMTP_USER && SMTP_PASS && SMTP_FROM);
}

function getTransporter() {
    if (!canSendEmail()) return null;
    if (transporter) return transporter;

    transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        auth: {
            user: SMTP_USER,
            pass: SMTP_PASS,
        },
    });
    return transporter;
}

export async function notifyAccessApproved(email) {
    const tx = getTransporter();
    if (!tx) {
        return {
            sent: false,
            skipped: true,
            reason: 'SMTP is not configured',
        };
    }

    const payload = {
        from: SMTP_FROM,
        to: [email],
        subject: 'Your access request has been approved',
        text: 'Your access request is approved. You can now sign in to SharePulse Analytics with your requested email and password.',
        html: `
            <p>Your access request has been approved.</p>
            <p>You can now sign in to <strong>SharePulse Analytics</strong> with your requested email and password.</p>
        `,
    };

    const info = await tx.sendMail(payload);

    return {
        sent: true,
        skipped: false,
        provider: 'gmail_smtp',
        id: info?.messageId || null,
    };
}
