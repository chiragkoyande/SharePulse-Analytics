import { supabase } from '../db.js';

/**
 * Require a valid Supabase auth token.
 * Attaches req.user with { id, email, role, workspaces }.
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

        // Load user's workspace memberships
        const { data: memberships } = await supabase
            .from('workspace_members')
            .select('workspace_id, role')
            .eq('user_email', user.email);

        req.user = {
            id: user.id,
            email: user.email,
            role: appUser.role,
            isSuperAdmin: appUser.role === 'super_admin',
            workspaces: (memberships || []).map((m) => ({
                id: m.workspace_id,
                role: m.role,
            })),
        };
        next();
    } catch (error) {
        return res.status(401).json({ success: false, error: 'Authentication failed' });
    }
}

/**
 * Require admin role (admin or super_admin). Must be after requireAuth.
 */
export async function requireAdmin(req, res, next) {
    if (!req.user || !['admin', 'super_admin'].includes(req.user.role)) {
        return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    next();
}

/**
 * Require super_admin role. Must be after requireAuth.
 */
export async function requireSuperAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'super_admin') {
        return res.status(403).json({ success: false, error: 'Super admin access required' });
    }
    next();
}

/**
 * Require user has access to the workspace specified in
 * req.query.workspace_id or req.params.workspace_id.
 * Optionally enforce a minimum role.
 *
 * Usage:
 *   requireWorkspaceAccess()           — any member
 *   requireWorkspaceAccess('admin')    — admin or owner
 *   requireWorkspaceAccess('owner')    — owner only
 *
 * Must be after requireAuth.
 */
export function requireWorkspaceAccess(minRole) {
    const roleHierarchy = { member: 0, admin: 1, owner: 2 };

    return (req, res, next) => {
        // Super admin bypasses workspace checks
        if (req.user?.isSuperAdmin) return next();

        const workspaceId = req.params.workspace_id || req.query.workspace_id || req.body?.workspace_id;

        if (!workspaceId) {
            return res.status(400).json({ success: false, error: 'workspace_id is required' });
        }

        const membership = req.user?.workspaces?.find((w) => w.id === workspaceId);

        if (!membership) {
            return res.status(403).json({ success: false, error: 'No access to this workspace' });
        }

        if (minRole) {
            const userLevel = roleHierarchy[membership.role] ?? -1;
            const requiredLevel = roleHierarchy[minRole] ?? 0;
            if (userLevel < requiredLevel) {
                return res.status(403).json({
                    success: false,
                    error: `Requires workspace ${minRole} role or higher`,
                });
            }
        }

        req.workspaceRole = membership.role;
        next();
    };
}
