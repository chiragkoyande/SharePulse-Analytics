// ============================================
// Auth Routes — /auth/*
// ============================================
// Public endpoints for access requests and login.
// ============================================

import { Router } from 'express';
import { supabase } from '../db.js';
import { encryptRequestPassword } from '../utils/requestPasswordCipher.js';

const router = Router();

// ── POST /auth/request-access ────────────────

router.post('/auth/request-access', async (req, res, next) => {
    try {
        const { email, password } = req.body;

        if (!email || !email.includes('@')) {
            return res.status(400).json({ success: false, error: 'Valid email is required' });
        }
        if (!password || String(password).length < 8) {
            return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const encryptedPassword = encryptRequestPassword(password);

        // Check if already an active user
        const { data: existingUser } = await supabase
            .from('app_users')
            .select('id, status')
            .eq('email', normalizedEmail)
            .single();

        if (existingUser && existingUser.status === 'active') {
            return res.status(400).json({ success: false, error: 'This email already has access' });
        }

        // Check if request already pending
        const { data: existingReq } = await supabase
            .from('access_requests')
            .select('id, status')
            .eq('email', normalizedEmail)
            .maybeSingle();

        if (existingReq) {
            if (existingReq.status === 'pending') {
                return res.json({ success: true, message: 'Your request is already pending admin approval' });
            }
            // Allow re-request for rejected/approved/older rows by moving back to pending
            const { error: updateReqErr } = await supabase
                .from('access_requests')
                .update({
                    status: 'pending',
                    encrypted_password: encryptedPassword,
                    created_at: new Date().toISOString(),
                })
                .eq('id', existingReq.id);

            if (updateReqErr) throw updateReqErr;
            return res.json({ success: true, message: 'Access request resubmitted' });
        }

        // Insert new request
        const { error } = await supabase
            .from('access_requests')
            .insert({
                email: normalizedEmail,
                status: 'pending',
                encrypted_password: encryptedPassword,
            });

        if (error) {
            // Race-safe fallback when another request was created in parallel
            if (error.code === '23505' || String(error.message || '').includes('access_requests_email_key')) {
                const { error: retryErr } = await supabase
                    .from('access_requests')
                    .update({
                        status: 'pending',
                        encrypted_password: encryptedPassword,
                        created_at: new Date().toISOString(),
                    })
                    .eq('email', normalizedEmail);
                if (retryErr) throw retryErr;
                return res.json({ success: true, message: 'Access request resubmitted' });
            }
            throw error;
        }

        res.json({ success: true, message: 'Access request submitted. An admin will review it shortly.' });
    } catch (error) {
        next(error);
    }
});

// ── POST /auth/login ─────────────────────────

router.post('/auth/login', async (req, res, next) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Email and password are required' });
        }

        const normalizedEmail = email.toLowerCase().trim();

        // Sign in with Supabase Auth
        const { data, error } = await supabase.auth.signInWithPassword({
            email: normalizedEmail,
            password,
        });

        if (error) {
            return res.status(401).json({ success: false, error: 'Invalid email or password' });
        }

        // Get role from app_users
        const { data: appUser } = await supabase
            .from('app_users')
            .select('role, status')
            .eq('email', normalizedEmail)
            .single();

        if (!appUser || appUser.status !== 'active') {
            return res.status(403).json({ success: false, error: 'Access revoked. Contact admin.' });
        }

        res.json({
            success: true,
            session: {
                access_token: data.session.access_token,
                refresh_token: data.session.refresh_token,
                expires_at: data.session.expires_at,
            },
            user: {
                email: normalizedEmail,
                role: appUser.role,
            },
        });
    } catch (error) {
        next(error);
    }
});

export default router;
