import React, { useState, useEffect } from 'react';
import { RankBadge } from './RankBadge';
import { supabase } from '../lib/supabase';

interface PlayerProfileModalProps {
  user: {
    id: string;
    username: string;
    email: string;
    rank: string;
    rankPoints: number;
    coins: number;
    creatorTokens?: number;
    badges: string[];
    stats: {
      winRate?: number;
      correctAnswersRate?: number;
      averageAnswerTimeMs?: number;
      fastestAnswerMs?: number;
      matchesPlayed?: number;
      matchesWon?: number;
      totalQuestionsAnswered?: number;
      totalCorrectAnswers?: number;
      [key: string]: unknown;
    };
  };
  isOpen: boolean;
  onClose: () => void;
  isRtl: boolean;
}

export const BADGES_METADATA = [
  { key: 'first_win', name: { en: 'First Victory', ar: 'النصر الأول' }, desc: { en: 'Win your first match', ar: 'فز بمباراتك الأولى' }, icon: '🥇' },
  { key: 'century', name: { en: 'Century', ar: 'القرن' }, desc: { en: 'Play 100 matches', ar: 'العب 100 مباراة' }, icon: '💯' },
  { key: 'speed_demon', name: { en: 'Speed Demon', ar: 'شيطان السرعة' }, desc: { en: 'Fastest answer time in a match', ar: 'أسرع وقت إجابة في مباراة' }, icon: '⚡' },
  { key: 'undefeated', name: { en: 'Undefeated', ar: 'لا يقهر' }, desc: { en: 'Win 50 consecutive matches', ar: 'فز بـ 50 مباراة متتالية' }, icon: '🔥' },
  { key: 'team_leader', name: { en: 'Team Leader', ar: 'قائد الفريق' }, desc: { en: 'Win 100 matches as captain', ar: 'فز بـ 100 مباراة كقائد' }, icon: '👑' },
  { key: 'tournament_king', name: { en: 'Tournament King', ar: 'ملك البطولة' }, desc: { en: 'Complete a tournament without a loss', ar: 'أكمل بطولة كاملة دون خسارة' }, icon: '🏰' },
  { key: 'scientist', name: { en: 'Scientist', ar: 'العالِم' }, desc: { en: 'Answer 1,000 science questions correctly', ar: 'أجب عن 1000 سؤال علوم بشكل صحيح' }, icon: '🧪' },
  { key: 'historian', name: { en: 'Historian', ar: 'المؤرخ' }, desc: { en: 'Answer 1,000 history questions correctly', ar: 'أجب عن 1000 سؤال تاريخ بشكل صحيح' }, icon: '📜' },
  { key: 'sharpshooter', name: { en: 'Sharpshooter', ar: 'القناص' }, desc: { en: 'Achieve 90%+ accuracy in a 20+ Q match', ar: 'دقة 90%+ في مباراة 20+ سؤال' }, icon: '🎯' },
  { key: 'survivor', name: { en: 'Survivor', ar: 'الناجي' }, desc: { en: 'Reach level 50 in Survival Mode', ar: 'صل للمستوى 50 في نمط البقاء' }, icon: '⛺' },
  { key: 'daily_devotee', name: { en: 'Daily Devotee', ar: 'المثابر اليومي' }, desc: { en: 'Complete 30 daily challenges in a row', ar: 'أكمل 30 تحدي يومي متتالي' }, icon: '📆' },
  { key: 'knowledge_titan', name: { en: 'Knowledge Titan', ar: 'عملاق المعرفة' }, desc: { en: 'Reach Titan rank', ar: 'صل إلى رتبة العملاق' }, icon: '🌌' }
];

interface SeasonArchive {
  id: string;
  season_id: string;
  user_id: string;
  username: string;
  rank_tier: string;
  rank_points: number;
  placement: number;
  rewards_awarded: {
    coins?: number;
    badge?: string;
    cosmetic?: string;
  };
  archived_at: string;
  seasons: {
    name: string;
    theme: string;
  };
}

export const PlayerProfileModal: React.FC<PlayerProfileModalProps> = ({
  user,
  isOpen,
  onClose,
  isRtl
}) => {
  const [archives, setArchives] = useState<SeasonArchive[]>([]);
  const [loadingArchives, setLoadingArchives] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen && user?.id) {
      const fetchArchives = async () => {
        setLoadingArchives(true);
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          if (!token) return;

          const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/v1/seasons/archive`, {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });

          if (res.ok) {
            const data = await res.json();
            const userArchives = (data || []).filter((item: SeasonArchive) => item.user_id === user.id);
            setArchives(userArchives);
          }
        } catch (err) {
          console.error('Error fetching user season archives:', err);
        } finally {
          setLoadingArchives(false);
        }
      };

      fetchArchives();
    }
  }, [isOpen, user?.id]);

  if (!isOpen) return null;

  // Rank progression helpers
  const points = user.rankPoints || 0;
  const currentTierMin = Math.floor(points / 1000) * 1000;
  const nextTierMin = currentTierMin + 1000;
  const progressInTier = points - currentTierMin;
  const progressPct = points >= 9000 ? 100 : (progressInTier / 1000) * 100;

  const ranks = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Grand Master', 'Legend', 'Mythic', 'Titan'];
  const arabicRanks: Record<string, string> = {
    'Bronze': 'برونزي',
    'Silver': 'فضي',
    'Gold': 'ذهبي',
    'Platinum': 'بلاتيني',
    'Diamond': 'ألماسي',
    'Master': 'خبير',
    'Grand Master': 'أستاذ كبير',
    'Legend': 'أسطورة',
    'Mythic': 'خرافي',
    'Titan': 'عملاق'
  };

  const getRankLabel = (tier: string) => {
    return isRtl ? (arabicRanks[tier] || tier) : tier;
  };

  const currentRankIndex = ranks.indexOf(user.rank);
  const nextRank = currentRankIndex !== -1 && currentRankIndex < ranks.length - 1 ? ranks[currentRankIndex + 1] : null;

  // Localization dict
  const t = {
    title: isRtl ? 'الملف الشخصي للاعب' : 'Player Profile',
    rank: isRtl ? 'الرتبة الحالية' : 'Current Rank',
    progression: isRtl ? 'التقدم للرتبة التالية' : 'Rank Progression',
    maxRank: isRtl ? 'وصلت للرتبة القصوى!' : 'Maximum Rank Achieved!',
    needed: isRtl ? 'متبقي للترقية' : 'needed for promotion',
    stats: isRtl ? 'إحصائيات الأداء' : 'Performance Stats',
    winRate: isRtl ? 'نسبة الفوز' : 'Win Rate',
    accuracy: isRtl ? 'نسبة الدقة' : 'Accuracy',
    speed: isRtl ? 'متوسط سرعة الإجابة' : 'Avg Answer Speed',
    fastest: isRtl ? 'أسرع إجابة' : 'Fastest Answer',
    played: isRtl ? 'المباريات الملعوبة' : 'Matches Played',
    won: isRtl ? 'المباريات التي فزت بها' : 'Matches Won',
    questions: isRtl ? 'إجمالي الأسئلة' : 'Questions Answered',
    badges: isRtl ? 'الشارات والإنجازات' : 'Badges & Achievements',
    badgesCount: isRtl ? 'الشارات المفتوحة' : 'Badges Unlocked',
    coins: isRtl ? 'العملات' : 'Coins',
    bestCategory: isRtl ? 'أفضل فئة' : 'Best Category',
    worstCategory: isRtl ? 'أسوأ فئة' : 'Worst Category',
    tournaments: isRtl ? 'البطولات الملعوبة' : 'Tournaments Played',
    streak: isRtl ? 'سلسلة الانتصارات' : 'Win Streak',
    none: isRtl ? 'لا يوجد' : 'None'
  };

  const winRate = user.stats?.winRate ?? 0;
  const accuracy = user.stats?.correctAnswersRate ?? 0;
  const speed = user.stats?.averageAnswerTimeMs ? (user.stats.averageAnswerTimeMs / 1000).toFixed(2) : '0.00';
  const fastest = user.stats?.fastestAnswerMs ? (user.stats.fastestAnswerMs / 1000).toFixed(2) : '0.00';

  const userBadges = user.badges || [];

  const formatCategory = (cat: string | null | undefined) => {
    if (!cat) return t.none;
    if (cat.includes(' / ')) {
      const parts = cat.split(' / ');
      return isRtl ? parts[1] : parts[0];
    }
    return cat;
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()} dir={isRtl ? 'rtl' : 'ltr'}>
        
        {/* Close Button */}
        <button style={styles.closeBtn} onClick={onClose}>✕</button>

        {/* Modal Scroll Wrapper */}
        <div style={styles.scrollContainer}>
          
          {/* Header Card with Rank Badge */}
          <div style={styles.headerCard}>
            <div style={styles.badgeWrapper}>
              <RankBadge rank={user.rank} size={110} animate={true} />
            </div>
            <h2 style={styles.username}>{user.username}</h2>
            <p style={styles.rankName}>
              {t.rank}: <span style={{ color: `var(--color-${user.rank.toLowerCase().replace(' ', '')})`, fontWeight: 800 }}>
                {getRankLabel(user.rank)}
              </span>
            </p>
            <span style={styles.pointsCount}>{points} RP</span>
            <span style={styles.coinWallet}>🪙 {user.coins} {t.coins}</span>
          </div>

          {/* Rank Progress Bar */}
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>{t.progression}</h3>
            <div style={styles.progressContainer}>
              <div style={styles.progressBar}>
                <div style={{ ...styles.progressFill, width: `${progressPct}%`, backgroundColor: `var(--color-${user.rank.toLowerCase().replace(' ', '')})` }} />
              </div>
              <div style={styles.progressLabels}>
                <span style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>{points} RP</span>
                {nextRank ? (
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    {nextTierMin} RP ({getRankLabel(nextRank)})
                  </span>
                ) : (
                  <span style={{ fontSize: '0.75rem', color: '#ffd700', fontWeight: 'bold' }}>{t.maxRank}</span>
                )}
              </div>
            </div>
            {nextRank && (
              <p style={styles.neededText}>
                🔥 <strong>{nextTierMin - points} RP</strong> {t.needed} <strong style={{ color: `var(--color-${nextRank.toLowerCase().replace(' ', '')})` }}>{getRankLabel(nextRank)}</strong>
              </p>
            )}
          </div>

          {/* Stats Breakdown Grid */}
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>{t.stats}</h3>
            <div style={styles.statsGrid}>
              <div style={styles.statBox}>
                <span style={styles.statLabel}>{t.winRate}</span>
                <span style={styles.statVal} className="text-glow">{winRate}%</span>
              </div>
              <div style={styles.statBox}>
                <span style={styles.statLabel}>{t.accuracy}</span>
                <span style={styles.statVal} className="text-glow-accent">{accuracy}%</span>
              </div>
              <div style={styles.statBox}>
                <span style={styles.statLabel}>{t.speed}</span>
                <span style={styles.statVal}>{speed}s</span>
              </div>
              <div style={styles.statBox}>
                <span style={styles.statLabel}>{t.fastest}</span>
                <span style={{ ...styles.statVal, color: '#00e676' }}>{fastest}s</span>
              </div>
              <div style={styles.statBox}>
                <span style={styles.statLabel}>{t.played}</span>
                <span style={styles.statVal}>{user.stats?.matchesPlayed ?? 0}</span>
              </div>
              <div style={styles.statBox}>
                <span style={styles.statLabel}>{t.won}</span>
                <span style={styles.statVal}>{user.stats?.matchesWon ?? 0}</span>
              </div>
              <div style={styles.statBox}>
                <span style={styles.statLabel}>{t.tournaments}</span>
                <span style={styles.statVal}>{Number(user.stats?.tournamentCount ?? 0)}</span>
              </div>
              <div style={styles.statBox}>
                <span style={styles.statLabel}>{t.streak}</span>
                <span style={{ ...styles.statVal, color: '#ffb300' }}>
                  {Number(user.stats?.consecutiveWins ?? 0)} 🔥
                </span>
              </div>
              <div style={styles.statBox}>
                <span style={styles.statLabel}>{t.bestCategory}</span>
                <span style={{ ...styles.statVal, fontSize: '0.8rem', color: '#00e676', textAlign: 'center', fontWeight: 'bold' }}>
                  {formatCategory(user.stats?.bestCategory as string | null)}
                </span>
              </div>
              <div style={styles.statBox}>
                <span style={styles.statLabel}>{t.worstCategory}</span>
                <span style={{ ...styles.statVal, fontSize: '0.8rem', color: '#ff1744', textAlign: 'center', fontWeight: 'bold' }}>
                  {formatCategory(user.stats?.worstCategory as string | null)}
                </span>
              </div>
            </div>
            <div style={{ textAlign: 'center', marginTop: '12px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {t.questions}: {user.stats?.totalQuestionsAnswered ?? 0} ({isRtl ? 'الإجابات الصحيحة' : 'Correct'}: {user.stats?.totalCorrectAnswers ?? 0})
            </div>
          </div>

          {/* Badges and Achievements */}
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>
              {t.badges} ({userBadges.length} / {BADGES_METADATA.length})
            </h3>
            <div style={styles.badgesGrid}>
              {BADGES_METADATA.map((badge) => {
                const isUnlocked = userBadges.includes(badge.key);
                return (
                  <div 
                    key={badge.key} 
                    style={{ 
                      ...styles.badgeBox,
                      opacity: isUnlocked ? 1 : 0.25,
                      border: isUnlocked ? '1px solid rgba(255, 215, 0, 0.25)' : '1px solid rgba(255, 255, 255, 0.05)',
                      background: isUnlocked ? 'rgba(255, 215, 0, 0.03)' : 'rgba(255, 255, 255, 0.01)',
                    }}
                    title={isRtl ? badge.desc.ar : badge.desc.en}
                  >
                    <span style={{ fontSize: '1.8rem', marginBottom: '4px' }}>{badge.icon}</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: isUnlocked ? '#ffffff' : 'var(--text-muted)', textAlign: 'center', display: 'block' }}>
                      {isRtl ? badge.name.ar : badge.name.en}
                    </span>
                    <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textAlign: 'center', display: 'block', marginTop: '2px', lineHeight: 1.2 }}>
                      {isRtl ? badge.desc.ar : badge.desc.en}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Past Season Records */}
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>
              {isRtl ? 'سجلات المواسم السابقة' : 'Past Season Records'}
            </h3>
            {loadingArchives ? (
              <p style={{ color: '#8a93c0', fontSize: '0.8rem', fontFamily: 'var(--font-ui)' }}>
                {isRtl ? 'جاري تحميل السجلات...' : 'Loading records...'}
              </p>
            ) : archives.length === 0 ? (
              <p style={{ color: '#3d4470', fontSize: '0.8rem', fontFamily: 'var(--font-ui)' }}>
                {isRtl ? 'لا توجد سجلات مواسم سابقة.' : 'No previous season records.'}
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {archives.map((archive) => {
                  const sName = archive.seasons?.name || 'Season';
                  const sTheme = archive.seasons?.theme || '';
                  const localizedTheme = sTheme.includes(' / ') 
                    ? (isRtl ? sTheme.split(' / ')[1] : sTheme.split(' / ')[0])
                    : sTheme;

                  return (
                    <div 
                      key={archive.id} 
                      style={{
                        padding: '10px 12px',
                        borderRadius: '8px',
                        backgroundColor: 'rgba(255,255,255,0.02)',
                        border: '1px solid rgba(255,255,255,0.04)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#ffffff' }}>
                          {sName}
                        </span>
                        <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--gold-bright)' }}>
                          {isRtl ? `المركز #${archive.placement}` : `#${archive.placement} Place`}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#8a93c0', fontFamily: 'var(--font-ui)' }}>
                        {isRtl ? 'الفكرة العامة:' : 'Theme:'} {localizedTheme}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {isRtl ? 'الرتبة النهائية:' : 'Final Rank:'}{' '}
                          <strong style={{ color: `var(--color-${archive.rank_tier.toLowerCase().replace(' ', '')})` }}>
                            {isRtl ? (arabicRanks[archive.rank_tier] || archive.rank_tier) : archive.rank_tier}
                          </strong>{' '}
                          ({archive.rank_points} RP)
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    backgroundColor: 'rgba(5, 6, 10, 0.85)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
    boxSizing: 'border-box'
  },
  modal: {
    width: '90%',
    maxWidth: '520px',
    height: '85vh',
    backgroundColor: 'rgba(15, 18, 30, 0.95)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5), inset 0 0 15px rgba(255,255,255,0.02)',
    borderRadius: '16px',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  closeBtn: {
    position: 'absolute',
    top: '16px',
    right: '16px',
    background: 'rgba(255, 255, 255, 0.05)',
    border: 'none',
    color: '#ffffff',
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    cursor: 'pointer',
    fontSize: '0.9rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    transition: 'background 0.2s'
  },
  scrollContainer: {
    padding: '24px',
    overflowY: 'auto',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '20px'
  },
  headerCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '20px',
    background: 'linear-gradient(135deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.005) 100%)',
    border: '1px solid rgba(255,255,255,0.04)',
    borderRadius: '12px',
    textAlign: 'center'
  },
  badgeWrapper: {
    marginBottom: '12px'
  },
  username: {
    fontSize: '1.5rem',
    fontWeight: 900,
    color: '#ffffff',
    margin: '0 0 4px 0'
  },
  rankName: {
    fontSize: '0.9rem',
    margin: '0 0 4px 0',
    color: 'var(--text-secondary)'
  },
  pointsCount: {
    fontSize: '1.1rem',
    fontWeight: 800,
    color: '#00f2fe',
    display: 'block',
    marginBottom: '8px'
  },
  coinWallet: {
    fontSize: '0.85rem',
    padding: '4px 10px',
    background: 'rgba(255,179,0,0.12)',
    border: '1px solid rgba(255,179,0,0.2)',
    borderRadius: '20px',
    color: '#ffb300',
    fontWeight: 'bold'
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.04)',
    borderRadius: '12px',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  cardTitle: {
    fontSize: '0.95rem',
    fontWeight: 800,
    color: 'var(--primary)',
    margin: 0,
    letterSpacing: '0.5px'
  },
  progressContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  },
  progressBar: {
    width: '100%',
    height: '10px',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: '5px',
    overflow: 'hidden',
    border: '1px solid rgba(255,255,255,0.02)'
  },
  progressFill: {
    height: '100%',
    borderRadius: '5px',
    transition: 'width 0.8s cubic-bezier(0.4, 0, 0.2, 1)'
  },
  progressLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    color: 'var(--text-primary)'
  },
  neededText: {
    fontSize: '0.75rem',
    color: 'var(--text-secondary)',
    margin: '4px 0 0 0',
    textAlign: 'center'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px'
  },
  statBox: {
    padding: '12px',
    backgroundColor: 'rgba(0,0,0,0.2)',
    border: '1px solid rgba(255,255,255,0.02)',
    borderRadius: '8px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px'
  },
  statLabel: {
    fontSize: '0.7rem',
    color: 'var(--text-secondary)'
  },
  statVal: {
    fontSize: '1.15rem',
    fontWeight: 800,
    color: '#ffffff'
  },
  badgesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '10px'
  },
  badgeBox: {
    padding: '10px 4px',
    borderRadius: '8px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.3s ease'
  }
};
