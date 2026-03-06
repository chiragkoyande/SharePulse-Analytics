// ============================================
// Workspace Routes — /workspaces/*
// ============================================
// CRUD for workspaces, member management,
// and WhatsApp group connections.
// ============================================

import { Router } from 'express';
import { supabase } from '../db.js';
import { requireAuth, requireSuperAdmin, requireWorkspaceAccess } from '../middleware/authMiddleware.js';
import { requestGroupHistoryScan } from '../bot.js';

const router = Router();

function normalizeWhatsAppGroupId(rawId) {
    const value = String(rawId || '').trim();
    if (!value) return '';
    return value.includes('@') ? value : `${value}@g.us`;
}

// ── GET /workspaces ─────────────────────────
// Returns workspaces the authenticated user belongs to.
// Super admin sees all workspaces.

router.get('/workspaces', requireAuth, async (req, res, next) => {
    try {
        if (req.user.isSuperAdmin) {
            const { data, error } = await supabase
                .from('workspaces')
                .select('*')
                .order('created_at', { ascending: true });
            if (error) throw error;
            return res.json({
                success: true,
                data: (data || []).map((w) => ({ ...w, my_role: 'super_admin' })),
            });
        }

        // Regular users: only their workspaces
        const wsIds = req.user.workspaces.map((w) => w.id);
        if (wsIds.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const { data, error } = await supabase
            .from('workspaces')
            .select('*')
            .in('id', wsIds)
            .order('created_at', { ascending: true });

        if (error) throw error;
        const roleByWorkspaceId = new Map((req.user.workspaces || []).map((w) => [w.id, w.role]));
        res.json({
            success: true,
            data: (data || []).map((w) => ({ ...w, my_role: roleByWorkspaceId.get(w.id) || 'member' })),
        });
    } catch (error) {
        next(error);
    }
});

// ── POST /workspaces ────────────────────────
// Super admin creates a new workspace.

router.post('/workspaces', requireAuth, requireSuperAdmin, async (req, res, next) => {
    try {
        const { name, slug, description, color, owner_email } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, error: 'Workspace name is required' });
        }

        const finalSlug = (slug || name).trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');

        const { data: workspace, error } = await supabase
            .from('workspaces')
            .insert({
                name: name.trim(),
                slug: finalSlug,
                description: (description || '').trim(),
                color: color || '#0ea5e9',
                created_by: req.user.email,
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') {
                return res.status(409).json({ success: false, error: 'A workspace with this slug already exists' });
            }
            throw error;
        }

        // Add creator as owner
        await supabase.from('workspace_members').insert({
            workspace_id: workspace.id,
            user_email: req.user.email,
            role: 'owner',
        });

        // If owner_email provided and different, add them as owner too
        if (owner_email && owner_email !== req.user.email) {
            await supabase.from('workspace_members').insert({
                workspace_id: workspace.id,
                user_email: owner_email.toLowerCase().trim(),
                role: 'owner',
            });
        }

        res.status(201).json({ success: true, data: workspace });
    } catch (error) {
        next(error);
    }
});

// ── PUT /workspaces/:workspace_id ───────────
// Workspace owner/admin can update details.

router.put('/workspaces/:workspace_id', requireAuth, requireWorkspaceAccess('admin'), async (req, res, next) => {
    try {
        const { workspace_id } = req.params;
        const { name, description, color } = req.body;

        const updateData = {};
        if (name !== undefined) updateData.name = name.trim();
        if (description !== undefined) updateData.description = description.trim();
        if (color !== undefined) updateData.color = color;

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ success: false, error: 'No fields to update' });
        }

        const { data, error } = await supabase
            .from('workspaces')
            .update(updateData)
            .eq('id', workspace_id)
            .select()
            .single();

        if (error) throw error;
        if (!data) return res.status(404).json({ success: false, error: 'Workspace not found' });

        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

// ── DELETE /workspaces/:workspace_id ────────
// Super admin only.

router.delete('/workspaces/:workspace_id', requireAuth, requireSuperAdmin, async (req, res, next) => {
    try {
        const { workspace_id } = req.params;

        const { error } = await supabase
            .from('workspaces')
            .delete()
            .eq('id', workspace_id);

        if (error) throw error;
        res.json({ success: true, message: 'Workspace deleted' });
    } catch (error) {
        next(error);
    }
});

// ── GET /workspaces/:workspace_id/members ───
// List members of a workspace.

router.get('/workspaces/:workspace_id/members', requireAuth, requireWorkspaceAccess(), async (req, res, next) => {
    try {
        const { workspace_id } = req.params;

        const { data, error } = await supabase
            .from('workspace_members')
            .select('id, user_email, role, joined_at')
            .eq('workspace_id', workspace_id)
            .order('joined_at', { ascending: true });

        if (error) throw error;
        res.json({ success: true, data: data || [] });
    } catch (error) {
        next(error);
    }
});

// ── POST /workspaces/:workspace_id/members ──
// Add member to workspace (owner/admin only).

router.post('/workspaces/:workspace_id/members', requireAuth, requireWorkspaceAccess('admin'), async (req, res, next) => {
    try {
        const { workspace_id } = req.params;
        const { email, role } = req.body;

        if (!email || !email.includes('@')) {
            return res.status(400).json({ success: false, error: 'Valid email is required' });
        }

        const memberRole = ['owner', 'admin', 'member'].includes(role) ? role : 'member';

        const { data, error } = await supabase
            .from('workspace_members')
            .insert({
                workspace_id,
                user_email: email.toLowerCase().trim(),
                role: memberRole,
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') {
                return res.status(409).json({ success: false, error: 'User is already a member of this workspace' });
            }
            throw error;
        }

        res.status(201).json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

// ── PUT /workspaces/:workspace_id/members/:email ─
// Change member role (owner only).

router.put('/workspaces/:workspace_id/members/:email', requireAuth, requireWorkspaceAccess('owner'), async (req, res, next) => {
    try {
        const { workspace_id, email } = req.params;
        const { role } = req.body;

        if (!['owner', 'admin', 'member'].includes(role)) {
            return res.status(400).json({ success: false, error: 'Role must be owner, admin, or member' });
        }

        const { data, error } = await supabase
            .from('workspace_members')
            .update({ role })
            .eq('workspace_id', workspace_id)
            .eq('user_email', email.toLowerCase().trim())
            .select()
            .single();

        if (error) throw error;
        if (!data) return res.status(404).json({ success: false, error: 'Member not found' });

        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

// ── DELETE /workspaces/:workspace_id/members/:email ─
// Remove member (owner/admin only).

router.delete('/workspaces/:workspace_id/members/:email', requireAuth, requireWorkspaceAccess('admin'), async (req, res, next) => {
    try {
        const { workspace_id, email } = req.params;

        const { error } = await supabase
            .from('workspace_members')
            .delete()
            .eq('workspace_id', workspace_id)
            .eq('user_email', email.toLowerCase().trim());

        if (error) throw error;
        res.json({ success: true, message: `${email} removed from workspace` });
    } catch (error) {
        next(error);
    }
});

// ── GET /workspaces/:workspace_id/groups ────
// List WhatsApp groups connected to workspace.

router.get('/workspaces/:workspace_id/groups', requireAuth, requireWorkspaceAccess(), async (req, res, next) => {
    try {
        const { workspace_id } = req.params;

        const { data, error } = await supabase
            .from('workspace_groups')
            .select('id, whatsapp_group_id, name, status, created_at')
            .eq('workspace_id', workspace_id)
            .order('created_at', { ascending: true });

        if (error) throw error;
        res.json({ success: true, data: data || [] });
    } catch (error) {
        next(error);
    }
});

// ── POST /workspaces/:workspace_id/groups ───
// Connect WhatsApp group to workspace (admin only).

router.post('/workspaces/:workspace_id/groups', requireAuth, requireWorkspaceAccess('admin'), async (req, res, next) => {
    try {
        const { workspace_id } = req.params;
        const { whatsapp_group_id, name } = req.body;
        const normalizedGroupId = normalizeWhatsAppGroupId(whatsapp_group_id);

        if (!normalizedGroupId) {
            return res.status(400).json({ success: false, error: 'WhatsApp group ID is required' });
        }

        const { data, error } = await supabase
            .from('workspace_groups')
            .insert({
                workspace_id,
                whatsapp_group_id: normalizedGroupId,
                name: (name || 'Unnamed Group').trim(),
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') {
                return res.status(409).json({ success: false, error: 'This WhatsApp group is already connected' });
            }
            throw error;
        }

        const scanStatus = requestGroupHistoryScan(data.whatsapp_group_id);

        res.status(201).json({
            success: true,
            data,
            history_scan: scanStatus,
        });
    } catch (error) {
        next(error);
    }
});

// ── DELETE /workspaces/:workspace_id/groups/:gid ─
// Disconnect WhatsApp group (admin only).

router.delete('/workspaces/:workspace_id/groups/:gid', requireAuth, requireWorkspaceAccess('admin'), async (req, res, next) => {
    try {
        const { gid } = req.params;

        const { error } = await supabase
            .from('workspace_groups')
            .delete()
            .eq('id', gid);

        if (error) throw error;
        res.json({ success: true, message: 'WhatsApp group disconnected' });
    } catch (error) {
        next(error);
    }
});

export default router;
