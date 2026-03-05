// ============================================
// API Client (Frontend — read-only + voting)
// ============================================

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Fetch all resources, with optional sort.
 * @param {'newest'|'popular'} sort
 */
export async function fetchResources(sort = 'newest') {
    let query = supabase
        .from('resources')
        .select('*')
        .limit(200);

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
 * Search resources by URL, title, or domain.
 */
export async function searchResources(query) {
    const { data, error } = await supabase
        .from('resources')
        .select('*')
        .or(`url.ilike.%${query}%,title.ilike.%${query}%,domain.ilike.%${query}%`)
        .order('created_at', { ascending: false })
        .limit(100);

    if (error) throw error;
    return data || [];
}

/**
 * Fetch stats: total, shares, votes, today's count.
 */
export async function fetchStats() {
    const { count: total } = await supabase
        .from('resources')
        .select('*', { count: 'exact', head: true });

    const today = new Date().toISOString().split('T')[0];
    const { count: todayCount } = await supabase
        .from('resources')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', today);

    // Fetch aggregate data
    const { data: all } = await supabase
        .from('resources')
        .select('share_count, like_count, dislike_count');

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
 * Vote on a resource (like or dislike).
 * Uses the backend API endpoint.
 */
export async function voteResource(urlHash, vote, token) {
    if (!token) throw new Error('Please sign in to vote');
    const res = await fetch(`${apiBase}/vote`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ url_hash: urlHash, vote }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Vote failed');
    return json;
}

/**
 * Fetch current user's saved link hashes.
 */
export async function fetchSavedLinks(token) {
    if (!token) return [];

    const res = await fetch(`${apiBase}/saved-links`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Failed to fetch saved links');
    return json.data || [];
}

/**
 * Toggle save state for a link.
 */
export async function saveResource(urlHash, save, token) {
    if (!token) throw new Error('Please sign in to save links');

    const res = await fetch(`${apiBase}/save-link`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ url_hash: urlHash, save }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Failed to update saved link');
    return json;
}

/**
 * Trigger CSV export download from the backend.
 */
export async function exportCsv() {
    const res = await fetch(`${apiBase}/export/csv`);
    if (!res.ok) throw new Error('Export failed');

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'resources_export.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
