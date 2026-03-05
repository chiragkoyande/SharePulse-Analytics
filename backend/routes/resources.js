// ============================================
// Express Routes — Resources, Voting, Export
// ============================================

import { Router } from 'express';
import { supabase } from '../db.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = Router();

// ── GET /resources ───────────────────────────
// Supports ?sort=popular|newest (default: newest)

router.get('/resources', async (req, res, next) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        const offset = parseInt(req.query.offset) || 0;
        const sort = req.query.sort || 'newest';

        let query = supabase
            .from('resources')
            .select('*', { count: 'exact' });

        if (sort === 'popular') {
            query = query
                .order('like_count', { ascending: false })
                .order('share_count', { ascending: false })
                .order('created_at', { ascending: false });
        } else {
            query = query.order('created_at', { ascending: false });
        }

        const { data, error, count } = await query.range(offset, offset + limit - 1);

        if (error) throw error;

        res.json({ success: true, count: data.length, total: count, data });
    } catch (error) {
        next(error);
    }
});

// ── GET /resources/search?q= ─────────────────

router.get('/resources/search', async (req, res, next) => {
    try {
        const q = req.query.q || '';
        if (!q.trim()) return res.json({ success: true, count: 0, data: [] });

        const { data, error } = await supabase
            .from('resources')
            .select('*')
            .or(`url.ilike.%${q}%,title.ilike.%${q}%,domain.ilike.%${q}%`)
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) throw error;

        res.json({ success: true, query: q, count: data.length, data });
    } catch (error) {
        next(error);
    }
});

// ── GET /stats ───────────────────────────────

router.get('/stats', async (req, res, next) => {
    try {
        // Total count
        const { count: total } = await supabase
            .from('resources')
            .select('*', { count: 'exact', head: true });

        // All resources for aggregation
        const { data: all } = await supabase
            .from('resources')
            .select('url, domain, share_count, like_count, dislike_count');

        // Compute totals
        let totalShares = 0;
        let totalVotes = 0;
        const domainCounts = {};

        (all || []).forEach((r) => {
            totalShares += r.share_count || 1;
            totalVotes += (r.like_count || 0) + (r.dislike_count || 0);

            const d = r.domain || 'unknown';
            domainCounts[d] = (domainCounts[d] || 0) + 1;
        });

        const topDomains = Object.entries(domainCounts)
            .map(([domain, count]) => ({ domain, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        // Today's count
        const today = new Date().toISOString().split('T')[0];
        const { count: todayCount } = await supabase
            .from('resources')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', today);

        res.json({
            success: true,
            data: {
                total: total || 0,
                totalShares,
                totalVotes,
                today: todayCount || 0,
                topDomains,
            },
        });
    } catch (error) {
        next(error);
    }
});

// ── POST /vote ───────────────────────────────

router.post('/vote', requireAuth, async (req, res, next) => {
    try {
        const { url_hash, vote } = req.body;
        const userId = req.user?.id;

        if (!userId || !url_hash || !['like', 'dislike'].includes(vote)) {
            return res.status(400).json({
                success: false,
                error: 'Required: url_hash (string) and vote ("like" | "dislike")',
            });
        }

        // Ensure resource exists
        const { data, error: fetchErr } = await supabase
            .from('resources')
            .select('id')
            .eq('url_hash', url_hash)
            .limit(1);

        if (fetchErr) throw fetchErr;
        if (!data || data.length === 0) {
            return res.status(404).json({ success: false, error: 'Resource not found' });
        }

        // One vote per user per link
        const { data: existingVote, error: existingVoteErr } = await supabase
            .from('resource_votes')
            .select('id, vote')
            .eq('user_id', userId)
            .eq('url_hash', url_hash)
            .maybeSingle();

        if (existingVoteErr) throw existingVoteErr;

        if (!existingVote) {
            const { error: insertVoteErr } = await supabase
                .from('resource_votes')
                .insert({
                    user_id: userId,
                    url_hash,
                    vote,
                });
            if (insertVoteErr) {
                // Race-safe fallback: treat unique conflict as already voted and update vote type.
                if (insertVoteErr.code === '23505') {
                    const { error: retryUpdateErr } = await supabase
                        .from('resource_votes')
                        .update({ vote, updated_at: new Date().toISOString() })
                        .eq('user_id', userId)
                        .eq('url_hash', url_hash);
                    if (retryUpdateErr) throw retryUpdateErr;
                } else {
                    throw insertVoteErr;
                }
            }
        } else if (existingVote.vote === vote) {
            const { count: likeCount } = await supabase
                .from('resource_votes')
                .select('*', { count: 'exact', head: true })
                .eq('url_hash', url_hash)
                .eq('vote', 'like');

            const { count: dislikeCount } = await supabase
                .from('resource_votes')
                .select('*', { count: 'exact', head: true })
                .eq('url_hash', url_hash)
                .eq('vote', 'dislike');

            return res.json({
                success: true,
                unchanged: true,
                message: `You already voted "${vote}" for this link`,
                like_count: likeCount || 0,
                dislike_count: dislikeCount || 0,
            });
        } else {
            // Switch vote type (like <-> dislike)
            const { error: switchErr } = await supabase
                .from('resource_votes')
                .update({ vote, updated_at: new Date().toISOString() })
                .eq('id', existingVote.id);
            if (switchErr) throw switchErr;
        }

        // Recalculate counts from canonical vote records
        const { count: likeCount } = await supabase
            .from('resource_votes')
            .select('*', { count: 'exact', head: true })
            .eq('url_hash', url_hash)
            .eq('vote', 'like');

        const { count: dislikeCount } = await supabase
            .from('resource_votes')
            .select('*', { count: 'exact', head: true })
            .eq('url_hash', url_hash)
            .eq('vote', 'dislike');

        const { error: updateErr } = await supabase
            .from('resources')
            .update({
                like_count: likeCount || 0,
                dislike_count: dislikeCount || 0,
            })
            .eq('id', data[0].id);

        if (updateErr) throw updateErr;

        res.json({
            success: true,
            message: `Vote "${vote}" recorded`,
            like_count: likeCount || 0,
            dislike_count: dislikeCount || 0,
        });
    } catch (error) {
        next(error);
    }
});

// ── GET /saved-links ─────────────────────────

router.get('/saved-links', requireAuth, async (req, res, next) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }

        const { data, error } = await supabase
            .from('resource_saves')
            .select('url_hash')
            .eq('user_id', userId);

        if (error) throw error;

        res.json({
            success: true,
            data: (data || []).map((row) => row.url_hash),
        });
    } catch (error) {
        next(error);
    }
});

// ── POST /save-link ──────────────────────────
// Body: { url_hash: string, save: boolean }

router.post('/save-link', requireAuth, async (req, res, next) => {
    try {
        const userId = req.user?.id;
        const { url_hash, save } = req.body;

        if (!userId || !url_hash || typeof save !== 'boolean') {
            return res.status(400).json({
                success: false,
                error: 'Required: url_hash (string), save (boolean)',
            });
        }

        const { data: resource, error: resourceErr } = await supabase
            .from('resources')
            .select('id')
            .eq('url_hash', url_hash)
            .maybeSingle();
        if (resourceErr) throw resourceErr;
        if (!resource) {
            return res.status(404).json({ success: false, error: 'Resource not found' });
        }

        if (save) {
            const { error: insertErr } = await supabase
                .from('resource_saves')
                .insert({
                    user_id: userId,
                    url_hash,
                });

            if (insertErr && insertErr.code !== '23505') throw insertErr;
        } else {
            const { error: deleteErr } = await supabase
                .from('resource_saves')
                .delete()
                .eq('user_id', userId)
                .eq('url_hash', url_hash);

            if (deleteErr) throw deleteErr;
        }

        res.json({
            success: true,
            saved: save,
            message: save ? 'Link saved' : 'Link removed from saved',
        });
    } catch (error) {
        next(error);
    }
});

// ── GET /export/csv ──────────────────────────

router.get('/export/csv', async (req, res, next) => {
    try {
        const { data, error } = await supabase
            .from('resources')
            .select('url, title, domain, like_count, dislike_count, share_count, created_at')
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Build CSV
        const headers = ['url', 'title', 'domain', 'like_count', 'dislike_count', 'share_count', 'created_at'];
        const csvRows = [headers.join(',')];

        (data || []).forEach((row) => {
            const values = headers.map((h) => {
                const val = row[h] ?? '';
                // Escape commas and quotes in values
                const str = String(val).replace(/"/g, '""');
                return `"${str}"`;
            });
            csvRows.push(values.join(','));
        });

        const csv = csvRows.join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="resources_export.csv"');
        res.send(csv);
    } catch (error) {
        next(error);
    }
});

export default router;
