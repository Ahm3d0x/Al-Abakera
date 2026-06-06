import React, { useState, useEffect } from 'react';
import { User } from '@mind-race/shared';
import { supabase } from '../lib/supabase';

interface Quest {
  id: string;
  name_en: string;
  name_ar: string;
  progress: number;
  target: number;
  reward_coins: number;
  reward_tokens: number;
  claimed: boolean;
}

interface QuestsPanelProps {
  user: User;
  isRtl: boolean;
  refreshProfile: () => Promise<void>;
  triggerAlert: (msg: string, type: 'success' | 'error' | 'info') => void;
  playSFX: (type: 'correct' | 'wrong' | 'buzz' | 'tick' | 'slam' | 'click') => void;
}

export const QuestsPanel: React.FC<QuestsPanelProps> = ({
  user,
  isRtl,
  refreshProfile,
  triggerAlert,
  playSFX
}) => {
  const [activeType, setActiveType] = useState<'daily' | 'weekly'>('daily');
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [nowTime, setNowTime] = useState<number>(() => typeof window !== 'undefined' ? Date.now() : 0);

  // Initialize nowTime on client mount to maintain pure SSR/Hydration rendering
  useEffect(() => {
    const interval = setInterval(() => {
      setNowTime(Date.now());
    }, 10000); // update remaining time every 10 seconds
    return () => clearInterval(interval);
  }, []);

  const questsObj = user.quests || {};
  const group = questsObj[activeType] || {};
  const questList: Quest[] = group.quests || [];
  const resetAt = group.resetAt ? new Date(group.resetAt) : null;

  const handleClaim = async (questId: string) => {
    setClaimingId(questId);
    playSFX('click');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/v1/quests/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ questId, type: activeType })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Claim failed');
      }

      playSFX('correct');
      triggerAlert(
        isRtl 
          ? 'تم استلام المكافأة بنجاح!' 
          : 'Reward claimed successfully!', 
        'success'
      );
      await refreshProfile();
    } catch (err: unknown) {
      playSFX('wrong');
      const errMsg = err instanceof Error ? err.message : 'Error claiming reward';
      triggerAlert(errMsg, 'error');
    } finally {
      setClaimingId(null);
    }
  };

  const getLocalizedTimeRemaining = () => {
    if (!resetAt || nowTime === 0) return '';
    const diff = resetAt.getTime() - nowTime;
    if (diff <= 0) return isRtl ? 'بانتظار التحديث...' : 'Resetting soon...';

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (activeType === 'daily') {
      return isRtl 
        ? `يُعاد تعيين المهام خلال: ${hours} ساعة و ${mins} دقيقة`
        : `Resets in: ${hours}h ${mins}m`;
    } else {
      const days = Math.floor(hours / 24);
      const remainingHours = hours % 24;
      return isRtl
        ? `يُعاد تعيين المهام خلال: ${days} يوم و ${remainingHours} ساعة`
        : `Resets in: ${days}d ${remainingHours}h`;
    }
  };

  return (
    <div style={styles.container} className="glass-panel" id="quests-panel-container">
      <div style={styles.header}>
        <h3 style={styles.title}>{isRtl ? 'المهمات والمهام' : 'Missions & Quests'}</h3>
        <span style={styles.timer}>{getLocalizedTimeRemaining()}</span>
      </div>

      {/* Switcher tabs */}
      <div style={styles.tabs}>
        <button
          style={{
            ...styles.tabBtn,
            backgroundColor: activeType === 'daily' ? 'rgba(0, 242, 254, 0.1)' : 'transparent',
            borderColor: activeType === 'daily' ? '#00f2fe' : 'rgba(255, 255, 255, 0.05)',
            color: activeType === 'daily' ? '#ffffff' : '#8a93c0'
          }}
          onClick={() => { playSFX('click'); setActiveType('daily'); }}
          id="btn-daily-quests"
        >
          {isRtl ? 'المهام اليومية' : 'Daily Missions'}
        </button>
        <button
          style={{
            ...styles.tabBtn,
            backgroundColor: activeType === 'weekly' ? 'rgba(0, 242, 254, 0.1)' : 'transparent',
            borderColor: activeType === 'weekly' ? '#00f2fe' : 'rgba(255, 255, 255, 0.05)',
            color: activeType === 'weekly' ? '#ffffff' : '#8a93c0'
          }}
          onClick={() => { playSFX('click'); setActiveType('weekly'); }}
          id="btn-weekly-quests"
        >
          {isRtl ? 'المهام الأسبوعية' : 'Weekly Quests'}
        </button>
      </div>

      {/* Quest List */}
      <div style={styles.questsList}>
        {questList.length === 0 ? (
          <div style={styles.emptyState}>
            {isRtl ? 'بانتظار تحميل المهمات...' : 'Waiting for missions load...'}
          </div>
        ) : (
          questList.map((q: Quest) => {
            const progress = Number(q.progress || 0);
            const target = Number(q.target || 1);
            const isCompleted = progress >= target;
            const isClaimed = q.claimed;
            const pct = Math.min(100, (progress / target) * 100);

            return (
              <div key={q.id} style={styles.questCard} className="glass-panel">
                <div style={styles.questDetails}>
                  <h4 style={{
                    ...styles.questName,
                    textDecoration: isClaimed ? 'line-through' : 'none',
                    color: isClaimed ? 'var(--text-muted)' : '#ffffff'
                  }}>
                    {isRtl ? q.name_ar : q.name_en}
                  </h4>
                  
                  {/* Progress Bar */}
                  <div style={styles.barContainer}>
                    <div style={styles.bar}>
                      <div style={{ ...styles.barFill, width: `${pct}%` }} />
                    </div>
                    <span style={styles.barLabel}>{progress} / {target}</span>
                  </div>

                  {/* Rewards */}
                  <div style={styles.rewardsRow}>
                    <span style={styles.rewardLabel}>{isRtl ? 'المكافأة:' : 'Rewards:'}</span>
                    {q.reward_coins > 0 && <span style={styles.rewardItem}>🪙 {q.reward_coins}</span>}
                    {q.reward_tokens > 0 && <span style={styles.rewardItemRare}>👑 {q.reward_tokens}</span>}
                  </div>
                </div>

                <div style={styles.actionColumn}>
                  {isClaimed ? (
                    <span style={styles.claimedBadge}>✓ {isRtl ? 'تم استلامها' : 'Claimed'}</span>
                  ) : isCompleted ? (
                    <button
                      style={styles.claimBtn}
                      disabled={claimingId === q.id}
                      onClick={() => handleClaim(q.id)}
                    >
                      {claimingId === q.id ? '...' : (isRtl ? 'استلام' : 'Claim')}
                    </button>
                  ) : (
                    <span style={styles.inProgressBadge}>{isRtl ? 'جاري العمل' : 'In Progress'}</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    backgroundColor: 'rgba(15, 18, 30, 0.45)',
    border: '1px solid rgba(255, 255, 255, 0.04)',
    borderRadius: '16px',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '8px'
  },
  title: {
    fontSize: '1.1rem',
    fontWeight: 900,
    color: '#ffffff',
    margin: 0,
    letterSpacing: '0.5px'
  },
  timer: {
    fontSize: '0.75rem',
    color: '#00f2fe',
    fontWeight: 'bold'
  },
  tabs: {
    display: 'flex',
    gap: '8px'
  },
  tabBtn: {
    flex: 1,
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid',
    fontSize: '0.8rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'all 0.15s',
    textAlign: 'center'
  },
  questsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  emptyState: {
    textAlign: 'center',
    padding: '20px',
    fontSize: '0.85rem',
    color: 'var(--text-secondary)'
  },
  questCard: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 16px',
    backgroundColor: 'rgba(255,255,255,0.01)',
    border: '1px solid rgba(255,255,255,0.03)',
    borderRadius: '12px',
    gap: '16px'
  },
  questDetails: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  },
  questName: {
    fontSize: '0.9rem',
    fontWeight: 'bold',
    margin: 0
  },
  barContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
  },
  bar: {
    flex: 1,
    height: '6px',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: '3px',
    overflow: 'hidden'
  },
  barFill: {
    height: '100%',
    background: 'linear-gradient(90deg, #00f2fe 0%, #4facfe 100%)',
    borderRadius: '3px'
  },
  barLabel: {
    fontSize: '0.7rem',
    fontWeight: 'bold',
    color: 'var(--text-secondary)',
    minWidth: '35px',
    textAlign: 'right'
  },
  rewardsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '0.75rem'
  },
  rewardLabel: {
    color: 'var(--text-muted)'
  },
  rewardItem: {
    fontWeight: 'bold',
    color: '#ffb300'
  },
  rewardItemRare: {
    fontWeight: 'bold',
    color: '#00f2fe'
  },
  actionColumn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '85px'
  },
  claimedBadge: {
    fontSize: '0.75rem',
    color: '#00e676',
    fontWeight: 'bold'
  },
  inProgressBadge: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    fontWeight: 'bold'
  },
  claimBtn: {
    padding: '6px 14px',
    background: 'linear-gradient(135deg, #00e676 0%, #00b0ff 100%)',
    border: 'none',
    borderRadius: '8px',
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: '0.8rem',
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0, 230, 118, 0.3)',
    transition: 'all 0.15s'
  }
};
