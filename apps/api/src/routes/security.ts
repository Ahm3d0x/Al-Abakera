import { Router } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { supabaseAdmin } from '../lib/supabase';

const router = Router();

// Log security event helper
export async function logSecurityEvent(
  userId: string | null,
  username: string | null,
  action: string,
  ip: string | null,
  fingerprint: string | null,
  metadata: any = {}
) {
  try {
    await supabaseAdmin.from('security_events').insert({
      user_id: userId,
      username: username || 'anonymous',
      action,
      ip_address: ip,
      device_fingerprint: fingerprint,
      metadata,
    });
  } catch (err) {
    console.error('[Security Log] Error logging security event:', err);
  }
}

// POST /api/v1/security/verify-device
router.post('/verify-device', requireAuth as any, async (req: AuthenticatedRequest, res) => {
  const { fingerprint } = req.body;
  const userId = req.profile?.id;
  const username = req.profile?.username;
  const ip = req.ip || req.headers['x-forwarded-for']?.toString() || null;

  if (!fingerprint) {
    return res.status(400).json({ error: 'Device fingerprint is required' });
  }

  try {
    // 1. Fetch user's current profile details
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('is_suspended, suspension_reason, device_fingerprint')
      .eq('id', userId)
      .single();

    if (profileErr || !profile) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    // 2. Check if suspended
    if (profile.is_suspended) {
      await logSecurityEvent(
        userId || null,
        username || null,
        'security:blocked_suspended_attempt',
        ip,
        fingerprint,
        { reason: profile.suspension_reason }
      );
      return res.json({
        status: 'suspended',
        reason: profile.suspension_reason || 'No reason specified',
      });
    }

    // 3. Check if fingerprint is owned by another profile
    const { data: conflicts, error: conflictErr } = await supabaseAdmin
      .from('profiles')
      .select('id, username')
      .eq('device_fingerprint', fingerprint)
      .neq('id', userId)
      .limit(1);

    if (conflictErr) {
      console.error('[Security] Error checking fingerprint conflict:', conflictErr);
      return res.status(500).json({ error: 'Database check failed' });
    }

    if (conflicts && conflicts.length > 0) {
      // Fingerprint owned by another user! Block them.
      await logSecurityEvent(
        userId || null,
        username || null,
        'security:device_blocked',
        ip,
        fingerprint,
        { conflict_with_user: conflicts[0].username }
      );
      return res.json({
        status: 'blocked',
        reason: 'device_in_use',
        message: 'This device is already associated with another account.',
      });
    }

    // 4. Update current user's profile with fingerprint if it's different or empty
    if (profile.device_fingerprint !== fingerprint) {
      const { error: updateErr } = await supabaseAdmin
        .from('profiles')
        .update({ device_fingerprint: fingerprint })
        .eq('id', userId);

      if (updateErr) {
        console.error('[Security] Error updating user fingerprint:', updateErr);
        return res.status(500).json({ error: 'Failed to bind device fingerprint' });
      }

      await logSecurityEvent(
        userId || null,
        username || null,
        'auth:device_bound',
        ip,
        fingerprint,
        { old_fingerprint: profile.device_fingerprint }
      );
    } else {
      await logSecurityEvent(
        userId || null,
        username || null,
        'auth:device_verify',
        ip,
        fingerprint
      );
    }

    return res.json({ status: 'verified' });
  } catch (err: any) {
    console.error('[Security] Verify exception:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/security/appeal
router.post('/appeal', requireAuth as any, async (req: AuthenticatedRequest, res) => {
  const { fingerprint, reason } = req.body;
  const userId = req.profile?.id;
  const username = req.profile?.username;
  const ip = req.ip || req.headers['x-forwarded-for']?.toString() || null;

  if (!fingerprint || !reason) {
    return res.status(400).json({ error: 'Fingerprint and reason are required' });
  }

  try {
    // Check if there is already a pending appeal for this user and device
    const { data: existing } = await supabaseAdmin
      .from('device_appeals')
      .select('id')
      .eq('user_id', userId)
      .eq('device_fingerprint', fingerprint)
      .eq('status', 'PENDING')
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ error: 'You already have a pending appeal for this device.' });
    }

    const { error: insertErr } = await supabaseAdmin
      .from('device_appeals')
      .insert({
        user_id: userId,
        username: username || 'player',
        device_fingerprint: fingerprint,
        reason,
        status: 'PENDING',
      });

    if (insertErr) {
      console.error('[Security] Error inserting appeal:', insertErr);
      return res.status(500).json({ error: 'Failed to submit appeal' });
    }

    await logSecurityEvent(
      userId || null,
      username || null,
      'security:device_appeal_submitted',
      ip,
      fingerprint,
      { reason }
    );

    return res.json({ status: 'success', message: 'Appeal submitted successfully.' });
  } catch (err: any) {
    console.error('[Security] Appeal exception:', err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
