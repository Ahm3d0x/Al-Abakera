'use client';

import React from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={styles.body}>
        <div style={styles.card}>
          <h1 style={styles.title}>MIND RACE</h1>
          <h2 style={styles.subtitle}>Something went wrong!</h2>
          <p style={styles.message}>
            {error?.message || 'An unexpected error occurred in the application.'}
          </p>
          <button style={styles.button} onClick={() => reset()}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

const styles = {
  body: {
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100vh',
    margin: 0,
    backgroundColor: '#090a0f',
    color: '#ffffff',
  },
  card: {
    textAlign: 'center' as const,
    padding: '40px 30px',
    background: 'rgba(255, 255, 255, 0.03)',
    borderRadius: '12px',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    maxWidth: '450px',
    boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
    backdropFilter: 'blur(8px)',
  },
  title: {
    fontSize: '2rem',
    fontWeight: 800,
    letterSpacing: '0.15em',
    color: '#ffffff',
    margin: '0 0 10px 0',
    textShadow: '0 0 10px rgba(255, 255, 255, 0.3)',
  },
  subtitle: {
    fontSize: '1.25rem',
    fontWeight: 600,
    color: '#e53e3e',
    margin: '0 0 16px 0',
  },
  message: {
    color: '#a0aec0',
    marginBottom: '24px',
    fontSize: '0.95rem',
    lineHeight: 1.5,
  },
  button: {
    padding: '12px 24px',
    backgroundColor: 'transparent',
    color: '#ffffff',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: '0.9rem',
    transition: 'all 0.2s ease',
    outline: 'none',
  },
};
