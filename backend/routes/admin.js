// ============================================
// Admin Routes — /admin/*
// ============================================
// Admin-only endpoints for managing users
// and access requests.
// ============================================

import { Router } from 'express';
import { supabase } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/authMiddleware.js';
import { decryptRequestPassword } from '../utils/requestPasswordCipher.js';
import { notifyAccessApproved } from '../utils/emailNotifier.js';

const router = Router();

// All admin routes require auth + admin role
router.use(requireAuth, requireAdmin);

// ── GET /admin/requests ──────────────────────

router.get('/requests', async (req, res, next) => {
    try {
        const status = req.query.status || 'pending';

        const { data, error } = await supabase
            .from('access_requests')
            .select('id, email, status, created_at')
            .eq('status', status)
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json({ success: true, data: data || [] });
    } catch (error) {
        next(error);
    }
});

// ── POST /admin/approve ──────────────────────

router.post('/approve', async (req, res, next) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, error: 'Email is required' });

        const normalizedEmail = email.toLowerCase().trim();

        const { data: requestRow, error: reqErr } = await supabase
            .from('access_requests')
            .select('id, encrypted_password, status')
            .eq('email', normalizedEmail)
            .maybeSingle();

        if (reqErr) throw reqErr;
        if (!requestRow) {
            return res.status(404).json({ success: false, error: 'Access request not found' });
        }
        if (!requestRow.encrypted_password) {
            return res.status(400).json({ success: false, error: 'No password provided by user for this request' });
        }

        const password = decryptRequestPassword(requestRow.encrypted_password);

        // Create Supabase Auth user
        const { error: authErr } = await supabase.auth.admin.createUser({
            email: normalizedEmail,
            password,
            email_confirm: true,
        });

        if (authErr) {
            // If user already exists in auth, just reset password
            if (authErr.message?.includes('already been registered')) {
                const { data: users } = await supabase.auth.admin.listUsers();
                const existing = users?.users?.find((u) => u.email === normalizedEmail);
                if (existing) {
                    await supabase.auth.admin.updateUserById(existing.id, { password });
                }
            } else {
                throw authErr;
            }
        }

        // Upsert into app_users
        const { error: upsertErr } = await supabase
            .from('app_users')
            .upsert(
                { email: normalizedEmail, role: 'user', status: 'active' },
                { onConflict: 'email' }
            );

        if (upsertErr) throw upsertErr;

        // Update access request status
        await supabase
            .from('access_requests')
            .update({
                status: 'approved',
                encrypted_password: null,
            })
            .eq('id', requestRow.id);

        let emailResult = { sent: false, skipped: true, reason: 'Unknown' };
        try {
            emailResult = await notifyAccessApproved(normalizedEmail);
        } catch (mailErr) {
            console.error(`⚠️  Approval email failed for ${normalizedEmail}: ${mailErr.message}`);
            emailResult = {
                sent: false,
                skipped: false,
                reason: mailErr.message,
            };
        }

        res.json({
            success: true,
            message: `User approved: ${normalizedEmail}`,
            email_notification: emailResult,
        });
    } catch (error) {
        next(error);
    }
});

// ── POST /admin/reject ───────────────────────

router.post('/reject', async (req, res, next) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, error: 'Email is required' });

        const normalizedEmail = email.toLowerCase().trim();

        const { error } = await supabase
            .from('access_requests')
            .update({ status: 'rejected' })
            .eq('email', normalizedEmail);

        if (error) throw error;

        res.json({ success: true, message: `Request rejected: ${normalizedEmail}` });
    } catch (error) {
        next(error);
    }
});

// ── GET /admin/users ─────────────────────────

router.get('/users', async (req, res, next) => {
    try {
        const { data, error } = await supabase
            .from('app_users')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json({ success: true, data: data || [] });
    } catch (error) {
        next(error);
    }
});

// ── POST /admin/promote ──────────────────────

router.post('/promote', async (req, res, next) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, error: 'Email is required' });

        const normalizedEmail = email.toLowerCase().trim();

        const { error } = await supabase
            .from('app_users')
            .update({ role: 'admin' })
            .eq('email', normalizedEmail);

        if (error) throw error;

        res.json({ success: true, message: `${normalizedEmail} promoted to admin` });
    } catch (error) {
        next(error);
    }
});

// ── POST /admin/revoke ───────────────────────

router.post('/revoke', async (req, res, next) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, error: 'Email is required' });

        const normalizedEmail = email.toLowerCase().trim();

        // Prevent self-revoke
        if (normalizedEmail === req.user.email) {
            return res.status(400).json({ success: false, error: 'Cannot revoke your own access' });
        }

        const { error } = await supabase
            .from('app_users')
            .update({ status: 'revoked' })
            .eq('email', normalizedEmail);

        if (error) throw error;

        res.json({ success: true, message: `Access revoked: ${normalizedEmail}` });
    } catch (error) {
        next(error);
    }
});

export default router;
