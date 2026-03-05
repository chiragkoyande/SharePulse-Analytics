// ============================================
// Auth Middleware
// ============================================
// Verifies Supabase JWT tokens and checks
// user roles from the app_users table.
// ============================================

import { supabase } from '../db.js';

/**
 * Require a valid Supabase auth token.
 * Attaches `req.user` with { id, email }.
 */
export async function requireAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: 'Missing auth token' });
        }

        const token = authHeader.split(' ')[1];
        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            return res.status(401).json({ success: false, error: 'Invalid or expired token' });
        }

        // Check if user is active in app_users
        const { data: appUser, error: appErr } = await supabase
            .from('app_users')
            .select('id, email, role, status')
            .eq('email', user.email)
            .single();

        if (appErr || !appUser || appUser.status !== 'active') {
            return res.status(403).json({ success: false, error: 'Access revoked or not approved' });
        }

        req.user = { id: user.id, email: user.email, role: appUser.role };
        next();
    } catch (error) {
        return res.status(401).json({ success: false, error: 'Authentication failed' });
    }
}

/**
 * Require admin role. Must be used after requireAuth.
 */
export async function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    next();
}
