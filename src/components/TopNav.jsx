'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useTripModal } from '@/components/TripModalProvider';

const NAV = [
  { href: '/',        label: 'My Trips' },
  { href: '/explore', label: 'Explore'  },
  { href: '/profile', label: 'Profile'  },
];

function initials(email = '') {
  return email.slice(0, 2).toUpperCase();
}

export default function TopNav() {
  const pathname  = usePathname();
  const { user }  = useAuth();
  const tripModal = useTripModal();
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const handleNewTrip = () => { setOpen(false); tripModal?.openModal(); };

  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 50,
      display: 'flex', alignItems: 'center', gap: 24,
      height: 70, padding: '0 38px',
      borderBottom: '1px solid var(--line)',
      background: 'color-mix(in oklch, var(--paper) 84%, transparent)',
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
    }}>

      {/* ── Wordmark ── */}
      <Link href="/" style={{
        fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 25,
        letterSpacing: '-0.01em', color: 'var(--ink)',
        textDecoration: 'none', display: 'flex', alignItems: 'baseline', gap: 7,
        flexShrink: 0,
      }}>
        Venture
        <sup style={{
          fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--terracotta)',
          letterSpacing: '0.04em', fontWeight: 700, position: 'relative', top: '-0.95em',
        }}>N48°51′</sup>
      </Link>

      {/* ── Desktop nav links — centred ── */}
      <nav style={{
        display: 'flex', gap: 4, margin: '0 auto',
        position: 'absolute', left: '50%', transform: 'translateX(-50%)',
      }} className="hide-mobile">
        {NAV.map(({ href, label }) => {
          const active = pathname === href || (href !== '/' && pathname?.startsWith(href));
          return (
            <Link key={href} href={href} style={{
              fontWeight: 600, fontSize: 14, padding: '9px 16px', borderRadius: 10,
              color: active ? 'var(--ink)' : 'var(--muted)',
              background: active ? 'var(--card)' : 'transparent',
              border: active ? '1px solid var(--line)' : '1px solid transparent',
              boxShadow: active ? 'var(--shadow-sm)' : 'none',
              textDecoration: 'none', transition: 'all .15s',
            }}
            onMouseEnter={(e) => { if (!active) { e.currentTarget.style.color = 'var(--ink)'; e.currentTarget.style.background = 'var(--paper-2)'; } }}
            onMouseLeave={(e) => { if (!active) { e.currentTarget.style.color = 'var(--muted)'; e.currentTarget.style.background = 'transparent'; } }}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      {/* ── Desktop right ── */}
      <div className="hide-mobile" style={{ display: 'flex', alignItems: 'center', gap: 14, marginLeft: 'auto' }}>
        <button
          onClick={handleNewTrip}
          className="btn btn-primary btn-sm"
          style={{ border: 'none', cursor: 'pointer', flexShrink: 0 }}
        >
          + New Trip
        </button>

        {user ? (
          <Link href="/profile" title={user.email} style={{
            width: 40, height: 40, borderRadius: '50%',
            background: 'var(--ink)', color: 'var(--paper)',
            fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 13,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            textDecoration: 'none', letterSpacing: '0.02em',
            transition: 'transform .15s', flexShrink: 0,
          }}
          onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
          onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
          >
            {initials(user.email)}
          </Link>
        ) : (
          <Link href="/auth" style={{
            fontFamily: 'var(--sans)', fontWeight: 600, fontSize: 13.5,
            color: 'var(--ink)', background: 'var(--card)',
            border: '1px solid var(--line-strong)', borderRadius: 11,
            padding: '9px 16px', textDecoration: 'none', transition: 'all .16s',
          }}
          onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--ink)'}
          onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--line-strong)'}
          >
            Sign in
          </Link>
        )}
      </div>

      {/* ── Mobile: hamburger ── */}
      <div ref={menuRef} className="hide-desktop" style={{ display: 'flex', alignItems: 'center', marginLeft: 'auto', position: 'relative' }}>
        <button
          onClick={() => setOpen(!open)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          style={{
            background: 'var(--card)', border: '1px solid var(--line-strong)',
            borderRadius: 9, padding: '7px 9px', cursor: 'pointer',
            color: 'var(--ink-soft)', display: 'flex', alignItems: 'center',
            transition: 'border-color .15s',
          }}
          onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--ink)'}
          onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--line-strong)'}
        >
          {open ? (
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>

        {open && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 10px)', right: 0,
            width: 220, background: 'var(--card)',
            border: '1px solid var(--line-strong)', borderRadius: 14,
            boxShadow: 'var(--shadow-lg)', padding: 8,
            display: 'flex', flexDirection: 'column', gap: 2,
            animation: 'popoverIn 0.15s ease',
          }}>
            {NAV.map(({ href, label }) => {
              const active = pathname === href || (href !== '/' && pathname?.startsWith(href));
              return (
                <Link key={href} href={href} style={{
                  display: 'block', padding: '10px 12px', borderRadius: 8,
                  fontSize: 14, fontWeight: active ? 600 : 500,
                  color: active ? 'var(--ink)' : 'var(--ink-soft)',
                  background: active ? 'var(--paper-2)' : 'transparent',
                  textDecoration: 'none',
                }}>
                  {label}
                </Link>
              );
            })}

            <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />

            <button
              type="button"
              onClick={handleNewTrip}
              style={{
                width: '100%', padding: '10px 12px', textAlign: 'left',
                background: 'var(--terracotta)', color: 'var(--paper)',
                border: 'none', borderRadius: 9,
                fontFamily: 'var(--sans)', fontWeight: 600, fontSize: 14,
                cursor: 'pointer',
              }}
            >
              + New Trip
            </button>

            {user ? (
              <Link href="/profile" style={{
                padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10,
                textDecoration: 'none',
              }}>
                <div style={{
                  width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                  background: 'var(--ink)', color: 'var(--paper)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700,
                }}>
                  {initials(user.email)}
                </div>
                <p style={{
                  fontSize: 13, color: 'var(--muted)', overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0,
                }}>
                  {user.email}
                </p>
              </Link>
            ) : (
              <Link href="/auth" style={{
                display: 'block', padding: '10px 12px', textAlign: 'center',
                color: 'var(--ink-soft)', border: '1px solid var(--line-strong)',
                borderRadius: 8, fontSize: 14, marginTop: 2, textDecoration: 'none',
              }}>
                Sign in
              </Link>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
