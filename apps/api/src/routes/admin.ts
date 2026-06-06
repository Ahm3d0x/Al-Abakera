import { Router } from 'express';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '../middleware/auth';
import { supabaseAdmin } from '../lib/supabase';
import { logSecurityEvent } from './security';

const router = Router();

// Secure all admin routes with auth + admin check
router.use(requireAuth as any);
router.use(requireAdmin as any);

// GET /api/v1/admin/fake-accounts
router.get('/fake-accounts', async (req: AuthenticatedRequest, res) => {
  try {
    // 1. Find device fingerprint overlaps
    const { data: fingerprintOverlaps, error: fError } = await supabaseAdmin
      .from('profiles')
      .select('device_fingerprint, id, username, email, created_at')
      .is('is_suspended', false);

    if (fError) throw fError;

    // Group in JS for rich reporting
    const fingerprintGroups: Record<string, any[]> = {};
    fingerprintOverlaps?.forEach((p: any) => {
      if (p.device_fingerprint) {
        if (!fingerprintGroups[p.device_fingerprint]) {
          fingerprintGroups[p.device_fingerprint] = [];
        }
        fingerprintGroups[p.device_fingerprint].push(p);
      }
    });

    const duplicateFingerprints = Object.entries(fingerprintGroups)
      .filter(([_, users]) => users.length > 1)
      .map(([fp, users]) => ({
        type: 'FINGERPRINT_OVERLAP',
        fingerprint: fp,
        users: users.map(u => ({ id: u.id, username: u.username, email: u.email, createdAt: u.created_at })),
        reason: `${users.length} accounts are sharing the identical device fingerprint.`
      }));

    // 2. Find IP overlaps from security events
    const { data: ipEvents, error: ipError } = await supabaseAdmin
      .from('security_events')
      .select('ip_address, user_id, username, action, timestamp')
      .order('timestamp', { ascending: false });

    if (ipError) throw ipError;

    const ipGroups: Record<string, Set<string>> = {};
    const ipSignupTimestamps: Record<string, { username: string; timestamp: Date }[]> = {};

    ipEvents?.forEach((e: any) => {
      if (e.ip_address) {
        if (!ipGroups[e.ip_address]) {
          ipGroups[e.ip_address] = new Set();
        }
        if (e.username) {
          ipGroups[e.ip_address].add(e.username);
        }

        if (e.action === 'auth:signup') {
          if (!ipSignupTimestamps[e.ip_address]) {
            ipSignupTimestamps[e.ip_address] = [];
          }
          ipSignupTimestamps[e.ip_address].push({
            username: e.username || 'unknown',
            timestamp: new Date(e.timestamp)
          });
        }
      }
    });

    const duplicateIPs = Object.entries(ipGroups)
      .filter(([_, users]) => users.size > 1)
      .map(([ip, users]) => ({
        type: 'IP_OVERLAP',
        ipAddress: ip,
        usernames: Array.from(users),
        reason: `${users.size} accounts have connected or signed up from the same IP address.`
      }));

    // 3. Find rapid sequential signups from the same IP (< 5 mins)
    const rapidSignups: any[] = [];
    Object.entries(ipSignupTimestamps).forEach(([ip, signups]) => {
      signups.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      for (let i = 0; i < signups.length - 1; i++) {
        const timeDiffSec = Math.abs(signups[i+1].timestamp.getTime() - signups[i].timestamp.getTime()) / 1000;
        if (timeDiffSec < 300) {
          rapidSignups.push({
            type: 'RAPID_SIGNUP_SEQUENCE',
            ipAddress: ip,
            user1: signups[i].username,
            user2: signups[i+1].username,
            timeDifferenceSeconds: timeDiffSec,
            reason: `Accounts "${signups[i].username}" and "${signups[i+1].username}" were registered within ${Math.round(timeDiffSec)} seconds of each other from IP ${ip}.`
          });
        }
      }
    });

    // 4. Username similarity check: Find users registered recently with highly similar names
    const { data: recentProfiles, error: pError } = await supabaseAdmin
      .from('profiles')
      .select('id, username, created_at')
      .order('created_at', { ascending: false })
      .limit(100);

    if (pError) throw pError;

    const similarUsernames: any[] = [];
    if (recentProfiles) {
      for (let i = 0; i < recentProfiles.length; i++) {
        for (let j = i + 1; j < recentProfiles.length; j++) {
          const u1 = recentProfiles[i].username.toLowerCase();
          const u2 = recentProfiles[j].username.toLowerCase();
          if (u1.length > 4 && u2.length > 4) {
            const prefix1 = u1.replace(/\d+$/, '');
            const prefix2 = u2.replace(/\d+$/, '');
            if (prefix1 === prefix2 && prefix1.length > 3) {
              similarUsernames.push({
                type: 'SIMILAR_USERNAMES',
                user1: recentProfiles[i].username,
                user2: recentProfiles[j].username,
                reason: `Usernames "${recentProfiles[i].username}" and "${recentProfiles[j].username}" share the identical prefix "${prefix1}".`
              });
            }
          }
        }
      }
    }

    // Flagged users list
    const { data: flaggedProfiles } = await supabaseAdmin
      .from('profiles')
      .select('id, username, email, is_suspended, is_flagged, flag_reason, created_at')
      .eq('is_flagged', true);

    return res.json({
      status: 'success',
      analyses: {
        duplicateFingerprints,
        duplicateIPs,
        rapidSignups,
        similarUsernames
      },
      flaggedProfiles: flaggedProfiles || []
    });
  } catch (err: any) {
    console.error('[Admin] Fake accounts check exception:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/admin/appeals
router.get('/appeals', async (req, res) => {
  try {
    const { data: appeals, error } = await supabaseAdmin
      .from('device_appeals')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return res.json({ status: 'success', appeals });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/admin/appeals/:id/resolve
router.post('/appeals/:id/resolve', async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const { status } = req.body; // 'APPROVED' or 'REJECTED'
  const adminId = req.profile?.id;
  const adminUsername = req.profile?.username;

  if (status !== 'APPROVED' && status !== 'REJECTED') {
    return res.status(400).json({ error: 'Status must be APPROVED or REJECTED' });
  }

  try {
    // 1. Fetch appeal details
    const { data: appeal, error: appealErr } = await supabaseAdmin
      .from('device_appeals')
      .select('*')
      .eq('id', id)
      .single();

    if (appealErr || !appeal) {
      return res.status(404).json({ error: 'Appeal not found' });
    }

    if (status === 'APPROVED') {
      // Unbind this device fingerprint from any other user profiles
      const { error: unbindErr } = await supabaseAdmin
        .from('profiles')
        .update({ device_fingerprint: null })
        .eq('device_fingerprint', appeal.device_fingerprint);

      if (unbindErr) {
        console.error('[Admin] Unbind error:', unbindErr);
        return res.status(500).json({ error: 'Failed to unbind fingerprint from other accounts' });
      }

      // Bind device fingerprint to the appealing user, and clear suspension/flag if needed
      const { error: bindErr } = await supabaseAdmin
        .from('profiles')
        .update({
          device_fingerprint: appeal.device_fingerprint,
          is_suspended: false,
          is_flagged: false,
          flag_reason: null
        })
        .eq('id', appeal.user_id);

      if (bindErr) {
        console.error('[Admin] Bind error:', bindErr);
        return res.status(500).json({ error: 'Failed to bind fingerprint to user profile' });
      }
    }

    // Update appeal status
    const { error: updateAppealErr } = await supabaseAdmin
      .from('device_appeals')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (updateAppealErr) throw updateAppealErr;

    // Log admin activity
    await logSecurityEvent(
      adminId || null,
      adminUsername || null,
      `admin:appeal_${status.toLowerCase()}`,
      req.ip || null,
      appeal.device_fingerprint,
      { appeal_id: id, target_user: appeal.username }
    );

    return res.json({ status: 'success', message: `Appeal resolved as ${status}.` });
  } catch (err: any) {
    console.error('[Admin] Appeal resolve exception:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/admin/users/:id/suspend
router.post('/users/:id/suspend', async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const { suspend, reason } = req.body;
  const adminId = req.profile?.id;
  const adminUsername = req.profile?.username;

  try {
    const { data: targetProfile, error: fErr } = await supabaseAdmin
      .from('profiles')
      .select('username')
      .eq('id', id)
      .single();

    if (fErr || !targetProfile) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    const { error: updateErr } = await supabaseAdmin
      .from('profiles')
      .update({
        is_suspended: suspend,
        suspension_reason: suspend ? (reason || 'Violated terms of service') : null,
        is_flagged: suspend ? true : false,
        flag_reason: suspend ? `Suspended by admin: ${reason}` : null
      })
      .eq('id', id);

    if (updateErr) throw updateErr;

    const action = suspend ? 'admin:user_suspend' : 'admin:user_unsuspend';
    await logSecurityEvent(
      adminId || null,
      adminUsername || null,
      action,
      req.ip || null,
      null,
      { target_user_id: id, target_username: targetProfile.username, reason }
    );

    return res.json({ status: 'success', message: `User suspension state updated to ${suspend}.` });
  } catch (err: any) {
    console.error('[Admin] User suspend exception:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/admin/judge-logs
router.get('/judge-logs', async (req, res) => {
  try {
    const { data: logs, error } = await supabaseAdmin
      .from('judge_audit_logs')
      .select('*')
      .order('timestamp', { ascending: false });

    if (error) throw error;
    return res.json({ status: 'success', logs });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/admin/security-logs
router.get('/security-logs', async (req, res) => {
  try {
    const { data: logs, error } = await supabaseAdmin
      .from('security_events')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(100);

    if (error) throw error;
    return res.json({ status: 'success', logs });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
