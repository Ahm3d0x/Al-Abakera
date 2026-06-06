import React, { useState, useEffect } from 'react';
import { User } from '@mind-race/shared';
import { supabase } from '../lib/supabase';

interface MilestoneReward {
  rp: number;
  coins: number;
  cosmetic?: string;
  badge?: string;
  label: {
    en: string;
    ar: string;
  };
}

interface ActiveSeason {
  id: string;
  name: string;
  theme: string;
  description: string;
  start_date: string;
  end_date: string;
  rewards: MilestoneReward[];
}

interface SeasonTrackerPanelProps {
  user: User;
  isRtl: boolean;
  refreshProfile: () => Promise<void>;
  triggerAlert: (msg: string, type: 'success' | 'error' | 'info') => void;
  playSFX: (type: 'correct' | 'wrong' | 'buzz' | 'tick' | 'slam' | 'click') => void;
}

export const SeasonTrackerPanel: React.FC<SeasonTrackerPanelProps> = ({
  user,
  isRtl,
  refreshProfile,
  triggerAlert,
  playSFX
}) => {
  const [activeSeason, setActiveSeason] = useState<ActiveSeason | null>(null);
  const [daysRemaining, setDaysRemaining] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [claimingRp, setClaimingRp] = useState<number | null>(null);

  // Fetch active season from backend API
  useEffect(() => {
    const fetchActiveSeason = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) return;

        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/v1/seasons/active`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (res.ok) {
          const data = await res.json();
          if (data.activeSeason) {
            setActiveSeason(data.activeSeason);
            setDaysRemaining(data.daysRemaining);
          }
        }
      } catch (err) {
        console.error('Error fetching active season:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchActiveSeason();
  }, [user.rankPoints]); // Refetch if player rank points change

  const handleClaimReward = async (milestoneRp: number) => {
    setClaimingRp(milestoneRp);
    playSFX('click');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/v1/seasons/claim-milestone`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ milestoneRp })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Claim milestone failed');
      }

      playSFX('correct');
      triggerAlert(
        isRtl 
          ? 'تم استلام مكافأة الموسم بنجاح!' 
          : 'Season milestone reward claimed successfully!', 
        'success'
      );
      await refreshProfile();
    } catch (err: unknown) {
      playSFX('wrong');
      const errMsg = err instanceof Error ? err.message : 'Error claiming reward';
      triggerAlert(errMsg, 'error');
    } finally {
      setClaimingRp(null);
    }
  };

  if (loading) {
    return (
      <div style={styles.loadingContainer} className="glass-panel">
        <p style={styles.loadingText}>{isRtl ? 'جاري تحميل تفاصيل الموسم...' : 'Loading season details...'}</p>
      </div>
    );
  }

  if (!activeSeason) {
    return (
      <div style={styles.container} className="glass-panel">
        <h3 style={styles.title}>{isRtl ? 'موسم التحدي' : 'Competition Season'}</h3>
        <p style={styles.noSeasonText}>
          {isRtl 
            ? 'لا يوجد موسم نشط حالياً. ابق متأهباً للموسم القادم!' 
            : 'No active season is currently running. Stay tuned for the next season!'}
        </p>
      </div>
    );
  }

  const currentRp = user.rankPoints || 0;
  const claimedClaims = user.claimedSeasonRewards || [];

  // Determine localized theme name and description
  const themeLabel = activeSeason.theme.includes(' / ') 
    ? (isRtl ? activeSeason.theme.split(' / ')[1] : activeSeason.theme.split(' / ')[0])
    : activeSeason.theme;

  // Find max RP milestone to calculate overall season progress percentage
  const milestones = activeSeason.rewards || [];
  const maxMilestoneRp = milestones.length > 0 ? Math.max(...milestones.map(m => m.rp)) : 10000;
  const progressPercent = Math.min(100, (currentRp / maxMilestoneRp) * 100);

  return (
    <div style={styles.container} className="glass-panel" id="season-tracker-panel">
      {/* Top Banner / Theme */}
      <div style={styles.header}>
        <div style={styles.titleGroup}>
          <span style={styles.activeBadge}>{isRtl ? 'موسم نشط' : 'ACTIVE SEASON'}</span>
          <h3 style={styles.seasonName}>{activeSeason.name}</h3>
        </div>
        <div style={styles.timer}>
          📅 {daysRemaining} {isRtl ? 'يوم متبقي' : 'days left'}
        </div>
      </div>

      <div style={styles.themeCard}>
        <p style={styles.themeTitle}>
          <strong>{isRtl ? 'الفكرة العامة:' : 'Theme:'}</strong> {themeLabel}
        </p>
        <p style={styles.description}>{activeSeason.description}</p>
      </div>

      {/* Season RP Tracker Progress Bar */}
      <div style={styles.progressSection}>
        <div style={styles.progressLabels}>
          <span style={styles.progressText}>
            {isRtl ? 'نقاط الرتبة الحالية:' : 'Your Season RP:'} <strong>{currentRp} RP</strong>
          </span>
          <span style={styles.progressText}>
            {isRtl ? 'الهدف الأقصى:' : 'Max Target:'} <strong>{maxMilestoneRp} RP</strong>
          </span>
        </div>
        <div style={styles.progressBarBg}>
          <div 
            style={{
              ...styles.progressBarFill,
              width: `${progressPercent}%`
            }} 
          />
        </div>
      </div>

      {/* Rewards Milestones List */}
      <div style={styles.milestonesHeader}>
        <h4 style={styles.milestoneHeading}>{isRtl ? 'مكافآت نقاط الرتبة للموسم' : 'Season RP Milestones'}</h4>
      </div>

      <div style={styles.milestonesGrid}>
        {milestones.map((m: MilestoneReward, idx: number) => {
          const isReached = currentRp >= m.rp;
          const claimedId = `season_${activeSeason.id}_milestone_${m.rp}`;
          const isClaimed = claimedClaims.includes(claimedId);
          
          let statusText = isRtl ? 'مغلق' : 'Locked';
          let statusColor = '#3d4470';
          let borderGlow = 'none';

          if (isClaimed) {
            statusText = isRtl ? 'تم الاستلام' : 'Claimed';
            statusColor = 'var(--correct)';
          } else if (isReached) {
            statusText = isRtl ? 'جاهز للاستلام' : 'Claimable';
            statusColor = 'var(--cyan-glow)';
            borderGlow = '0 0 10px rgba(0, 245, 255, 0.2)';
          }

          // Format items label
          const cosmeticLabel = m.cosmetic 
            ? (m.cosmetic === 'circuit_voyager' ? (isRtl ? 'إطار المسافر' : 'Voyager Border') :
               m.cosmetic === 'cyber_neon' ? (isRtl ? 'إطار النيون' : 'Neon Border') :
               m.cosmetic === 'cybernetic_glow' ? (isRtl ? 'إطار متوهج' : 'Glow Border') :
               m.cosmetic === 'electron_halo' ? (isRtl ? 'إطار هالة الإلكترون' : 'Electron Halo') :
               m.cosmetic === 'electrode' ? (isRtl ? 'تأثير القطب' : 'Electrode Effect') : m.cosmetic)
            : '';

          return (
            <div 
              key={idx} 
              style={{
                ...styles.milestoneCard,
                borderColor: isReached && !isClaimed ? 'var(--cyan-glow)' : 'rgba(255,255,255,0.06)',
                boxShadow: borderGlow
              }}
            >
              <div style={styles.milestoneHeader}>
                <span style={styles.milestoneRp}>{m.rp} RP</span>
                <span style={{ ...styles.milestoneStatus, color: statusColor }}>{statusText}</span>
              </div>

              <div style={styles.rewardDetails}>
                <div style={styles.rewardItem}>🪙 {m.coins} {isRtl ? 'عملة' : 'Coins'}</div>
                {m.cosmetic && (
                  <div style={styles.rewardItem}>🎨 {cosmeticLabel}</div>
                )}
                {m.badge && (
                  <div style={styles.rewardItem}>🏅 {isRtl ? 'شارة حصرية' : 'Exclusive Badge'}</div>
                )}
              </div>

              {/* Action Button */}
              {!isClaimed && isReached ? (
                <button
                  style={styles.claimButton}
                  onClick={() => handleClaimReward(m.rp)}
                  disabled={claimingRp === m.rp}
                >
                  {claimingRp === m.rp 
                    ? (isRtl ? 'جاري الاستلام...' : 'Claiming...') 
                    : (isRtl ? 'استلام المكافأة' : 'Claim Reward')}
                </button>
              ) : !isClaimed ? (
                <div style={styles.lockedLabel}>
                  🔒 {isRtl ? 'مغلق' : 'Locked'}
                </div>
              ) : (
                <div style={styles.claimedLabel}>
                  ✅ {isRtl ? 'تم الحصول عليها' : 'Acquired'}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const styles = {
  container: {
    padding: '20px',
    borderRadius: '16px',
    backgroundColor: 'var(--bg-surface)',
    border: '1px solid rgba(255, 255, 255, 0.05)',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px',
    margin: '15px 0',
  },
  loadingContainer: {
    padding: '40px 20px',
    borderRadius: '16px',
    backgroundColor: 'var(--bg-surface)',
    border: '1px solid rgba(255, 255, 255, 0.05)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    margin: '15px 0',
  },
  loadingText: {
    color: '#8a93c0',
    fontFamily: 'var(--font-ui)',
    fontSize: '14px',
  },
  noSeasonText: {
    color: '#8a93c0',
    fontFamily: 'var(--font-ui)',
    fontSize: '14px',
    textAlign: 'center' as const,
    padding: '20px 0',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap' as const,
    gap: '10px',
  },
  titleGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
  },
  activeBadge: {
    color: 'var(--cyan-glow)',
    fontSize: '10px',
    fontWeight: 700,
    letterSpacing: '1px',
    fontFamily: 'var(--font-ui)',
  },
  seasonName: {
    margin: 0,
    fontSize: '20px',
    fontWeight: 700,
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-display)',
  },
  title: {
    margin: 0,
    fontSize: '18px',
    fontWeight: 700,
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-display)',
  },
  timer: {
    fontSize: '13px',
    fontFamily: 'var(--font-ui)',
    color: 'var(--gold-bright)',
    backgroundColor: 'rgba(255, 215, 0, 0.06)',
    padding: '6px 12px',
    borderRadius: '20px',
    border: '1px solid rgba(255, 215, 0, 0.15)',
  },
  themeCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid rgba(255, 255, 255, 0.03)',
    borderRadius: '10px',
    padding: '12px 16px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
  },
  themeTitle: {
    margin: 0,
    fontSize: '13px',
    fontFamily: 'var(--font-ui)',
    color: 'var(--text-primary)',
  },
  description: {
    margin: 0,
    fontSize: '12px',
    fontFamily: 'var(--font-ui)',
    color: 'var(--text-secondary)',
    lineHeight: 1.4,
  },
  progressSection: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
  },
  progressLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '12px',
    fontFamily: 'var(--font-ui)',
  },
  progressText: {
    color: '#8a93c0',
  },
  progressBarBg: {
    height: '10px',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: '5px',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    background: 'linear-gradient(90deg, #00C8D4, #00F5FF)',
    boxShadow: '0 0 8px rgba(0, 245, 255, 0.5)',
    borderRadius: '5px',
    transition: 'width 0.4s ease-out',
  },
  milestonesHeader: {
    borderTop: '1px solid rgba(255, 255, 255, 0.05)',
    paddingTop: '15px',
    marginTop: '5px',
  },
  milestoneHeading: {
    margin: 0,
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-display)',
  },
  milestonesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    gap: '12px',
    marginTop: '5px',
  },
  milestoneCard: {
    backgroundColor: 'rgba(11, 13, 26, 0.4)',
    border: '1px solid rgba(255, 255, 255, 0.04)',
    borderRadius: '12px',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'space-between',
    gap: '10px',
    transition: 'all 0.2s ease',
  },
  milestoneHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '11px',
    fontFamily: 'var(--font-ui)',
  },
  milestoneRp: {
    fontWeight: 700,
    color: 'var(--text-primary)',
  },
  milestoneStatus: {
    fontSize: '10px',
    fontWeight: 600,
  },
  rewardDetails: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
  },
  rewardItem: {
    fontSize: '11px',
    fontFamily: 'var(--font-ui)',
    color: '#8a93c0',
  },
  claimButton: {
    backgroundColor: 'rgba(0, 245, 255, 0.15)',
    border: '1px solid var(--cyan-glow)',
    borderRadius: '6px',
    color: '#ffffff',
    fontSize: '11px',
    fontWeight: 600,
    padding: '6px',
    cursor: 'pointer',
    textAlign: 'center' as const,
    fontFamily: 'var(--font-ui)',
    transition: 'background-color 0.2s ease',
  },
  lockedLabel: {
    backgroundColor: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: '6px',
    color: '#3d4470',
    fontSize: '11px',
    padding: '6px',
    textAlign: 'center' as const,
    fontFamily: 'var(--font-ui)',
  },
  claimedLabel: {
    backgroundColor: 'rgba(0, 255, 135, 0.05)',
    border: '1px solid rgba(0, 255, 135, 0.15)',
    borderRadius: '6px',
    color: 'var(--correct)',
    fontSize: '11px',
    fontWeight: 600,
    padding: '6px',
    textAlign: 'center' as const,
    fontFamily: 'var(--font-ui)',
  }
};
