'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';

const NAV = [
  {
    href: '/',
    label: 'My Trips',
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    href: '/explore',
    label: 'Explore',
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <circle cx="11" cy="11" r="8" />
        <path strokeLinecap="round" d="M21 21l-4.35-4.35" />
      </svg>
    ),
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

function UserInitials({ email }) {
  if (!email) return '?';
  return email.slice(0, 2).toUpperCase();
}

export default function Sidebar() {
  const pathname  = usePathname();
  const { user }  = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const width = collapsed ? 64 : 240;

  return (
    <aside style={{
      width, minWidth: width,
      height:    '100vh',
      position:  'sticky',
      top:       0,
      background:'var(--surface)',
      borderRight:'1px solid var(--border)',
      display:   'flex',
      flexDirection:'column',
      transition:'width 0.2s ease',
      overflow:  'hidden',
      zIndex:    50,
      flexShrink:0,
    }}>

      {/* ── Logo + collapse ──────────────────────────────────── */}
      <div style={{
        padding:  collapsed ? '20px 0' : '20px',
        borderBottom:'1px solid var(--border)',
        display:  'flex',
        alignItems:'center',
        justifyContent: collapsed ? 'center' : 'space-between',
        minHeight: 64,
        position: 'relative',
      }}>
        {!collapsed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 7,
              background: 'linear-gradient(135deg, #f59e0b, #f97316)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, color: '#000', fontSize: '0.95rem', flexShrink: 0,
            }}>V</div>
            <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>Venture</span>
          </div>
        )}
        {collapsed && (
          <div style={{
            width: 28, height: 28, borderRadius: 7,
            background: 'linear-gradient(135deg, #f59e0b, #f97316)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, color: '#000', fontSize: '0.95rem',
          }}>V</div>
        )}
        {!collapsed && (
          <button
            onClick={() => setCollapsed(true)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-muted)', display: 'flex', borderRadius: 6 }}
            title="Collapse sidebar"
          >
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        )}
        {collapsed && (
          <button
            onClick={() => setCollapsed(false)}
            style={{
              position: 'absolute', top: 20, right: -12,
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: '50%', width: 24, height: 24,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-muted)', boxShadow: 'var(--shadow-sm)', zIndex: 1,
            }}
            title="Expand sidebar"
          >
            <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>

      {/* ── Nav ──────────────────────────────────────────────── */}
      <nav style={{ padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
        {NAV.map(({ href, label, icon }) => {
          const active = pathname === href || (href !== '/' && pathname?.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              style={{
                display:    'flex',
                alignItems: 'center',
                gap:        collapsed ? 0 : 10,
                justifyContent: collapsed ? 'center' : 'flex-start',
                padding:    collapsed ? '10px' : '9px 10px 9px 14px',
                borderRadius: 10,
                color:      active ? 'var(--accent)' : 'var(--text-secondary)',
                background: active ? 'var(--accent-dim)' : 'transparent',
                borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
                textDecoration: 'none',
                fontSize:   '0.875rem',
                fontWeight: active ? 600 : 400,
                transition: 'background 0.15s, color 0.15s, border-color 0.15s',
                whiteSpace: 'nowrap',
                overflow:   'hidden',
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                  e.currentTarget.style.color = 'var(--text-primary)';
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--text-secondary)';
                }
              }}
            >
              <span style={{ flexShrink: 0, opacity: active ? 1 : 0.6 }}>{icon}</span>
              {!collapsed && <span>{label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* ── New Trip CTA ─────────────────────────────────────── */}
      <div style={{ padding: '8px' }}>
        <Link
          href="/trips/new"
          title={collapsed ? 'New Trip' : undefined}
          style={{
            display: 'flex', alignItems: 'center',
            justifyContent: 'center',
            gap: 6, padding: collapsed ? '10px' : '10px 14px',
            background: 'var(--accent)', color: '#000',
            borderRadius: 10, fontWeight: 700, fontSize: '0.85rem',
            textDecoration: 'none', width: '100%',
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--accent-hover)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'var(--accent)'}
        >
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          {!collapsed && 'New Trip'}
        </Link>
      </div>

      {/* ── User ─────────────────────────────────────────────── */}
      <div style={{
        borderTop: '1px solid var(--border)',
        padding:   collapsed ? '14px 0' : '14px 12px',
        display:   'flex',
        alignItems:'center',
        justifyContent: collapsed ? 'center' : 'flex-start',
        gap: 10,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: 'linear-gradient(135deg, #f59e0b, #f97316)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#000', fontSize: '0.72rem', fontWeight: 700, flexShrink: 0,
        }}>
          {user ? <UserInitials email={user.email} /> : '?'}
        </div>
        {!collapsed && user && (
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.email?.split('@')[0]}
            </p>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.email}
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
