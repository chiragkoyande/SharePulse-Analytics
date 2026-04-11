import { Router } from 'express';
import { supabase } from '../db.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = Router();

/**
 * Helper: resolve workspace scope from query/body + user context.
 * Non-super-admins are restricted to their own workspace memberships.
 */
function getWorkspaceScope(req) {
    const explicit = req.query.workspace_id || req.body?.workspace_id || null;
    const isSuperAdmin = !!req.user?.isSuperAdmin;
    const userWorkspaceIds = (req.user?.workspaces || []).map((w) => w.id);

    // If a specific workspace is requested, verify access
    if (explicit) {
        if (!isSuperAdmin && !userWorkspaceIds.includes(explicit)) {
            return { denied: true };
        }
        return { workspaceId: explicit, userWorkspaceIds, isSuperAdmin };
    }

    // No explicit workspace — super admins see everything, others see only their workspaces
    return { workspaceId: null, userWorkspaceIds, isSuperAdmin };
}

/**
 * Apply workspace filtering to a Supabase query.
 */
function applyWorkspaceFilter(query, scope) {
    if (scope.workspaceId) {
        return query.eq('workspace_id', scope.workspaceId);
    }
    if (!scope.isSuperAdmin && scope.userWorkspaceIds.length > 0) {
        return query.in('workspace_id', scope.userWorkspaceIds);
    }
    if (!scope.isSuperAdmin && scope.userWorkspaceIds.length === 0) {
        // User has no workspaces — return nothing
        return query.eq('workspace_id', '00000000-0000-0000-0000-000000000000');
    }
    return query; // super admin, no filter
}

// ── GET /resources ───────────────────────────

router.get('/resources', requireAuth, async (req, res, next) => {
    try {
        const sort = req.query.sort || 'newest';
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        const offset = parseInt(req.query.offset) || 0;
        const scope = getWorkspaceScope(req);
        if (scope.denied) return res.status(403).json({ success: false, error: 'No access to this workspace' });

        let query = supabase
            .from('resources')
            .select('*', { count: 'exact' });

        query = applyWorkspaceFilter(query, scope);

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

router.get('/resources/search', requireAuth, async (req, res, next) => {
    try {
        const q = req.query.q || '';
        const scope = getWorkspaceScope(req);
        if (scope.denied) return res.status(403).json({ success: false, error: 'No access to this workspace' });
        if (!q.trim()) return res.json({ success: true, count: 0, data: [] });

        let query = supabase
            .from('resources')
            .select('*')
            .or(`url.ilike.%${q}%,title.ilike.%${q}%,domain.ilike.%${q}%`);

        query = applyWorkspaceFilter(query, scope);

        const { data, error } = await query
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) throw error;

        res.json({ success: true, query: q, count: data.length, data });
    } catch (error) {
        next(error);
    }
});

// ── GET /stats ───────────────────────────────

router.get('/stats', requireAuth, async (req, res, next) => {
    try {
        const scope = getWorkspaceScope(req);
        if (scope.denied) return res.status(403).json({ success: false, error: 'No access to this workspace' });

        // Total count
        let totalQuery = supabase
            .from('resources')
            .select('*', { count: 'exact', head: true });
        totalQuery = applyWorkspaceFilter(totalQuery, scope);
        const { count: total } = await totalQuery;

        // All resources for aggregation
        let allQuery = supabase
            .from('resources')
            .select('share_count, like_count, dislike_count, domain');
        allQuery = applyWorkspaceFilter(allQuery, scope);
        const { data: all } = await allQuery;

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
        const todayStr = new Date().toISOString().split('T')[0];
        let todayQuery = supabase
            .from('resources')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', todayStr);
        todayQuery = applyWorkspaceFilter(todayQuery, scope);
        const { count: todayCount } = await todayQuery;

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

// ── DELETE /resources/:id ───────────────────
// Admin or super_admin can remove a link.
router.delete('/resources/:id', requireAuth, async (req, res, next) => {
    try {
        const { id } = req.params;
        if (!id) return res.status(400).json({ success: false, error: 'Resource id is required' });

        if (!['admin', 'super_admin'].includes(req.user?.role)) {
            return res.status(403).json({ success: false, error: 'Admin access required' });
        }

        const { data: resource, error: fetchErr } = await supabase
            .from('resources')
            .select('id, workspace_id')
            .eq('id', id)
            .maybeSingle();

        if (fetchErr) throw fetchErr;
        if (!resource) return res.status(404).json({ success: false, error: 'Resource not found' });

        if (!req.user.isSuperAdmin) {
            const member = (req.user.workspaces || []).find((w) => w.id === resource.workspace_id);
            const allowed = member && ['admin', 'owner'].includes(member.role);
            if (!allowed) {
                return res.status(403).json({ success: false, error: 'No admin access for this workspace' });
            }
        }

        const { error: delErr } = await supabase
            .from('resources')
            .delete()
            .eq('id', id);
        if (delErr) throw delErr;

        res.json({ success: true, message: 'Resource removed', id });
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
                .insert({ user_id: userId, url_hash, vote });
            if (insertVoteErr) {
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
                .eq('url_hash', url_hash).eq('vote', 'like');
            const { count: dislikeCount } = await supabase
                .from('resource_votes')
                .select('*', { count: 'exact', head: true })
                .eq('url_hash', url_hash).eq('vote', 'dislike');
            return res.json({
                success: true, unchanged: true,
                message: `You already voted "${vote}" for this link`,
                like_count: likeCount || 0, dislike_count: dislikeCount || 0,
            });
        } else {
            const { error: switchErr } = await supabase
                .from('resource_votes')
                .update({ vote, updated_at: new Date().toISOString() })
                .eq('id', existingVote.id);
            if (switchErr) throw switchErr;
        }

        // Recalculate counts
        const { count: likeCount } = await supabase
            .from('resource_votes')
            .select('*', { count: 'exact', head: true })
            .eq('url_hash', url_hash).eq('vote', 'like');
        const { count: dislikeCount } = await supabase
            .from('resource_votes')
            .select('*', { count: 'exact', head: true })
            .eq('url_hash', url_hash).eq('vote', 'dislike');

        await supabase.from('resources')
            .update({ like_count: likeCount || 0, dislike_count: dislikeCount || 0 })
            .eq('id', data[0].id);

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
                .insert({ user_id: userId, url_hash });
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

router.get('/export/csv', requireAuth, async (req, res, next) => {
    try {
        const scope = getWorkspaceScope(req);
        if (scope.denied) return res.status(403).json({ success: false, error: 'No access to this workspace' });

        let query = supabase
            .from('resources')
            .select('url, url_hash, title, domain, like_count, dislike_count, share_count, created_at')
            .order('created_at', { ascending: false });

        query = applyWorkspaceFilter(query, scope);

        const { data, error } = await query;

        if (error) throw error;

        const headers = ['url', 'title', 'domain', 'like_count', 'dislike_count', 'share_count', 'created_at'];
        const csvRows = [headers.join(',')];

        (data || []).forEach((row) => {
            const values = headers.map((h) => {
                const val = row[h] ?? '';
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
