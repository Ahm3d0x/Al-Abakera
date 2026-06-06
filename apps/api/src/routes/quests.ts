import { Router, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Claim Quest Reward
router.post('/claim', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  const { questId, type } = req.body;
  const userId = req.profile?.id;

  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!questId || (type !== 'daily' && type !== 'weekly')) {
    return res.status(400).json({ error: 'Missing or invalid parameters' });
  }

  try {
    const { data: profile, error: fetchErr } = await supabaseAdmin
      .from('profiles')
      .select('coins, creator_tokens, quests')
      .eq('id', userId)
      .single();

    if (fetchErr || !profile) {
      return res.status(404).json({ error: 'Player profile not found' });
    }

    const coins = profile.coins || 0;
    const creatorTokens = profile.creator_tokens || 0;
    const quests = profile.quests || {};

    const group = quests[type] || {};
    const questList = group.quests || [];

    // Find the quest
    const questIndex = (questList as any[]).findIndex((q: any) => q.id === questId);
    if (questIndex === -1) {
      return res.status(404).json({ error: 'Quest not found' });
    }

    const quest = questList[questIndex];

    // Check completion status
    if (Number(quest.progress || 0) < Number(quest.target || 1)) {
      return res.status(400).json({ error: 'Quest is not yet completed' });
    }

    // Check claimed status
    if (quest.claimed) {
      return res.status(400).json({ error: 'Quest reward has already been claimed' });
    }

    // Mark as claimed and award currency rewards
    quest.claimed = true;
    const coinsReward = Number(quest.reward_coins || 0);
    const tokensReward = Number(quest.reward_tokens || 0);

    const updatedCoins = coins + coinsReward;
    const updatedTokens = creatorTokens + tokensReward;

    // Update quest array in JSONB
    questList[questIndex] = quest;
    const updatedQuests = {
      ...quests,
      [type]: {
        ...group,
        quests: questList
      }
    };

    const { error: updateErr } = await supabaseAdmin
      .from('profiles')
      .update({
        coins: updatedCoins,
        creator_tokens: updatedTokens,
        quests: updatedQuests
      })
      .eq('id', userId);

    if (updateErr) {
      return res.status(500).json({ error: updateErr.message });
    }

    return res.json({
      status: 'success',
      coins: updatedCoins,
      creatorTokens: updatedTokens,
      quests: updatedQuests
    });
  } catch (err: any) {
    console.error('[Quests] Claim error:', err);
    return res.status(500).json({ error: 'Internal server error claiming quest reward' });
  }
});

export default router;
