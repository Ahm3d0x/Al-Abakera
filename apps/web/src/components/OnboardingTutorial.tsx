import React, { useState } from 'react';

interface OnboardingTutorialProps {
  isOpen: boolean;
  onClose: () => void;
  isRtl: boolean;
}

export const OnboardingTutorial: React.FC<OnboardingTutorialProps> = ({
  isOpen,
  onClose,
  isRtl,
}) => {
  const [currentSlide, setCurrentSlide] = useState(0);

  if (!isOpen) return null;

  const slides = [
    {
      title: isRtl ? '🏆 مرحباً بك في MindRace' : '🏆 Welcome to MindRace',
      desc: isRtl
        ? 'ساحة التحديات المعرفية والسرعة في الوقت الفعلي! واجه زملائك أو خض تدريبات فردية لاختبار معلوماتك.'
        : 'The real-time intellectual battle arena! Challenge your friends or train solo to test your knowledge.',
      icon: '🧠',
      accentColor: '#00f2fe'
    },
    {
      title: isRtl ? '🚨 نظام الجرس السريع' : '🚨 The Fast Buzzer System',
      desc: isRtl
        ? 'اضغط على الجرس لحجز السؤال! الإجابة السريعة تمنحك مضاعف نقاط 1.2x، لكن احذر فالإجابة الخاطئة تخصم من نقاطك وتفتح المجال للآخرين.'
        : 'Press the buzzer to lock the question! Speed gives you a 1.2x score multiplier, but incorrect answers deduct points.',
      icon: '⚡',
      accentColor: '#ffd700'
    },
    {
      title: isRtl ? '🛡️ القوى الخارقة والمتجر' : '🛡️ Power-ups & The Shop',
      desc: isRtl
        ? 'استخدم الدروع لتفادي الخصم، أو تجميد الخصوم، أو مضاعفة النقاط! اجمع العملات من الانتصارات لشراء شارات وألوان فريدة من المتجر.'
        : 'Use shields to block deductions, freeze opponents, or double your points! Earn coins from match wins to purchase items in the store.',
      icon: '🎒',
      accentColor: '#ff3b5c'
    },
    {
      title: isRtl ? '🌌 سلم الرتب والصدارة' : '🌌 Tiers & Leaderboard',
      desc: isRtl
        ? 'تقدم عبر 10 رتب من البرونزي إلى العملاق بناءً على نقاط التصنيف (RP) الخاصة بك، وراقب إحصائياتك على لوحة الصدارة المحدثة.'
        : 'Climb through 10 ranks from Bronze to Titan based on your Rank Points (RP), and trace your progress on the live Leaderboard.',
      icon: '👑',
      accentColor: '#00ff87'
    }
  ];

  const handleNext = () => {
    if (currentSlide < slides.length - 1) {
      setCurrentSlide(currentSlide + 1);
    } else {
      handleComplete();
    }
  };

  const handleBack = () => {
    if (currentSlide > 0) {
      setCurrentSlide(currentSlide - 1);
    }
  };

  const handleComplete = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('mindrace_onboarding_completed', 'true');
    }
    onClose();
  };

  const current = slides[currentSlide];

  return (
    <div style={styles.overlay} onClick={handleComplete}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()} dir={isRtl ? 'rtl' : 'ltr'}>
        
        {/* Skip Button */}
        <button style={styles.skipBtn} onClick={handleComplete}>
          {isRtl ? 'تخطي ✕' : 'Skip ✕'}
        </button>

        {/* Big Animated Icon */}
        <div style={{ ...styles.iconContainer, backgroundColor: `${current.accentColor}15` }}>
          <span style={{ ...styles.icon, textShadow: `0 0 20px ${current.accentColor}` }}>
            {current.icon}
          </span>
        </div>

        {/* Slide Title */}
        <h2 style={{ ...styles.title, color: current.accentColor }}>{current.title}</h2>

        {/* Slide Description */}
        <p style={styles.description}>{current.desc}</p>

        {/* Slide Indicators */}
        <div style={styles.indicators}>
          {slides.map((_, idx) => (
            <div
              key={idx}
              style={{
                ...styles.dot,
                backgroundColor: idx === currentSlide ? current.accentColor : 'rgba(255, 255, 255, 0.15)',
                width: idx === currentSlide ? '24px' : '8px',
              }}
            />
          ))}
        </div>

        {/* Navigation Buttons */}
        <div style={styles.navRow}>
          {currentSlide > 0 ? (
            <button style={styles.backBtn} onClick={handleBack}>
              {isRtl ? 'السابق' : 'Back'}
            </button>
          ) : (
            <div style={{ flex: 1 }} />
          )}

          <button
            style={{ ...styles.nextBtn, backgroundColor: current.accentColor, boxShadow: `0 0 15px ${current.accentColor}40` }}
            onClick={handleNext}
          >
            {currentSlide === slides.length - 1
              ? (isRtl ? 'ابدأ اللعب!' : 'Start Playing!')
              : (isRtl ? 'التالي' : 'Next')}
          </button>
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
    backgroundColor: 'rgba(5, 6, 10, 0.88)',
    backdropFilter: 'blur(10px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
    boxSizing: 'border-box'
  },
  modal: {
    width: '90%',
    maxWidth: '440px',
    backgroundColor: 'rgba(15, 18, 32, 0.95)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    boxShadow: '0 16px 50px rgba(0, 0, 0, 0.6), inset 0 0 20px rgba(255,255,255,0.01)',
    borderRadius: '20px',
    padding: '32px 24px 24px 24px',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: '20px',
    overflow: 'hidden'
  },
  skipBtn: {
    position: 'absolute',
    top: '16px',
    right: '16px',
    background: 'none',
    border: 'none',
    color: '#8a93c0',
    cursor: 'pointer',
    fontSize: '0.8rem',
    fontWeight: 'bold',
    fontFamily: 'var(--font-ui)',
    transition: 'color 0.2s',
    zIndex: 10
  },
  iconContainer: {
    width: '96px',
    height: '96px',
    borderRadius: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '8px',
    transition: 'all 0.3s ease'
  },
  icon: {
    fontSize: '3.2rem',
    animation: 'pulse 2s infinite ease-in-out'
  },
  title: {
    margin: 0,
    fontSize: '1.4rem',
    fontWeight: 900,
    fontFamily: 'var(--font-display)',
    letterSpacing: '0.5px'
  },
  description: {
    margin: 0,
    fontSize: '0.9rem',
    lineHeight: '1.6',
    color: '#8a93c0',
    fontFamily: 'var(--font-ui)',
    minHeight: '80px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 8px'
  },
  indicators: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '10px 0'
  },
  dot: {
    height: '8px',
    borderRadius: '4px',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
  },
  navRow: {
    width: '100%',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '16px',
    marginTop: '10px'
  },
  backBtn: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '10px',
    color: '#8a93c0',
    padding: '12px',
    fontSize: '0.9rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily: 'var(--font-ui)',
    transition: 'background 0.2s'
  },
  nextBtn: {
    flex: 1.5,
    border: 'none',
    borderRadius: '10px',
    color: '#0a0d1a',
    padding: '12px',
    fontSize: '0.9rem',
    fontWeight: 'extrabold',
    cursor: 'pointer',
    fontFamily: 'var(--font-ui)',
    transition: 'transform 0.15s ease'
  }
};
