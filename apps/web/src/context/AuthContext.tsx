'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { User as SupabaseUser, AuthError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { User, RankTier, UserStats } from '@mind-race/shared';

interface AuthContextType {
  user: User | null;
  supabaseUser: SupabaseUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signUp: (email: string, password: string, username: string) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<{ error: AuthError | null }>;
  resetPassword: (email: string) => Promise<{ error: AuthError | null }>;
  updatePassword: (password: string) => Promise<{ error: AuthError | null }>;
  signInWithOAuth: (provider: 'google' | 'apple') => Promise<{ error: AuthError | null }>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Helper to map DB profile to Shared User type
  const fetchAndMapProfile = async (sUser: SupabaseUser) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', sUser.id)
        .single();

      if (error) {
        console.error('Error fetching user profile:', error);
        return null;
      }

      if (data) {
        // Fetch user's earned badges
        const { data: earnedData, error: earnedErr } = await supabase
          .from('badges_earned')
          .select('badge_id, badges (key)')
          .eq('user_id', sUser.id);

        interface EarnedBadgeRow {
          badge_id: string;
          badges: { key: string } | { key: string }[] | null;
        }

        const earnedBadges = earnedErr ? [] : (earnedData as unknown as EarnedBadgeRow[] || []).map((e) => {
          if (!e.badges) return null;
          if (Array.isArray(e.badges)) return e.badges[0]?.key;
          return e.badges.key;
        }).filter((key): key is string => !!key);

        // Map database snake_case fields to packages/shared camelCase fields
        const mappedUser: User = {
          id: data.id,
          username: data.username,
          email: data.email,
          rank: data.rank as RankTier,
          rankPoints: data.rank_points,
          coins: data.coins,
          creatorTokens: data.creator_tokens,
          stats: (data.stats || {}) as UserStats,
          avatarUrl: data.avatar_url,
          badges: earnedBadges,
          inventory: data.inventory || [],
          equipped: data.equipped || { border: null, effect: null, avatar: null },
          quests: data.quests || {},
          claimedSeasonRewards: data.claimed_season_rewards || [],
          createdAt: new Date(data.created_at),
          updatedAt: new Date(data.updated_at),
        };
        return mappedUser;
      }
    } catch (err) {
      console.error('Failed to map profile:', err);
    }
    return null;
  };

  const refreshProfile = async () => {
    if (supabaseUser) {
      const profile = await fetchAndMapProfile(supabaseUser);
      setUser(profile);
    }
  };

  useEffect(() => {
    // Check active session on mount
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          setSupabaseUser(session.user);
          const profile = await fetchAndMapProfile(session.user);
          setUser(profile);
        }
      } catch (err) {
        console.error('Error checking session:', err);
      } finally {
        setLoading(false);
      }
    };

    checkSession();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setLoading(true);
        if (session?.user) {
          setSupabaseUser(session.user);
          const profile = await fetchAndMapProfile(session.user);
          setUser(profile);
        } else {
          setSupabaseUser(null);
          setUser(null);
        }
        setLoading(false);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signUp = async (email: string, password: string, username: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username,
        },
      },
    });
    return { error };
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    return { error };
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/update-password`,
    });
    return { error };
  };

  const updatePassword = async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    return { error };
  };

  const signInWithOAuth = async (provider: 'google' | 'apple') => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin,
      },
    });
    return { error };
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        supabaseUser,
        loading,
        signIn,
        signUp,
        signOut,
        resetPassword,
        updatePassword,
        signInWithOAuth,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
