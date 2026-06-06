import { Request, Response, NextFunction } from 'express';
import { User as SupabaseUser } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabase';
import { User, RankTier, UserStats } from '@mind-race/shared';

export interface AuthenticatedRequest extends Request {
  user?: SupabaseUser;
  profile?: User & { isTeacher?: boolean; isAdmin?: boolean };
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No authorization token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    
    if (error || !user) {
      return res.status(401).json({ error: error?.message || 'Invalid or expired token' });
    }

    // Fetch the game profile from public database profiles table
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    req.user = user;
    req.profile = {
      id: profile.id,
      username: profile.username,
      email: profile.email,
      rank: profile.rank as RankTier,
      rankPoints: profile.rank_points,
      coins: profile.coins,
      creatorTokens: profile.creator_tokens,
      stats: (profile.stats || {}) as UserStats,
      avatarUrl: profile.avatar_url,
      badges: [],
      createdAt: new Date(profile.created_at),
      updatedAt: new Date(profile.updated_at),
      isTeacher: profile.is_teacher,
      isAdmin: profile.is_admin,
    };

    next();
  } catch (err) {
    console.error('Authentication middleware error:', err);
    return res.status(500).json({ error: 'Internal server error during authentication' });
  }
}

export function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.profile || !req.profile.isAdmin) {
    return res.status(403).json({ error: 'Access denied. Administrator privileges required.' });
  }
  next();
}

