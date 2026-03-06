// ============================================
// Frontend API Layer — Workspace-Scoped
// ============================================

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ── Workspace API ────────────────────────────

/**
 * Fetch user's workspaces.
 * @param {string} token Auth token
 */
export async function fetchWorkspaces(token) {
    const res = await fetch(`${apiBase}/workspaces`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Failed to fetch workspaces');
    return json.data || [];
}

/**
 * Create a new workspace (super_admin only).
 */
export async function createWorkspace(token, data) {
    const res = await fetch(`${apiBase}/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    return json.data;
}

/**
 * Update a workspace.
 */
export async function updateWorkspace(token, workspaceId, data) {
    const res = await fetch(`${apiBase}/workspaces/${workspaceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    return json.data;
}

/**
 * Delete a workspace (super_admin only).
 */
export async function deleteWorkspace(token, workspaceId) {
    const res = await fetch(`${apiBase}/workspaces/${workspaceId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    return json;
}

/**
 * List workspace members.
 */
export async function fetchWorkspaceMembers(token, workspaceId) {
    const res = await fetch(`${apiBase}/workspaces/${workspaceId}/members`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    return json.data || [];
}

/**
 * Add member to workspace.
 */
export async function addWorkspaceMember(token, workspaceId, email, role = 'member') {
    const res = await fetch(`${apiBase}/workspaces/${workspaceId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email, role }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    return json.data;
}

/**
 * Remove member from workspace.
 */
export async function removeWorkspaceMember(token, workspaceId, email) {
    const res = await fetch(`${apiBase}/workspaces/${workspaceId}/members/${encodeURIComponent(email)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    return json;
}

/**
 * List workspace WhatsApp groups.
 */
export async function fetchWorkspaceGroups(token, workspaceId) {
    const res = await fetch(`${apiBase}/workspaces/${workspaceId}/groups`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    return json.data || [];
}

/**
 * Add WhatsApp group to workspace.
 */
export async function addWorkspaceGroup(token, workspaceId, whatsapp_group_id, name) {
    const res = await fetch(`${apiBase}/workspaces/${workspaceId}/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ whatsapp_group_id, name }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    return json.data;
}

/**
 * Remove WhatsApp group from workspace.
 */
export async function removeWorkspaceGroup(token, workspaceId, groupId) {
    const res = await fetch(`${apiBase}/workspaces/${workspaceId}/groups/${groupId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    return json;
}

// ── Resource API (workspace-scoped) ──────────

/**
 * Fetch resources, scoped by workspace.
 */
export async function fetchResources(sort = 'newest', workspaceId = null) {
    let query = supabase
        .from('resources')
        .select('*')
        .limit(200);

    if (workspaceId) {
        query = query.eq('workspace_id', workspaceId);
    }

    if (sort === 'popular') {
        query = query
            .order('like_count', { ascending: false })
            .order('share_count', { ascending: false })
            .order('created_at', { ascending: false });
    } else {
        query = query.order('created_at', { ascending: false });
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
}

/**
 * Search resources, scoped by workspace.
 */
export async function searchResources(query, workspaceId = null) {
    let q = supabase
        .from('resources')
        .select('*')
        .or(`url.ilike.%${query}%,title.ilike.%${query}%,domain.ilike.%${query}%`);

    if (workspaceId) {
        q = q.eq('workspace_id', workspaceId);
    }

    const { data, error } = await q
        .order('created_at', { ascending: false })
        .limit(100);

    if (error) throw error;
    return data || [];
}

/**
 * Fetch stats, scoped by workspace.
 */
export async function fetchStats(workspaceId = null) {
    let totalQ = supabase
        .from('resources')
        .select('*', { count: 'exact', head: true });
    if (workspaceId) totalQ = totalQ.eq('workspace_id', workspaceId);
    const { count: total } = await totalQ;

    const today = new Date().toISOString().split('T')[0];
    let todayQ = supabase
        .from('resources')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', today);
    if (workspaceId) todayQ = todayQ.eq('workspace_id', workspaceId);
    const { count: todayCount } = await todayQ;

    let allQ = supabase
        .from('resources')
        .select('share_count, like_count, dislike_count');
    if (workspaceId) allQ = allQ.eq('workspace_id', workspaceId);
    const { data: all } = await allQ;

    let totalShares = 0;
    let totalVotes = 0;
    (all || []).forEach((r) => {
        totalShares += r.share_count || 1;
        totalVotes += (r.like_count || 0) + (r.dislike_count || 0);
    });

    return {
        total: total || 0,
        totalShares,
        totalVotes,
        today: todayCount || 0,
    };
}

/**
 * Vote on a resource link.
 */
export async function voteResource(urlHash, vote, token) {
    const res = await fetch(`${apiBase}/vote`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ url_hash: urlHash, vote }),
    });
    const json = await res.json();
    if (!json.success && !json.unchanged) throw new Error(json.error);
    return json;
}

/**
 * Fetch saved link hashes.
 */
export async function fetchSavedLinks(token) {
    const res = await fetch(`${apiBase}/saved-links`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    return json.data || [];
}

/**
 * Save or unsave a link.
 */
export async function saveResource(urlHash, save, token) {
    const res = await fetch(`${apiBase}/save-link`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ url_hash: urlHash, save }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    return json;
}

/**
 * Delete a resource by id (admin only).
 */
export async function deleteResource(resourceId, token) {
    const res = await fetch(`${apiBase}/resources/${resourceId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Failed to remove resource');
    return json;
}

/**
 * Trigger CSV export download, scoped by workspace.
 */
export async function exportCsv(workspaceId = null) {
    const url = workspaceId
        ? `${apiBase}/export/csv?workspace_id=${workspaceId}`
        : `${apiBase}/export/csv`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Export failed');

    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = 'resources_export.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
}
