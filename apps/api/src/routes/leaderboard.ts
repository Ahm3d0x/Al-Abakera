import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { supabaseAdmin } from '../lib/supabase';
import { getCachedData, setCachedData } from '../lib/cache';

const router = Router();

// GET /api/v1/leaderboard
router.get('/', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  const category = String(req.query.category || 'Global');
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 10)));
  const cacheKey = `leaderboard:${category}:${limit}`;

  try {
    // 1. Try cache lookup
    const cached = await getCachedData(cacheKey);
    if (cached) {
      return res.json({ status: 'success', leaderboard: cached, cached: true });
    }

    // 2. Query DB
    let leaderboardData: any[] = [];
    const { data, error } = await supabaseAdmin.rpc('get_category_leaderboard', {
      p_category: category,
      p_limit: limit
    });

    if (!error && data) {
      leaderboardData = data;
    } else {
      console.warn('[Leaderboard Route] RPC error or not deployed. Falling back to query.', error);
      // Fallback for Global leaderboard
      if (category === 'Global') {
        const { data: fbData, error: fbErr } = await supabaseAdmin
          .from('profiles')
          .select('username, rank, rank_points, coins, stats')
          .order('rank_points', { ascending: false })
          .limit(limit);

        if (fbErr) {
          return res.status(500).json({ error: fbErr.message });
        }
        leaderboardData = fbData || [];
      } else {
        leaderboardData = [];
      }
    }

    // 3. Cache the result for 60 seconds (1 minute)
    await setCachedData(cacheKey, leaderboardData, 60);

    return res.json({ status: 'success', leaderboard: leaderboardData, cached: false });
  } catch (err: any) {
    console.error('[Leaderboard Route] Exception:', err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
