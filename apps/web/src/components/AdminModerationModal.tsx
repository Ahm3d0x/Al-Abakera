import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface AdminModerationModalProps {
  isOpen: boolean;
  onClose: () => void;
  isRtl: boolean;
  playSFX: (type: string) => void;
}

interface FingerprintUser {
  id: string;
  username: string;
  email: string;
  createdAt: string;
}

interface FingerprintOverlap {
  type: string;
  fingerprint: string;
  users: FingerprintUser[];
  reason: string;
}

interface IPOverlap {
  type: string;
  ipAddress: string;
  usernames: string[];
  reason: string;
}

interface RapidSignup {
  type: string;
  ipAddress: string;
  user1: string;
  user2: string;
  timeDifferenceSeconds: number;
  reason: string;
}

interface SimilarUsername {
  type: string;
  user1: string;
  user2: string;
  reason: string;
}

interface AnalysesData {
  duplicateFingerprints?: FingerprintOverlap[];
  duplicateIPs?: IPOverlap[];
  rapidSignups?: RapidSignup[];
  similarUsernames?: SimilarUsername[];
}

interface ProfileData {
  id: string;
  username: string;
  email: string;
  is_suspended: boolean;
  is_flagged: boolean;
  flag_reason: string | null;
  created_at: string;
}

interface AppealData {
  id: string;
  user_id: string;
  username: string;
  device_fingerprint: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  created_at: string;
  updated_at: string;
}

interface JudgeLogData {
  id: string;
  judge_id: string | null;
  judge_username: string;
  room_id: string | null;
  match_id: string | null;
  action: string;
  target_user_id: string | null;
  target_username: string | null;
  details: string | null;
  timestamp: string;
  metadata: Record<string, unknown>;
}

interface SecurityLogData {
  id: string;
  user_id: string | null;
  username: string;
  action: string;
  ip_address: string | null;
  device_fingerprint: string | null;
  timestamp: string;
  metadata: Record<string, unknown>;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

export const AdminModerationModal: React.FC<AdminModerationModalProps> = ({
  isOpen,
  onClose,
  isRtl,
  playSFX,
}) => {
  const [activeTab, setActiveTab] = useState<'flagged' | 'appeals' | 'judges' | 'security'>('flagged');
  const [loading, setLoading] = useState(false);
  const [analyses, setAnalyses] = useState<AnalysesData>({});
  const [flaggedProfiles, setFlaggedProfiles] = useState<ProfileData[]>([]);
  const [appeals, setAppeals] = useState<AppealData[]>([]);
  const [judgeLogs, setJudgeLogs] = useState<JudgeLogData[]>([]);
  const [securityLogs, setSecurityLogs] = useState<SecurityLogData[]>([]);

  // Action states
  const [suspendUserId, setSuspendUserId] = useState<string | null>(null);
  const [suspendReason, setSuspendReason] = useState('');

  const getAuthHeaders = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token || ''}`
    };
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      
      if (activeTab === 'flagged') {
        const res = await fetch(`${API_URL}/api/v1/admin/fake-accounts`, { headers });
        const data = await res.json();
        if (data.status === 'success') {
          setAnalyses(data.analyses || {});
          setFlaggedProfiles(data.flaggedProfiles || []);
        }
      } else if (activeTab === 'appeals') {
        const res = await fetch(`${API_URL}/api/v1/admin/appeals`, { headers });
        const data = await res.json();
        if (data.status === 'success') {
          setAppeals(data.appeals || []);
        }
      } else if (activeTab === 'judges') {
        const res = await fetch(`${API_URL}/api/v1/admin/judge-logs`, { headers });
        const data = await res.json();
        if (data.status === 'success') {
          setJudgeLogs(data.logs || []);
        }
      } else if (activeTab === 'security') {
        const res = await fetch(`${API_URL}/api/v1/admin/security-logs`, { headers });
        const data = await res.json();
        if (data.status === 'success') {
          setSecurityLogs(data.logs || []);
        }
      }
    } catch (err) {
      console.error('[Admin Dashboard] Error loading data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleResolveAppeal = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    playSFX('click');
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_URL}/api/v1/admin/appeals/${id}/resolve`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ status })
      });
      const data = await res.json();
      if (data.status === 'success') {
        loadData();
      }
    } catch (err) {
      console.error('Error resolving appeal:', err);
    }
  };

  const handleSuspendUser = async () => {
    if (!suspendUserId) return;
    playSFX('click');
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_URL}/api/v1/admin/users/${suspendUserId}/suspend`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ suspend: true, reason: suspendReason })
      });
      const data = await res.json();
      if (data.status === 'success') {
        setSuspendUserId(null);
        setSuspendReason('');
        loadData();
      }
    } catch (err) {
      console.error('Error suspending user:', err);
    }
  };

  const handleDismissFlag = async (userId: string) => {
    playSFX('click');
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_URL}/api/v1/admin/users/${userId}/suspend`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ suspend: false })
      });
      const data = await res.json();
      if (data.status === 'success') {
        loadData();
      }
    } catch (err) {
      console.error('Error dismissing user flag:', err);
    }
  };

  if (!isOpen) return null;

  const t = {
    title: isRtl ? 'لوحة تحكم المشرف' : 'Admin Moderation Dashboard',
    tabFlagged: isRtl ? 'الحسابات المشبوهة' : 'Flagged & Bot Analysis',
    tabAppeals: isRtl ? 'طلبات نقل الأجهزة' : 'Device Appeals',
    tabJudges: isRtl ? 'سجل الحكام' : 'Judge Audit',
    tabSecurity: isRtl ? 'سجل الأمان' : 'Security Logs',
    loading: isRtl ? 'جاري التحميل...' : 'Loading...',
    noData: isRtl ? 'لا توجد بيانات متاحة' : 'No data available',
    suspend: isRtl ? 'حظر' : 'Suspend',
    dismiss: isRtl ? 'تجاهل البلاغ' : 'Dismiss Flag',
    approve: isRtl ? 'قبول' : 'Approve',
    reject: isRtl ? 'رفض' : 'Reject',
    close: isRtl ? 'إغلاق' : 'Close',
    reasonPlaceholder: isRtl ? 'أدخل سبب الحظر...' : 'Enter suspension reason...',
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()} dir={isRtl ? 'rtl' : 'ltr'}>
        <button style={styles.closeBtn} onClick={onClose}>✕</button>
        <h2 style={styles.modalTitle}>{t.title}</h2>

        {/* Tab Selection */}
        <div style={styles.tabContainer}>
          {(['flagged', 'appeals', 'judges', 'security'] as const).map((tab) => {
            const isActive = activeTab === tab;
            const getLabel = () => {
              if (tab === 'flagged') return t.tabFlagged;
              if (tab === 'appeals') return t.tabAppeals;
              if (tab === 'judges') return t.tabJudges;
              return t.tabSecurity;
            };
            return (
              <button
                key={tab}
                onClick={() => { playSFX('click'); setActiveTab(tab); }}
                style={{
                  ...styles.tabBtn,
                  borderBottom: isActive ? '2px solid #00f2fe' : '2px solid transparent',
                  color: isActive ? '#00f2fe' : '#8a93c0',
                }}
              >
                {getLabel()}
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        <div style={styles.tabContent}>
          {loading ? (
            <div style={styles.statusMsg}>{t.loading}</div>
          ) : (
            <>
              {/* FLAGGED & PATTERN TAB */}
              {activeTab === 'flagged' && (
                <div style={styles.scrollSection}>
                  <h3 style={styles.subHeader}>{isRtl ? 'تحليلات الأنماط المشبوهة' : 'Suspicious Pattern Analyses'}</h3>
                  
                  {/* Fingerprint Overlaps */}
                  {analyses.duplicateFingerprints && analyses.duplicateFingerprints.length > 0 && (
                    <div style={styles.card}>
                      <h4 style={styles.cardTitle}>⚠️ {isRtl ? 'تكرار بصمات الأجهزة' : 'Device Fingerprint Overlaps'}</h4>
                      {analyses.duplicateFingerprints.map((item: FingerprintOverlap, idx: number) => (
                        <div key={idx} style={styles.alertRow}>
                          <p style={styles.alertDesc}>{item.reason}</p>
                          <ul style={styles.usersList}>
                            {item.users.map((u: FingerprintUser) => (
                              <li key={u.id}>
                                <span style={styles.userName}>{u.username}</span> ({u.email}) - <span style={styles.dateText}>{new Date(u.createdAt).toLocaleDateString()}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* IP Overlaps */}
                  {analyses.duplicateIPs && analyses.duplicateIPs.length > 0 && (
                    <div style={styles.card}>
                      <h4 style={styles.cardTitle}>🌐 {isRtl ? 'تكرار عناوين الـ IP' : 'IP Address Overlaps'}</h4>
                      {analyses.duplicateIPs.map((item: IPOverlap, idx: number) => (
                        <div key={idx} style={styles.alertRow}>
                          <p style={styles.alertDesc}>{item.reason}</p>
                          <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#8a93c0' }}>
                            {isRtl ? 'المستخدمون:' : 'Users:'} {item.usernames.join(', ')}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Rapid signup sequence */}
                  {analyses.rapidSignups && analyses.rapidSignups.length > 0 && (
                    <div style={styles.card}>
                      <h4 style={styles.cardTitle}>⚡ {isRtl ? 'تسجيل متتابع سريع جداً' : 'Rapid Sequential Signups (<5 mins)'}</h4>
                      {analyses.rapidSignups.map((item: RapidSignup, idx: number) => (
                        <div key={idx} style={styles.alertRow}>
                          <p style={styles.alertDesc}>{item.reason}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Similar usernames */}
                  {analyses.similarUsernames && analyses.similarUsernames.length > 0 && (
                    <div style={styles.card}>
                      <h4 style={styles.cardTitle}>📝 {isRtl ? 'تشابه أسماء المستخدمين' : 'Similar Username Patterns'}</h4>
                      {analyses.similarUsernames.map((item: SimilarUsername, idx: number) => (
                        <div key={idx} style={styles.alertRow}>
                          <p style={styles.alertDesc}>{item.reason}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {(!analyses.duplicateFingerprints || analyses.duplicateFingerprints.length === 0) &&
                   (!analyses.duplicateIPs || analyses.duplicateIPs.length === 0) &&
                   (!analyses.rapidSignups || analyses.rapidSignups.length === 0) &&
                   (!analyses.similarUsernames || analyses.similarUsernames.length === 0) && (
                     <div style={styles.emptyText}>✓ {isRtl ? 'لم يتم العثور على أنماط حسابات وهمية مشبوهة.' : 'No fake account patterns detected.'}</div>
                  )}

                  <h3 style={styles.subHeader}>{isRtl ? 'الحسابات المبلغ عنها حالياً' : 'Currently Flagged Accounts'}</h3>
                  {flaggedProfiles.length > 0 ? (
                    <div style={styles.table}>
                      {flaggedProfiles.map((p) => (
                        <div key={p.id} style={styles.tableRow}>
                          <div style={styles.playerMeta}>
                            <span style={{ fontWeight: 'bold', color: '#ffffff' }}>{p.username}</span>
                            <span style={{ fontSize: '0.75rem', color: '#ff3b5c' }}>{p.flag_reason || (isRtl ? 'بلاغ نشط' : 'Active Flag')}</span>
                          </div>
                          <div style={styles.actionRow}>
                            {!p.is_suspended && (
                              <button 
                                style={styles.suspendBtn} 
                                onClick={() => setSuspendUserId(p.id)}
                              >
                                {t.suspend}
                              </button>
                            )}
                            <button 
                              style={styles.dismissBtn} 
                              onClick={() => handleDismissFlag(p.id)}
                            >
                              {t.dismiss}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={styles.emptyText}>{t.noData}</div>
                  )}
                </div>
              )}

              {/* DEVICE APPEALS TAB */}
              {activeTab === 'appeals' && (
                <div style={styles.scrollSection}>
                  {appeals.length > 0 ? (
                    <div style={styles.table}>
                      {appeals.map((appeal) => (
                        <div key={appeal.id} style={styles.card}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                            <span style={{ fontWeight: 'bold', color: '#ffffff' }}>{appeal.username}</span>
                            <span style={{ 
                              fontSize: '0.8rem', 
                              fontWeight: 'bold',
                              color: appeal.status === 'PENDING' ? '#ffd700' : appeal.status === 'APPROVED' ? '#00ff87' : '#ff3b5c' 
                            }}>
                              {appeal.status}
                            </span>
                          </div>
                          <p style={{ margin: '4px 0', fontSize: '0.85rem', color: '#8a93c0' }}>
                            <strong>Fingerprint:</strong> {appeal.device_fingerprint}
                          </p>
                          <p style={{ margin: '4px 0 8px 0', fontSize: '0.9rem', color: '#ffffff', backgroundColor: 'rgba(255,255,255,0.03)', padding: '8px', borderRadius: '4px' }}>
                            <strong>Reason:</strong> &quot;{appeal.reason}&quot;
                          </p>
                          <span style={{ fontSize: '0.75rem', color: '#8a93c0', display: 'block', marginBottom: '10px' }}>
                            {new Date(appeal.created_at).toLocaleString()}
                          </span>
                          {appeal.status === 'PENDING' && (
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button 
                                style={styles.approveBtn} 
                                onClick={() => handleResolveAppeal(appeal.id, 'APPROVED')}
                              >
                                {t.approve}
                              </button>
                              <button 
                                style={styles.rejectBtn} 
                                onClick={() => handleResolveAppeal(appeal.id, 'REJECTED')}
                              >
                                {t.reject}
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={styles.emptyText}>{t.noData}</div>
                  )}
                </div>
              )}

              {/* JUDGE AUDIT TAB */}
              {activeTab === 'judges' && (
                <div style={styles.scrollSection}>
                  {judgeLogs.length > 0 ? (
                    <div style={styles.table}>
                      {judgeLogs.map((log) => (
                        <div key={log.id} style={styles.logCard}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                            <span style={{ fontWeight: 'bold', color: '#00f2fe' }}>🧑‍⚖️ {log.judge_username}</span>
                            <span style={{ fontSize: '0.75rem', color: '#8a93c0' }}>
                              {new Date(log.timestamp).toLocaleString()}
                            </span>
                          </div>
                          <p style={{ margin: '4px 0', fontSize: '0.85rem', color: '#ffffff' }}>
                            <strong>Action:</strong> {log.action}
                          </p>
                          <p style={{ margin: '4px 0', fontSize: '0.9rem', color: '#8a93c0' }}>
                            {log.details}
                          </p>
                          {log.target_username && (
                            <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#ffd700' }}>
                              Target: {log.target_username}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={styles.emptyText}>{t.noData}</div>
                  )}
                </div>
              )}

              {/* SECURITY LOGS TAB */}
              {activeTab === 'security' && (
                <div style={styles.scrollSection}>
                  {securityLogs.length > 0 ? (
                    <div style={styles.table}>
                      {securityLogs.map((log) => (
                        <div key={log.id} style={styles.logCard}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                            <span style={{ 
                              fontWeight: 'bold', 
                              color: log.action.includes('blocked') || log.action.includes('detected') ? '#ff3b5c' : '#00ff87' 
                            }}>
                              {log.action}
                            </span>
                            <span style={{ fontSize: '0.72rem', color: '#8a93c0' }}>
                              {new Date(log.timestamp).toLocaleString()}
                            </span>
                          </div>
                          <p style={{ margin: '2px 0', fontSize: '0.82rem', color: '#ffffff' }}>
                            User: <strong>{log.username}</strong> | IP: {log.ip_address || 'N/A'}
                          </p>
                          {log.device_fingerprint && (
                            <p style={{ margin: '2px 0', fontSize: '0.78rem', color: '#8a93c0', fontFamily: 'monospace' }}>
                              Device: {log.device_fingerprint}
                            </p>
                          )}
                          {log.metadata && Object.keys(log.metadata).length > 0 && (
                            <p style={{ margin: '4px 0 0 0', fontSize: '0.78rem', color: '#8d94ba', backgroundColor: 'rgba(0,0,0,0.2)', padding: '4px', borderRadius: '4px', fontFamily: 'monospace' }}>
                              {JSON.stringify(log.metadata)}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={styles.emptyText}>{t.noData}</div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Suspension Overlay Dialog */}
        {suspendUserId && (
          <div style={styles.dialogOverlay}>
            <div style={styles.dialogModal}>
              <h3 style={{ margin: '0 0 12px 0', color: '#ffffff' }}>{isRtl ? 'تعليق حساب المستخدم' : 'Suspend Player Account'}</h3>
              <textarea
                style={styles.textArea}
                placeholder={t.reasonPlaceholder}
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
              />
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '12px' }}>
                <button 
                  style={styles.cancelBtn} 
                  onClick={() => { playSFX('click'); setSuspendUserId(null); setSuspendReason(''); }}
                >
                  {isRtl ? 'إلغاء' : 'Cancel'}
                </button>
                <button 
                  style={styles.confirmBtn} 
                  onClick={handleSuspendUser}
                >
                  {isRtl ? 'تأكيد الحظر' : 'Confirm Banish'}
                </button>
              </div>
            </div>
          </div>
        )}

        <button style={styles.actionBtn} onClick={onClose}>
          {t.close}
        </button>
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
    zIndex: 1100,
    boxSizing: 'border-box'
  },
  modal: {
    width: '92%',
    maxWidth: '700px',
    height: '85vh',
    backgroundColor: 'rgba(11, 13, 26, 0.96)',
    border: '1px solid rgba(0, 242, 254, 0.2)',
    boxShadow: '0 12px 40px rgba(0, 242, 254, 0.15)',
    borderRadius: '16px',
    padding: '24px',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
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
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.9rem'
  },
  modalTitle: {
    margin: '0 0 8px 0',
    fontSize: '1.4rem',
    fontWeight: 800,
    color: '#ffffff',
    textAlign: 'center',
    fontFamily: 'var(--font-display)',
    textShadow: '0 0 10px rgba(0, 242, 254, 0.3)'
  },
  tabContainer: {
    display: 'flex',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    gap: '12px',
    paddingBottom: '4px',
    overflowX: 'auto'
  },
  tabBtn: {
    background: 'none',
    border: 'none',
    padding: '8px 12px',
    fontSize: '0.88rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    whiteSpace: 'nowrap'
  },
  tabContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0
  },
  scrollSection: {
    flex: 1,
    overflowY: 'auto',
    paddingRight: '6px',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px'
  },
  subHeader: {
    margin: '0 0 4px 0',
    fontSize: '1.05rem',
    fontWeight: 700,
    color: '#ffffff',
    borderLeft: '3px solid #00f2fe',
    paddingLeft: '8px'
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid rgba(255, 255, 255, 0.05)',
    borderRadius: '10px',
    padding: '14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  cardTitle: {
    margin: 0,
    fontSize: '0.92rem',
    fontWeight: 700,
    color: '#ffffff'
  },
  alertRow: {
    padding: '8px 0',
    borderBottom: '1px solid rgba(255,255,255,0.03)'
  },
  alertDesc: {
    margin: 0,
    fontSize: '0.85rem',
    color: '#ffd700'
  },
  usersList: {
    margin: '6px 0 0 0',
    paddingLeft: '20px',
    fontSize: '0.8rem',
    color: '#8a93c0'
  },
  userName: {
    fontWeight: 'bold',
    color: '#ffffff'
  },
  dateText: {
    fontSize: '0.75rem',
    color: '#8d94ba'
  },
  table: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  tableRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 14px',
    backgroundColor: 'rgba(255,255,255,0.01)',
    border: '1px solid rgba(255,255,255,0.04)',
    borderRadius: '8px'
  },
  playerMeta: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px'
  },
  actionRow: {
    display: 'flex',
    gap: '8px'
  },
  suspendBtn: {
    backgroundColor: 'rgba(255, 59, 92, 0.1)',
    border: '1px solid #ff3b5c',
    color: '#ff3b5c',
    borderRadius: '6px',
    padding: '5px 10px',
    fontSize: '0.8rem',
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  dismissBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    color: '#8a93c0',
    borderRadius: '6px',
    padding: '5px 10px',
    fontSize: '0.8rem',
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  approveBtn: {
    flex: 1,
    backgroundColor: 'rgba(0, 255, 135, 0.12)',
    border: '1px solid #00ff87',
    color: '#00ff87',
    borderRadius: '6px',
    padding: '8px',
    fontSize: '0.85rem',
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  rejectBtn: {
    flex: 1,
    backgroundColor: 'rgba(255, 59, 92, 0.12)',
    border: '1px solid #ff3b5c',
    color: '#ff3b5c',
    borderRadius: '6px',
    padding: '8px',
    fontSize: '0.85rem',
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  logCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.01)',
    border: '1px solid rgba(255, 255, 255, 0.03)',
    borderRadius: '8px',
    padding: '10px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '3px'
  },
  emptyText: {
    textAlign: 'center',
    padding: '30px',
    color: '#8a93c0',
    fontSize: '0.9rem'
  },
  statusMsg: {
    textAlign: 'center',
    padding: '40px',
    color: '#00f2fe',
    fontSize: '1rem',
    fontWeight: 'bold'
  },
  actionBtn: {
    backgroundColor: 'rgba(0, 242, 254, 0.08)',
    border: '1px solid #00f2fe',
    color: '#ffffff',
    padding: '10px',
    borderRadius: '8px',
    fontSize: '0.95rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily: 'var(--font-ui)',
    textAlign: 'center'
  },
  dialogOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1200
  },
  dialogModal: {
    width: '90%',
    maxWidth: '360px',
    backgroundColor: '#0f1123',
    border: '1px solid rgba(255, 59, 92, 0.3)',
    boxShadow: '0 8px 30px rgba(255, 59, 92, 0.15)',
    borderRadius: '12px',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column'
  },
  textArea: {
    width: '100%',
    height: '80px',
    backgroundColor: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    color: '#ffffff',
    padding: '10px',
    fontSize: '0.88rem',
    outline: 'none',
    boxSizing: 'border-box',
    resize: 'none'
  },
  cancelBtn: {
    backgroundColor: 'transparent',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    color: '#8a93c0',
    borderRadius: '6px',
    padding: '6px 14px',
    fontSize: '0.85rem',
    cursor: 'pointer'
  },
  confirmBtn: {
    backgroundColor: '#ff3b5c',
    border: 'none',
    color: '#ffffff',
    borderRadius: '6px',
    padding: '6px 14px',
    fontSize: '0.85rem',
    fontWeight: 'bold',
    cursor: 'pointer'
  }
};
