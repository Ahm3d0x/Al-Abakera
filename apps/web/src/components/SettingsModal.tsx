import React from 'react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  sfxEnabled: boolean;
  setSfxEnabled: (v: boolean) => void;
  sfxVolume: number;
  setSfxVolume: (v: number) => void;
  isRtl: boolean;
  setIsRtl: (v: boolean) => void;
  playSFX: (type: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  sfxEnabled,
  setSfxEnabled,
  sfxVolume,
  setSfxVolume,
  isRtl,
  setIsRtl,
  playSFX
}) => {
  if (!isOpen) return null;

  const t = {
    title: isRtl ? 'إعدادات اللعبة' : 'Game Settings',
    soundEffects: isRtl ? 'المؤثرات الصوتية' : 'Sound Effects',
    volume: isRtl ? 'مستوى الصوت' : 'Sound Volume',
    language: isRtl ? 'اللغة الحالية' : 'Current Language',
    on: isRtl ? 'تشغيل' : 'ON',
    off: isRtl ? 'إيقاف' : 'OFF',
    close: isRtl ? 'إغلاق' : 'Close'
  };

  const handleToggleSfx = () => {
    playSFX('click');
    setSfxEnabled(!sfxEnabled);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setSfxVolume(val);
  };

  const handleVolumeMouseUp = () => {
    playSFX('tick');
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()} dir={isRtl ? 'rtl' : 'ltr'}>
        {/* Close Button */}
        <button style={styles.closeBtn} onClick={onClose}>✕</button>
        
        <h2 style={styles.title}>{t.title}</h2>

        <div style={styles.content}>
          {/* Sound Toggle */}
          <div style={styles.settingRow}>
            <div style={styles.settingLabelGroup}>
              <span style={styles.settingIcon}>🔊</span>
              <span style={styles.settingName}>{t.soundEffects}</span>
            </div>
            <button
              style={{
                ...styles.toggleBtn,
                backgroundColor: sfxEnabled ? 'rgba(0, 245, 255, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                borderColor: sfxEnabled ? 'var(--cyan-glow)' : 'rgba(255, 255, 255, 0.1)',
                color: sfxEnabled ? 'var(--cyan-glow)' : '#8a93c0'
              }}
              onClick={handleToggleSfx}
            >
              {sfxEnabled ? t.on : t.off}
            </button>
          </div>

          {/* Volume Slider */}
          <div style={styles.settingColumn}>
            <div style={styles.settingLabelGroup}>
              <span style={styles.settingIcon}>🎚️</span>
              <span style={styles.settingName}>{t.volume} ({Math.round(sfxVolume * 100)}%)</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={sfxVolume}
              onChange={handleVolumeChange}
              onMouseUp={handleVolumeMouseUp}
              onTouchEnd={handleVolumeMouseUp}
              disabled={!sfxEnabled}
              style={{
                ...styles.rangeInput,
                opacity: sfxEnabled ? 1 : 0.4
              }}
            />
          </div>

          {/* Language Switch */}
          <div style={styles.settingRow}>
            <div style={styles.settingLabelGroup}>
              <span style={styles.settingIcon}>🌐</span>
              <span style={styles.settingName}>{t.language}</span>
            </div>
            <button
              style={styles.langBtn}
              onClick={() => {
                playSFX('click');
                setIsRtl(!isRtl);
              }}
            >
              {isRtl ? 'العربية' : 'English'}
            </button>
          </div>
        </div>

        <button 
          style={styles.actionBtn} 
          onClick={() => { playSFX('click'); onClose(); }}
        >
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
    zIndex: 1000,
    boxSizing: 'border-box'
  },
  modal: {
    width: '85%',
    maxWidth: '400px',
    backgroundColor: 'rgba(11, 13, 26, 0.95)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5)',
    borderRadius: '16px',
    padding: '24px',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px'
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
  title: {
    margin: 0,
    fontSize: '1.5rem',
    fontWeight: 700,
    color: '#ffffff',
    fontFamily: 'var(--font-display)',
    textAlign: 'center'
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px'
  },
  settingRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 0',
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)'
  },
  settingColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '10px 0',
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)'
  },
  settingLabelGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
  },
  settingIcon: {
    fontSize: '1.2rem'
  },
  settingName: {
    color: '#ffffff',
    fontFamily: 'var(--font-ui)',
    fontSize: '0.95rem'
  },
  toggleBtn: {
    border: '1px solid',
    borderRadius: '8px',
    padding: '6px 16px',
    fontSize: '0.85rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily: 'var(--font-ui)',
    transition: 'all 0.2s ease'
  },
  langBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    color: '#ffffff',
    padding: '6px 16px',
    fontSize: '0.85rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily: 'var(--font-ui)'
  },
  rangeInput: {
    width: '100%',
    cursor: 'pointer',
    accentColor: 'var(--cyan-glow)'
  },
  actionBtn: {
    backgroundColor: 'rgba(0, 245, 255, 0.12)',
    border: '1px solid var(--cyan-glow)',
    color: '#ffffff',
    padding: '10px',
    borderRadius: '8px',
    fontSize: '0.95rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily: 'var(--font-ui)',
    marginTop: '10px',
    textAlign: 'center'
  }
};
