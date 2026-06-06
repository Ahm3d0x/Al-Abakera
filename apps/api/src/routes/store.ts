import { Router, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Static Cosmetics Catalog
const COSMETICS_CATALOG: Record<string, { key: string; name: string; cost: number; category: 'border' | 'effect' }> = {
  cyber_neon: { key: 'cyber_neon', name: 'Cyber Neon Border', cost: 500, category: 'border' },
  gold_halo: { key: 'gold_halo', name: 'Gold Halo Border', cost: 1500, category: 'border' },
  dark_matter: { key: 'dark_matter', name: 'Dark Matter Border', cost: 2500, category: 'border' },
  laser_strike: { key: 'laser_strike', name: 'Laser Strike Effect', cost: 800, category: 'effect' },
  firework: { key: 'firework', name: 'Firework Sparkle Effect', cost: 1200, category: 'effect' },
  matrix_rain: { key: 'matrix_rain', name: 'Matrix Rain Effect', cost: 2000, category: 'effect' }
};

// 1. Buy Cosmetic
router.post('/buy', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  const { cosmeticKey } = req.body;
  const userId = req.profile?.id;

  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!cosmeticKey || !COSMETICS_CATALOG[cosmeticKey]) {
    return res.status(400).json({ error: 'Invalid or missing cosmetic key' });
  }

  const cosmetic = COSMETICS_CATALOG[cosmeticKey];

  try {
    const { data: profile, error: fetchErr } = await supabaseAdmin
      .from('profiles')
      .select('coins, inventory')
      .eq('id', userId)
      .single();

    if (fetchErr || !profile) {
      return res.status(404).json({ error: 'Player profile not found' });
    }

    const inventory = profile.inventory || [];
    const coins = profile.coins || 0;

    // Check ownership
    if (inventory.includes(cosmeticKey)) {
      return res.status(400).json({ error: 'You already own this item' });
    }

    // Check balance
    if (coins < cosmetic.cost) {
      return res.status(400).json({ error: 'Insufficient coins' });
    }

    // Process purchase
    const updatedInventory = [...inventory, cosmeticKey];
    const updatedCoins = coins - cosmetic.cost;

    const { error: updateErr } = await supabaseAdmin
      .from('profiles')
      .update({
        coins: updatedCoins,
        inventory: updatedInventory
      })
      .eq('id', userId);

    if (updateErr) {
      return res.status(500).json({ error: updateErr.message });
    }

    return res.json({
      status: 'success',
      coins: updatedCoins,
      inventory: updatedInventory
    });
  } catch (err: any) {
    console.error('[Store] Buy error:', err);
    return res.status(500).json({ error: 'Internal server error processing purchase' });
  }
});

// 2. Equip Cosmetic
router.post('/equip', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  const { category, key } = req.body;
  const userId = req.profile?.id;

  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!category || (category !== 'border' && category !== 'effect' && category !== 'avatar')) {
    return res.status(400).json({ error: 'Invalid or missing cosmetic category' });
  }

  try {
    const { data: profile, error: fetchErr } = await supabaseAdmin
      .from('profiles')
      .select('inventory, equipped')
      .eq('id', userId)
      .single();

    if (fetchErr || !profile) {
      return res.status(404).json({ error: 'Player profile not found' });
    }

    const inventory = profile.inventory || [];
    const equipped = profile.equipped || { border: null, effect: null, avatar: null };

    // Validate ownership
    if (key !== null && !inventory.includes(key)) {
      return res.status(400).json({ error: 'You do not own this cosmetic item' });
    }

    // Update equipped configuration
    const updatedEquipped = {
      ...equipped,
      [category]: key
    };

    const { error: updateErr } = await supabaseAdmin
      .from('profiles')
      .update({
        equipped: updatedEquipped
      })
      .eq('id', userId);

    if (updateErr) {
      return res.status(500).json({ error: updateErr.message });
    }

    return res.json({
      status: 'success',
      equipped: updatedEquipped
    });
  } catch (err: any) {
    console.error('[Store] Equip error:', err);
    return res.status(500).json({ error: 'Internal server error equipping cosmetic' });
  }
});

export default router;
