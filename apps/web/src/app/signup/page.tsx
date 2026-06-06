'use client';

import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import Link from 'next/link';
import { getDeviceFingerprint } from '../../lib/fingerprint';

export default function SignupPage() {
  const { signUp, signInWithOAuth } = useAuth();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isRtl, setIsRtl] = useState(false);

  const activeText = isRtl
    ? {
        title: 'إنشاء حساب',
        subtitle: 'انضم لسباق العقول وابدأ التحدي المعرفي',
        usernameLabel: 'اسم المستخدم',
        emailLabel: 'البريد الإلكتروني',
        passwordLabel: 'كلمة المرور',
        signUpBtn: 'إنشاء الحساب',
        signUpLoading: 'جاري إنشاء الحساب...',
        oauthDivider: 'أو سجل عبر',
        googleBtn: 'جوجل',
        appleBtn: 'أبل',
        hasAccount: 'لديك حساب بالفعل؟',
        loginLink: 'تسجيل الدخول',
        successAlert: 'تم إنشاء الحساب بنجاح! يرجى مراجعة بريدك الإلكتروني لتأكيد الحساب.',
        errorDefault: 'حدث خطأ أثناء إنشاء الحساب. يرجى المحاولة مرة أخرى.',
        langSwitch: 'English',
      }
    : {
        title: 'Create Account',
        subtitle: 'Join the Mind Race and test your limits',
        usernameLabel: 'Username',
        emailLabel: 'Email Address',
        passwordLabel: 'Password',
        signUpBtn: 'Create Account',
        signUpLoading: 'Creating Account...',
        oauthDivider: 'Or sign up with',
        googleBtn: 'Google',
        appleBtn: 'Apple',
        hasAccount: 'Already have an account?',
        loginLink: 'Sign In',
        successAlert: 'Registration successful! Please check your email to verify your account.',
        errorDefault: 'Failed to create account. Please try again.',
        langSwitch: 'العربية',
      };

  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      const fp = getDeviceFingerprint();
      const { error } = await signUp(email, password, username, fp);
      if (error) {
        setErrorMsg(error.message || activeText.errorDefault);
      } else {
        setSuccessMsg(activeText.successAlert);
        // Clear fields
        setUsername('');
        setEmail('');
        setPassword('');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : activeText.errorDefault;
      setErrorMsg(message);
    } finally {
      setLoading(false);
    }
  };

  const handleOAuthSignIn = async (provider: 'google' | 'apple') => {
    setErrorMsg(null);
    try {
      const { error } = await signInWithOAuth(provider);
      if (error) {
        setErrorMsg(error.message);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'OAuth error occurred.';
      setErrorMsg(message);
    }
  };

  return (
    <main style={styles.container} dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Top Header Glow Bar */}
      <div style={styles.topBar}>
        <div style={styles.topBarContent}>
          <div style={styles.logoContainer}>
            <Link href="/" style={styles.logoLink}>
              <span className="text-glow" style={styles.logoText}>MIND RACE</span>
            </Link>
          </div>
          <button style={styles.rtlBtn} onClick={() => setIsRtl(!isRtl)}>
            {activeText.langSwitch}
          </button>
        </div>
      </div>

      <div style={styles.authWrapper}>
        <div className="glass-panel" style={styles.authCard}>
          <div style={styles.header}>
            <h1 className="text-glow" style={styles.title}>
              {activeText.title}
            </h1>
            <p style={styles.subtitle}>{activeText.subtitle}</p>
          </div>

          {errorMsg && (
            <div style={styles.errorAlert}>
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div style={styles.successAlert}>
              <span>{successMsg}</span>
            </div>
          )}

          <form onSubmit={handleEmailSignUp} style={styles.form}>
            <div style={styles.inputGroup}>
              <label style={styles.label}>{activeText.usernameLabel}</label>
              <input
                type="text"
                required
                style={styles.input}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. cyber_champion"
              />
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>{activeText.emailLabel}</label>
              <input
                type="email"
                required
                style={styles.input}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>{activeText.passwordLabel}</label>
              <input
                type="password"
                required
                style={styles.input}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="min. 6 characters"
              />
            </div>

            <button type="submit" disabled={loading} className="btn-cyber" style={styles.submitBtn}>
              {loading ? activeText.signUpLoading : activeText.signUpBtn}
            </button>
          </form>

          <div style={styles.dividerContainer}>
            <div style={styles.dividerLine}></div>
            <span style={styles.dividerText}>{activeText.oauthDivider}</span>
            <div style={styles.dividerLine}></div>
          </div>

          <div style={styles.oauthContainer}>
            <button
              onClick={() => handleOAuthSignIn('google')}
              className="btn-cyber-outline"
              style={styles.oauthBtn}
            >
              <span style={styles.oauthBtnContent}>
                <svg style={styles.oauthIcon} viewBox="0 0 24 24">
                  <path
                    fill="#EA4335"
                    d="M12.24 10.285V14.4h6.887c-.648 2.41-2.519 4.2-5.136 4.2A5.7 5.7 0 0 1 8.3 12.9a5.7 5.7 0 0 1 5.69-5.7c1.47 0 2.8.546 3.82 1.442l3.12-3.12C18.98 3.73 16.21 2.7 13.99 2.7c-5.13 0-9.29 4.16-9.29 9.29s4.16 9.29 9.29 9.29c5.11 0 9.26-4.14 9.26-9.29a8.87 8.87 0 0 0-.25-1.714H12.24Z"
                  />
                </svg>
                {activeText.googleBtn}
              </span>
            </button>

            <button
              onClick={() => handleOAuthSignIn('apple')}
              className="btn-cyber-outline"
              style={styles.oauthBtn}
            >
              <span style={styles.oauthBtnContent}>
                <svg style={styles.oauthIcon} viewBox="0 0 24 24">
                  <path
                    fill="#FFFFFF"
                    d="M18.71 19.5c-.83 1.24-1.71 2.45-3.09 2.48-1.36.03-1.8-.8-3.36-.8-1.56 0-2.04.77-3.34.82-1.33.05-2.35-1.32-3.19-2.53C4.01 16.92 2.7 11.9 4.47 8.8c.88-1.54 2.48-2.52 4.22-2.54 1.32-.02 2.57.9 3.38.9.82 0 2.32-.1 3.89 1.52a4.63 4.63 0 0 1 2.87 4.23c-.03 2.53 2.08 3.74 2.1 3.76-.02.05-.33 1.13-1.09 2.27M15.96 4.17c.66-.81 1.11-1.93.99-3.06-1 .04-2.22.67-2.94 1.5-.64.73-1.2 1.88-1.05 3 .96.07 2.1-.53 3-1.44Z"
                  />
                </svg>
                {activeText.appleBtn}
              </span>
            </button>
          </div>

          <div style={styles.footer}>
            <span style={styles.footerText}>{activeText.hasAccount}</span>{' '}
            <Link href="/login" style={styles.footerLink}>
              {activeText.loginLink}
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'var(--bg-deep)',
  },
  topBar: {
    height: '70px',
    borderBottom: '1px solid var(--border-glass)',
    background: 'rgba(9, 10, 15, 0.8)',
    backdropFilter: 'blur(10px)',
  },
  topBarContent: {
    maxWidth: '1200px',
    height: '100%',
    margin: '0 auto',
    padding: '0 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logoContainer: {
    display: 'flex',
    alignItems: 'center',
  },
  logoLink: {
    textDecoration: 'none',
  },
  logoText: {
    fontSize: '1.4rem',
    fontWeight: 800,
    letterSpacing: '0.15em',
    color: '#ffffff',
  },
  rtlBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid var(--border-glass)',
    color: 'var(--text-primary)',
    padding: '8px 16px',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: '0.85rem',
  },
  authWrapper: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 24px',
  },
  authCard: {
    width: '100%',
    maxWidth: '450px',
    padding: '40px',
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    marginBottom: '30px',
    textAlign: 'center',
  },
  title: {
    fontSize: '2rem',
    fontWeight: 800,
    background: 'linear-gradient(to right, #ffffff, #a0aec0)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  subtitle: {
    fontSize: '0.95rem',
    color: 'var(--text-secondary)',
  },
  errorAlert: {
    backgroundColor: 'rgba(255, 23, 68, 0.1)',
    border: '1px solid var(--error)',
    color: 'var(--error)',
    padding: '12px 16px',
    borderRadius: 'var(--radius-sm)',
    marginBottom: '24px',
    fontSize: '0.9rem',
    textAlign: 'center',
  },
  successAlert: {
    backgroundColor: 'rgba(0, 230, 118, 0.1)',
    border: '1px solid var(--success)',
    color: 'var(--success)',
    padding: '12px 16px',
    borderRadius: 'var(--radius-sm)',
    marginBottom: '24px',
    fontSize: '0.9rem',
    textAlign: 'center',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  label: {
    fontSize: '0.85rem',
    fontWeight: 600,
    color: 'var(--text-secondary)',
  },
  input: {
    backgroundColor: 'var(--bg-input)',
    border: '1px solid var(--border-glass)',
    borderRadius: 'var(--radius-sm)',
    color: '#ffffff',
    padding: '12px 16px',
    fontSize: '0.95rem',
    outline: 'none',
    transition: 'all 0.2s',
  },
  submitBtn: {
    marginTop: '10px',
    width: '100%',
  },
  dividerContainer: {
    display: 'flex',
    alignItems: 'center',
    margin: '30px 0',
    gap: '10px',
  },
  dividerLine: {
    flex: 1,
    height: '1px',
    backgroundColor: 'var(--border-glass)',
  },
  dividerText: {
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  oauthContainer: {
    display: 'flex',
    gap: '16px',
  },
  oauthBtn: {
    flex: 1,
    justifyContent: 'center',
  },
  oauthBtnContent: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontWeight: 600,
    fontSize: '0.9rem',
  },
  oauthIcon: {
    width: '18px',
    height: '18px',
  },
  footer: {
    marginTop: '32px',
    textAlign: 'center',
    fontSize: '0.9rem',
    color: 'var(--text-secondary)',
  },
  footerText: {
    color: 'var(--text-muted)',
  },
  footerLink: {
    color: 'var(--primary)',
    fontWeight: 600,
  },
};
