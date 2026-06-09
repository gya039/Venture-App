'use client';

export const dynamic = 'force-dynamic';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  sendPasswordResetEmail,
  GoogleAuthProvider,
} from 'firebase/auth';
import { auth } from '@/lib/firebase';
import ScoreMedallion from '@/components/ScoreMedallion';

const googleProvider = new GoogleAuthProvider();

function GoogleIcon() {
  return (
    <svg className="g-ic" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"/>
      <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z"/>
    </svg>
  );
}

const friendlyError = (code) => {
  const map = {
    'auth/invalid-credential':     'Email or password is incorrect.',
    'auth/user-not-found':          'No account with that email.',
    'auth/wrong-password':          'Incorrect password.',
    'auth/email-already-in-use':    'An account with that email already exists.',
    'auth/weak-password':           'Password must be at least 6 characters.',
    'auth/invalid-email':           'Please enter a valid email address.',
    'auth/popup-closed-by-user':    'Sign-in popup closed — please try again.',
    'auth/network-request-failed':  'Network error — check your connection.',
    'auth/operation-not-allowed':   'Email/password sign-in is not enabled.',
    'auth/configuration-not-found': 'Firebase Auth is not configured. Check .env.local.',
    'auth/too-many-requests':       'Too many attempts — please wait a moment.',
  };
  return map[code] ?? `Authentication error (${code ?? 'unknown'})`;
};

/* Spectrum tiers — must match HIDDENNESS_LEVELS in src/constants/hiddenness.js */
const SPECTRUM = [
  { score: 2,  label: 'Tourist Trail'  },
  { score: 4,  label: 'Well-Trodden'  },
  { score: 6,  label: 'Worth a Detour' },
  { score: 8,  label: 'Local Secret'  },
  { score: 10, label: 'Off the Radar'  },
];

export default function AuthPage() {
  return <Suspense fallback={null}><AuthPageContent /></Suspense>;
}

function AuthPageContent() {
  const searchParams = useSearchParams();
  const [mode,     setMode]     = useState('signin');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [info,     setInfo]     = useState('');
  const [loading,  setLoading]  = useState(false);

  const clear      = () => { setError(''); setInfo(''); };
  const switchMode = (next) => { setMode(next); clear(); };
  const goHome     = () => {
    window.location.href = searchParams?.get('redirect') ?? '/';
  };

  const handleEmailAuth = async (e) => {
    e.preventDefault();
    clear(); setLoading(true);
    try {
      if (mode === 'signin') {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
      goHome();
    } catch (err) {
      setError(friendlyError(err.code));
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    clear(); setLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
      goHome();
    } catch (err) {
      setError(friendlyError(err.code));
      setLoading(false);
    }
  };

  const handleForgot = async (e) => {
    e.preventDefault();
    if (!email.trim()) { setError('Please enter your email address.'); return; }
    clear(); setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setInfo(`Reset link sent to ${email}. Check your inbox (and spam folder).`);
    } catch (err) {
      setError(friendlyError(err.code));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell">

      {/* ══ Left brand panel ══ */}
      <div className="auth-brand">
        <div className="ab-grid" />

        {/* Wordmark */}
        <Link href="/" className="ab-mark">
          Venture<sup>N48°51′</sup>
        </Link>

        {/* Headline copy */}
        <div className="ab-body">
          <div className="ab-eyebrow">The Field Guide</div>
          <h1>Discover what most tourists <em>never find.</em></h1>
          <p className="ab-sub">
            AI researches any city in seconds — dozens of scored hidden gems, an interactive map, and a day-by-day itinerary. All free.
          </p>

          {/* Hiddenness spectrum */}
          <div className="ab-spectrum">
            {SPECTRUM.map(({ score, label }) => (
              <div key={score} className="ab-med">
                <ScoreMedallion score={score} size={44} />
                <span className="ab-cap">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ══ Right form panel ══ */}
      <div className="auth-form-panel">
        <div className="auth-card">

          {/* ── Forgot password mode ── */}
          {mode === 'forgot' && (
            <>
              <button className="back-signin" onClick={() => switchMode('signin')}>
                ← Back to sign in
              </button>
              <div className="ac-title">Reset password</div>
              <p className="ac-sub">We'll email you a reset link.</p>

              <form onSubmit={handleForgot} style={{ marginTop: 26, display: 'flex', flexDirection: 'column', gap: 0 }}>
                <div className="auth-field">
                  <label>Email</label>
                  <input
                    type="email" placeholder="you@example.com" value={email} required
                    onChange={(e) => setEmail(e.target.value)}
                    autoFocus autoComplete="email"
                  />
                </div>

                {error && <ErrorBox msg={error} />}
                {info  && <InfoBox  msg={info}  />}

                <button
                  type="submit" disabled={loading || !!info}
                  className="btn btn-primary auth-submit"
                  style={{ border: 'none', cursor: loading || info ? 'not-allowed' : 'pointer', opacity: loading || info ? 0.7 : 1 }}
                >
                  {loading ? '…' : 'Send reset email'}
                </button>
              </form>
            </>
          )}

          {/* ── Sign in / Sign up ── */}
          {mode !== 'forgot' && (
            <>
              <div className="ac-title">
                {mode === 'signin' ? 'Welcome back' : 'Create account'}
              </div>
              <p className="ac-sub">
                {mode === 'signin' ? 'Sign in to your Venture account.' : 'Start planning your hidden adventures.'}
              </p>

              {/* Google */}
              <button
                className="google-btn"
                onClick={handleGoogle}
                disabled={loading}
                style={{ opacity: loading ? 0.7 : 1 }}
              >
                <GoogleIcon />
                Continue with Google
              </button>

              {/* Divider */}
              <div className="auth-divider"><span>or with email</span></div>

              {/* Email form */}
              <form onSubmit={handleEmailAuth} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                <div className="auth-field">
                  <label>Email</label>
                  <input
                    type="email" placeholder="you@example.com" value={email} required
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                </div>

                <div className="auth-field">
                  <div className="field-row">
                    <label>Password</label>
                    {mode === 'signin' && (
                      <button type="button" className="forgot" onClick={() => switchMode('forgot')}>
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <input
                    type="password" placeholder="••••••••" value={password} required
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  />
                </div>

                {error && <ErrorBox msg={error} />}

                <button
                  type="submit" disabled={loading}
                  className="btn btn-primary auth-submit"
                  style={{ border: 'none', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}
                >
                  {loading ? '…' : mode === 'signin' ? 'Sign In' : 'Create Account'}
                </button>
              </form>

              <div className="auth-toggle">
                {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
                <button onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}>
                  {mode === 'signin' ? 'Sign up' : 'Sign in'}
                </button>
              </div>

              <p className="auth-legal">
                By continuing you agree to our{' '}
                <a href="#">Terms of Service</a> and <a href="#">Privacy Policy</a>.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ErrorBox({ msg }) {
  return (
    <div style={{
      padding: '10px 14px', marginBottom: 14,
      background: 'color-mix(in oklch, var(--error) 10%, var(--card))',
      border: '1px solid color-mix(in oklch, var(--error) 30%, transparent)',
      borderRadius: 10, color: 'var(--error)', fontSize: 13.5, lineHeight: 1.5,
    }}>
      {msg}
    </div>
  );
}

function InfoBox({ msg }) {
  return (
    <div style={{
      padding: '10px 14px', marginBottom: 14,
      background: 'color-mix(in oklch, var(--olive) 10%, var(--card))',
      border: '1px solid color-mix(in oklch, var(--olive) 30%, transparent)',
      borderRadius: 10, color: 'var(--olive)', fontSize: 13.5, lineHeight: 1.5,
    }}>
      {msg}
    </div>
  );
}
