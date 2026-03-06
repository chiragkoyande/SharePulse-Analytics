// ============================================
// Admin Routes — /admin/*
// ============================================
// Admin-only endpoints for managing users
// and access requests.
// ============================================

import { Router } from 'express';
import { supabase } from '../db.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { decryptRequestPassword } from '../utils/requestPasswordCipher.js';
import { notifyAccessApproved } from '../utils/emailNotifier.js';
import { requestGroupHistoryScan } from '../bot.js';

const router = Router();

function normalizeWhatsAppGroupId(rawId) {
    const value = String(rawId || '').trim();
    if (!value) return '';
    return value.includes('@') ? value : `${value}@g.us`;
}

function isMissingWorkspaceColumnError(error) {
    return String(error?.message || '').includes('access_requests.workspace_id');
}

function getAdminWorkspaceIds(req) {
    return (req.user?.workspaces || [])
        .filter((w) => ['admin', 'owner'].includes(w.role))
        .map((w) => w.id);
}

function hasWorkspaceAdminAccess(req, workspaceId) {
    if (req.user?.isSuperAdmin) return true;
    if (!workspaceId) return false;
    return getAdminWorkspaceIds(req).includes(workspaceId);
}

async function listWorkspaceUsers(workspaceId) {
    const { data: members, error: memErr } = await supabase
        .from('workspace_members')
        .select('id, user_email, role')
        .eq('workspace_id', workspaceId)
        .order('joined_at', { ascending: true });
    if (memErr) throw memErr;

    const emails = [...new Set((members || []).map((m) => m.user_email))];
    let users = [];
    if (emails.length > 0) {
        const { data: appUsers, error: appErr } = await supabase
            .from('app_users')
            .select('email, status')
            .in('email', emails);
        if (appErr) throw appErr;
        users = appUsers || [];
    }
    const statusByEmail = new Map(users.map((u) => [u.email, u.status]));

    return (members || []).map((m) => ({
        id: m.id,
        email: m.user_email,
        role: m.role,
        status: statusByEmail.get(m.user_email) || 'active',
    }));
}

// Admin routes require auth + either super admin/global admin
// or workspace-level admin/owner membership.
router.use(requireAuth, (req, res, next) => {
    if (req.user?.isSuperAdmin) return next();
    if (req.user?.role === 'admin') return next();
    if (getAdminWorkspaceIds(req).length > 0) return next();
    return res.status(403).json({ success: false, error: 'Admin access required' });
});

// ── GET /admin/requests ──────────────────────

router.get('/requests', async (req, res, next) => {
    try {
        const status = req.query.status || 'pending';
        const { data: requests, error: reqErr } = await supabase
            .from('access_requests')
            .select('id, email, status, created_at, workspace_id')
            .eq('status', status)
            .order('created_at', { ascending: false });

        if (reqErr) {
            if (!isMissingWorkspaceColumnError(reqErr)) throw reqErr;
            const { data: fallback, error: fallbackErr } = await supabase
                .from('access_requests')
                .select('id, email, status, created_at')
                .eq('status', status)
                .order('created_at', { ascending: false });
            if (fallbackErr) throw fallbackErr;
            return res.json({ success: true, data: (fallback || []).map((r) => ({ ...r, workspace_id: null })) });
        }

        const { data: workspaces, error: wsErr } = await supabase
            .from('workspaces')
            .select('id, name');
        if (wsErr) throw wsErr;
        const wsNameById = new Map((workspaces || []).map((w) => [w.id, w.name]));

        let scoped = requests || [];
        if (!req.user?.isSuperAdmin) {
            const allowed = new Set(getAdminWorkspaceIds(req));
            // Workspace admins can only see requests in their own workspaces or unassigned requests.
            scoped = scoped.filter((r) => !r.workspace_id || allowed.has(r.workspace_id));
        }

        res.json({
            success: true,
            data: scoped.map((r) => ({
                ...r,
                workspace_name: r.workspace_id ? (wsNameById.get(r.workspace_id) || 'Unknown') : null,
            })),
        });
    } catch (error) {
        next(error);
    }
});

// ── POST /admin/approve ──────────────────────

router.post('/approve', async (req, res, next) => {
    try {
        const { email, workspace_id } = req.body;
        if (!email) return res.status(400).json({ success: false, error: 'Email is required' });

        const normalizedEmail = email.toLowerCase().trim();

        let requestRow = null;
        let reqErr = null;

        ({ data: requestRow, error: reqErr } = await supabase
            .from('access_requests')
            .select('id, encrypted_password, status, workspace_id')
            .eq('email', normalizedEmail)
            .maybeSingle());

        if (reqErr && isMissingWorkspaceColumnError(reqErr)) {
            ({ data: requestRow, error: reqErr } = await supabase
                .from('access_requests')
                .select('id, encrypted_password, status')
                .eq('email', normalizedEmail)
                .maybeSingle());
            if (requestRow) requestRow.workspace_id = null;
        }

        if (reqErr) throw reqErr;
        if (!requestRow) {
            return res.status(404).json({ success: false, error: 'Access request not found' });
        }
        if (!requestRow.encrypted_password) {
            return res.status(400).json({ success: false, error: 'No password provided by user for this request' });
        }

        const targetWorkspaceId = workspace_id || requestRow.workspace_id || null;
        if (!targetWorkspaceId) {
            return res.status(400).json({ success: false, error: 'workspace_id is required to approve this request' });
        }
        if (!hasWorkspaceAdminAccess(req, targetWorkspaceId)) {
            return res.status(403).json({ success: false, error: 'No admin access for selected workspace' });
        }

        const { data: workspace, error: wsErr } = await supabase
            .from('workspaces')
            .select('id')
            .eq('id', targetWorkspaceId)
            .maybeSingle();
        if (wsErr) throw wsErr;
        if (!workspace) {
            return res.status(400).json({ success: false, error: 'Selected workspace not found' });
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

        const { error: memberErr } = await supabase
            .from('workspace_members')
            .upsert(
                {
                    workspace_id: targetWorkspaceId,
                    user_email: normalizedEmail,
                    role: 'member',
                },
                { onConflict: 'workspace_id,user_email' }
            );
        if (memberErr) throw memberErr;

        // Update access request status
        await supabase
            .from('access_requests')
            .update({
                status: 'approved',
                encrypted_password: null,
                workspace_id: targetWorkspaceId,
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
        const { email, workspace_id } = req.body;
        if (!email) return res.status(400).json({ success: false, error: 'Email is required' });

        const normalizedEmail = email.toLowerCase().trim();
        const { data: requestRow, error: reqErr } = await supabase
            .from('access_requests')
            .select('id, workspace_id')
            .eq('email', normalizedEmail)
            .maybeSingle();
        if (reqErr && !isMissingWorkspaceColumnError(reqErr)) throw reqErr;
        if (!requestRow) {
            return res.status(404).json({ success: false, error: 'Access request not found' });
        }

        const targetWorkspaceId = workspace_id || requestRow.workspace_id || null;
        if (!req.user?.isSuperAdmin) {
            if (!targetWorkspaceId || !hasWorkspaceAdminAccess(req, targetWorkspaceId)) {
                return res.status(403).json({ success: false, error: 'No admin access for selected workspace' });
            }
        }

        const { error } = await supabase
            .from('access_requests')
            .update({ status: 'rejected', workspace_id: targetWorkspaceId })
            .eq('id', requestRow.id);

        if (error) throw error;

        res.json({ success: true, message: `Request rejected: ${normalizedEmail}` });
    } catch (error) {
        next(error);
    }
});

// ── GET /admin/users ─────────────────────────

router.get('/users', async (req, res, next) => {
    try {
        const workspaceId = req.query.workspace_id;
        if (workspaceId) {
            if (!hasWorkspaceAdminAccess(req, workspaceId)) {
                return res.json({ success: true, data: [] });
            }
            const data = await listWorkspaceUsers(workspaceId);
            return res.json({ success: true, data });
        }

        if (!req.user?.isSuperAdmin) {
            return res.json({ success: true, data: [] });
        }

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
        const { email, workspace_id } = req.body;
        if (!email || !workspace_id) {
            return res.status(400).json({ success: false, error: 'Email and workspace_id are required' });
        }

        const normalizedEmail = email.toLowerCase().trim();
        if (!hasWorkspaceAdminAccess(req, workspace_id)) {
            return res.status(403).json({ success: false, error: 'No admin access for selected workspace' });
        }

        const { data: appUser, error: userErr } = await supabase
            .from('app_users')
            .select('email, status')
            .eq('email', normalizedEmail)
            .maybeSingle();
        if (userErr) throw userErr;
        if (!appUser || appUser.status !== 'active') {
            return res.status(400).json({ success: false, error: 'User must be active before promotion' });
        }

        const { error } = await supabase
            .from('workspace_members')
            .upsert(
                { workspace_id, user_email: normalizedEmail, role: 'admin' },
                { onConflict: 'workspace_id,user_email' }
            );

        if (error) throw error;

        res.json({ success: true, message: `${normalizedEmail} promoted to workspace admin` });
    } catch (error) {
        next(error);
    }
});

// ── POST /admin/revoke ───────────────────────

router.post('/revoke', async (req, res, next) => {
    try {
        const { email, workspace_id, global } = req.body;
        if (!email || !workspace_id) {
            return res.status(400).json({ success: false, error: 'Email and workspace_id are required' });
        }

        const normalizedEmail = email.toLowerCase().trim();
        if (!hasWorkspaceAdminAccess(req, workspace_id)) {
            return res.status(403).json({ success: false, error: 'No admin access for selected workspace' });
        }

        // Prevent self-revoke
        if (normalizedEmail === req.user.email) {
            return res.status(400).json({ success: false, error: 'Cannot revoke your own access' });
        }

        let deletedRows = [];
        if (global && req.user?.isSuperAdmin) {
            const { data, error } = await supabase
                .from('workspace_members')
                .delete()
                .eq('user_email', normalizedEmail)
                .select('id');
            if (error) throw error;
            deletedRows = data || [];
        } else {
            const { data, error } = await supabase
                .from('workspace_members')
                .delete()
                .eq('workspace_id', workspace_id)
                .eq('user_email', normalizedEmail)
                .select('id');
            if (error) throw error;
            deletedRows = data || [];
        }

        if (!deletedRows || deletedRows.length === 0) {
            return res.status(404).json({ success: false, error: 'User is not a member of this workspace' });
        }

        const { count: remainingMemberships, error: countErr } = await supabase
            .from('workspace_members')
            .select('id', { count: 'exact', head: true })
            .eq('user_email', normalizedEmail);
        if (countErr) throw countErr;

        if ((remainingMemberships || 0) === 0) {
            const { error: statusErr } = await supabase
                .from('app_users')
                .update({ status: 'revoked' })
                .eq('email', normalizedEmail);
            if (statusErr) throw statusErr;
        }

        res.json({
            success: true,
            message: global && req.user?.isSuperAdmin
                ? `Global access revoked: ${normalizedEmail}`
                : `Workspace access revoked: ${normalizedEmail}`,
            workspace_memberships_remaining: remainingMemberships || 0,
        });
    } catch (error) {
        next(error);
    }
});

// ── POST /admin/rescan-history ──────────────
// Trigger history scan queue for groups.
router.post('/rescan-history', async (req, res, next) => {
    try {
        const { workspace_id, whatsapp_group_id } = req.body || {};

        let groupRows = [];
        if (whatsapp_group_id) {
            groupRows = [{ whatsapp_group_id: normalizeWhatsAppGroupId(whatsapp_group_id) }];
        } else {
            let query = supabase
                .from('workspace_groups')
                .select('whatsapp_group_id')
                .eq('status', 'active');
            if (workspace_id) query = query.eq('workspace_id', workspace_id);
            const { data, error } = await query;
            if (error) throw error;
            groupRows = data || [];
        }

        const queued = [];
        for (const row of groupRows) {
            const gid = normalizeWhatsAppGroupId(row?.whatsapp_group_id);
            if (!gid) continue;
            queued.push(requestGroupHistoryScan(gid));
        }

        res.json({
            success: true,
            queued_count: queued.filter((q) => q.queued).length,
            data: queued,
        });
    } catch (error) {
        next(error);
    }
});

export default router;
