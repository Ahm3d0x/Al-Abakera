import { Router, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// 1. Get Active Season Details
router.get('/active', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data: activeSeason, error } = await supabaseAdmin
      .from('seasons')
      .select('*')
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!activeSeason) {
      return res.json({ activeSeason: null, daysRemaining: 0 });
    }

    // Calculate days remaining
    const endDate = new Date(activeSeason.end_date);
    const now = new Date();
    const msDiff = endDate.getTime() - now.getTime();
    const daysRemaining = Math.max(0, Math.ceil(msDiff / (1000 * 60 * 60 * 24)));

    return res.json({
      activeSeason,
      daysRemaining
    });
  } catch (err: any) {
    console.error('[Seasons] Active season fetch error:', err);
    return res.status(500).json({ error: 'Internal server error fetching active season' });
  }
});

// 2. Get Seasons Archive Leaderboards
router.get('/archive', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data: archive, error } = await supabaseAdmin
      .from('season_rankings_archive')
      .select(`
        id,
        season_id,
        user_id,
        username,
        rank_tier,
        rank_points,
        placement,
        rewards_awarded,
        archived_at,
        seasons (
          name,
          theme
        )
      `)
      .order('archived_at', { ascending: false })
      .order('placement', { ascending: true });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json(archive || []);
  } catch (err: any) {
    console.error('[Seasons] Archive fetch error:', err);
    return res.status(500).json({ error: 'Internal server error fetching season archives' });
  }
});

// 3. Claim Milestone Reward
router.post('/claim-milestone', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  const { milestoneRp } = req.body;
  const userId = req.profile?.id;

  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (milestoneRp === undefined || typeof milestoneRp !== 'number') {
    return res.status(400).json({ error: 'Valid milestoneRp target is required' });
  }

  try {
    // Fetch active season
    const { data: activeSeason, error: seasonErr } = await supabaseAdmin
      .from('seasons')
      .select('*')
      .eq('is_active', true)
      .maybeSingle();

    if (seasonErr || !activeSeason) {
      return res.status(404).json({ error: 'Active season not found' });
    }

    // Find milestone in active season configuration
    const milestones = activeSeason.rewards || [];
    const milestone = milestones.find((m: any) => m.rp === milestoneRp);
    if (!milestone) {
      return res.status(400).json({ error: 'No milestone found matching the target RP' });
    }

    // Fetch player profile
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('coins, rank_points, inventory, claimed_season_rewards')
      .eq('id', userId)
      .single();

    if (profileErr || !profile) {
      return res.status(404).json({ error: 'Player profile not found' });
    }

    const currentRp = profile.rank_points || 0;
    const claimedRewards = profile.claimed_season_rewards || [];
    const inventory = profile.inventory || [];
    const coins = profile.coins || 0;

    // Validate RP requirements
    if (currentRp < milestoneRp) {
      return res.status(400).json({ error: `Insufficient Rank Points. You need ${milestoneRp} RP, currently at ${currentRp} RP.` });
    }

    // Check if already claimed
    const milestoneId = `season_${activeSeason.id}_milestone_${milestoneRp}`;
    if (claimedRewards.includes(milestoneId)) {
      return res.status(400).json({ error: 'This milestone reward has already been claimed.' });
    }

    // Award rewards
    const coinsEarned = milestone.coins || 0;
    const badgeKey = milestone.badge;
    const cosmeticKey = milestone.cosmetic;

    // Update coins balance
    const updatedCoins = coins + coinsEarned;

    // Update cosmetics inventory
    const updatedInventory = [...inventory];
    if (cosmeticKey && !updatedInventory.includes(cosmeticKey)) {
      updatedInventory.push(cosmeticKey);
    }

    // Append to claimed rewards history
    const updatedClaims = [...claimedRewards, milestoneId];

    // Award badge via RPC
    if (badgeKey) {
      await supabaseAdmin.rpc('award_badge_if_not_earned', {
        p_user_id: userId,
        p_badge_key: badgeKey
      });
    }

    // Save updates in DB
    const { error: updateErr } = await supabaseAdmin
      .from('profiles')
      .update({
        coins: updatedCoins,
        inventory: updatedInventory,
        claimed_season_rewards: updatedClaims
      })
      .eq('id', userId);

    if (updateErr) {
      return res.status(500).json({ error: updateErr.message });
    }

    return res.json({
      status: 'success',
      coins: updatedCoins,
      inventory: updatedInventory,
      claimedSeasonRewards: updatedClaims
    });
  } catch (err: any) {
    console.error('[Seasons] Claim milestone error:', err);
    return res.status(500).json({ error: 'Internal server error claiming milestone reward' });
  }
});

// 4. Conclude Season (Admin only)
router.post('/conclude', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  const isAdmin = req.profile?.isAdmin;
  if (!isAdmin) {
    return res.status(403).json({ error: 'Forbidden: Only administrators can conclude a season' });
  }

  const {
    newSeasonName,
    newSeasonTheme,
    newSeasonDescription,
    newSeasonStart,
    newSeasonEnd,
    newSeasonRewards
  } = req.body;

  if (!newSeasonName || !newSeasonStart || !newSeasonEnd) {
    return res.status(400).json({ error: 'Missing required parameters: newSeasonName, newSeasonStart, newSeasonEnd' });
  }

  try {
    // Execute RPC transaction
    const { error } = await supabaseAdmin.rpc('conclude_and_reset_season', {
      p_new_season_name: newSeasonName,
      p_new_season_theme: newSeasonTheme || '',
      p_new_season_description: newSeasonDescription || '',
      p_new_season_start: newSeasonStart,
      p_new_season_end: newSeasonEnd,
      p_new_season_rewards: newSeasonRewards || []
    });

    if (error) {
      console.error('[Seasons] Conclude RPC error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({
      status: 'success',
      message: 'Season concluded successfully, ranks archived, user RP reset, and new season started.'
    });
  } catch (err: any) {
    console.error('[Seasons] Conclude season error:', err);
    return res.status(500).json({ error: 'Internal server error concluding season' });
  }
});

export default router;
