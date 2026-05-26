'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import HiddennessDots from './HiddennessDots';

/* ── Data ─────────────────────────────────────────────────────────────────── */
const STATS = [
  { value: '20',   label: 'spots per city'       },
  { value: '50+',  label: 'cities researched'    },
  { value: '1–10', label: 'hiddenness scored'    },
  { value: 'Free', label: 'forever'              },
];

const HOW_STEPS = [
  {
    n: '01',
    icon: (
      <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
    title: 'Pick your city & interests',
    body:  'Tell us where you\'re going and what you love — food, art, nightlife, hidden bars. Multi-city trips supported.',
  },
  {
    n: '02',
    icon: (
      <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
    title: 'AI researches hidden gems',
    body:  'Our AI scans Reddit threads, travel blogs and local sources to surface spots scored by how off-the-beaten-path they actually are.',
  },
  {
    n: '03',
    icon: (
      <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8"  y1="2" x2="8"  y2="6" />
        <line x1="3"  y1="10" x2="21" y2="10" />
      </svg>
    ),
    title: 'Build your day-by-day plan',
    body:  'Browse pins on the map, drag spots into morning / afternoon / evening slots, and check if a city pass is worth buying.',
  },
];

const FEATURED = [
  { city: 'Amsterdam', country: 'Netherlands', code: 'NL', vibes: ['Canals', 'Art'],        g1: '#1a1a2e', g2: '#16213e', spots: 18 },
  { city: 'Lisbon',    country: 'Portugal',    code: 'PT', vibes: ['Fado', 'Tiles'],        g1: '#2d1b69', g2: '#11998e', spots: 20 },
  { city: 'Tokyo',     country: 'Japan',       code: 'JP', vibes: ['Neon', 'Temples'],      g1: '#0f0c29', g2: '#302b63', spots: 22 },
  { city: 'Barcelona', country: 'Spain',       code: 'ES', vibes: ['Architecture', 'Beach'],g1: '#4a00e0', g2: '#8e2de2', spots: 19 },
  { city: 'Prague',    country: 'Czechia',     code: 'CZ', vibes: ['Gothic', 'Beer'],       g1: '#0f2027', g2: '#203a43', spots: 17 },
  { city: 'Porto',     country: 'Portugal',    code: 'PT', vibes: ['Wine', 'River'],        g1: '#c0392b', g2: '#f39c12', spots: 17, isNew: true },
  { city: 'Berlin',    country: 'Germany',     code: 'DE', vibes: ['Techno', 'History'],   g1: '#232526', g2: '#414345', spots: 21 },
  { city: 'Vienna',    country: 'Austria',     code: 'AT', vibes: ['Opera', 'Coffee'],     g1: '#005c97', g2: '#363795', spots: 16 },
];

const TOURIST_SPOTS = [
  { name: 'Sagrada Família', city: 'Barcelona', rating: '4.7', reviews: '2.1M reviews' },
  { name: 'Eiffel Tower',    city: 'Paris',     rating: '4.6', reviews: '1.8M reviews' },
  { name: 'Colosseum',       city: 'Rome',      rating: '4.7', reviews: '847K reviews' },
];
const HIDDEN_SPOTS = [
  { name: 'Begijnhof',          city: 'Amsterdam', score: 8 },
  { name: 'Fado Vadio',         city: 'Lisbon',    score: 9 },
  { name: 'Prater Biergarten',  city: 'Berlin',    score: 7 },
];

const TESTIMONIALS = [
  {
    initials: 'SK', name: 'Sarah K.', location: 'London',
    text: "Found a 200-year-old family wine cellar in Porto that wasn't in any guidebook. Nobody else was there. That's exactly what Venture does.",
  },
  {
    initials: 'JM', name: 'James M.', location: 'New York',
    text: "The hiddenness score is genuinely useful. Anything above 7 has been a complete surprise every time. Worth it for that alone.",
  },
  {
    initials: 'AL', name: 'Anya L.', location: 'Berlin',
    text: "I used to spend days researching before a trip. Venture gave me better spots in 30 seconds than I found in 3 hours of googling.",
  },
];

function flagEmoji(code) {
  if (!code || code.length !== 2) return '🌍';
  return [...code.toUpperCase()].map(c => String.fromCodePoint(0x1F1E6 - 65 + c.charCodeAt(0))).join('');
}

/* ── Particle canvas ──────────────────────────────────────────────────────── */
function ParticleField() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const resize = () => {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();

    const particles = Array.from({ length: 70 }, () => ({
      x:       Math.random() * canvas.width,
      y:       Math.random() * canvas.height,
      r:       Math.random() * 1.2 + 0.3,
      vx:      (Math.random() - 0.5) * 0.12,
      vy:      (Math.random() - 0.5) * 0.12,
      opacity: Math.random() * 0.35 + 0.05,
    }));

    let raf;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width)  p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(245,158,11,${p.opacity})`;
        ctx.fill();
      });
      raf = requestAnimationFrame(draw);
    };
    draw();

    const handleResize = () => resize();
    window.addEventListener('resize', handleResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', handleResize); };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    />
  );
}

/* ── Spot card mockup ─────────────────────────────────────────────────────── */
function SpotCardMockup({ name, city, score, label, price, rotate, animClass }) {
  return (
    <div style={{
      background: '#0f0f1a',
      border:     '1px solid rgba(255,255,255,0.1)',
      borderRadius: 18,
      padding:    '18px 20px',
      width:      264,
      boxShadow:  '0 24px 80px rgba(0,0,0,0.7)',
      transform:  `rotate(${rotate}deg)`,
      animation:  `${animClass} 5s ease-in-out infinite`,
      flexShrink: 0,
      userSelect: 'none',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{
          fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
          color: '#f59e0b', background: 'rgba(245,158,11,0.1)',
          border: '1px solid rgba(245,158,11,0.2)', borderRadius: 20, padding: '2px 8px',
        }}>{label}</span>
        <span style={{ fontSize: '0.72rem', color: '#4a4a6a' }}>{price}</span>
      </div>
      <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f0f0ff', marginBottom: 6 }}>{name}</h3>
      <p style={{ fontSize: '0.75rem', color: '#8888aa', marginBottom: 12, lineHeight: 1.5 }}>
        A spot most tourists walk past without knowing what they're missing.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <HiddennessDots score={score} size={7} showScore />
        <span style={{ fontSize: '0.68rem', color: '#4a4a6a' }}>{city}</span>
      </div>
    </div>
  );
}

/* ── Main ─────────────────────────────────────────────────────────────────── */
export default function LandingPage() {
  const [hoveredCity, setHoveredCity] = useState(null);

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', overflowX: 'hidden', color: 'var(--text-primary)' }}>

      {/* ══════════════════ 1. NAVBAR ══════════════════ */}
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 40px', height: 64,
        position: 'sticky', top: 0, zIndex: 100,
        background: 'rgba(8,8,16,0.85)', backdropFilter: 'blur(20px)',
        borderBottom: '1px solid var(--border)',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: 'linear-gradient(135deg, #f59e0b, #f97316)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, color: '#000', fontSize: '1rem', flexShrink: 0,
          }}>V</div>
          <span style={{ fontWeight: 700, fontSize: '1rem', letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>Venture</span>
        </div>

        {/* Center */}
        <Link href="/explore" style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', fontWeight: 500, display: 'none' }}>
          Explore cities
        </Link>

        {/* Right */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link href="/auth" style={{
            padding: '7px 16px', borderRadius: 10, fontSize: '0.85rem', fontWeight: 500,
            color: 'var(--text-secondary)', border: '1px solid var(--border)',
            background: 'transparent', transition: 'var(--transition)',
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >Sign in</Link>
          <Link href="/auth" style={{
            padding: '7px 18px', borderRadius: 10, fontSize: '0.85rem', fontWeight: 700,
            background: 'var(--accent)', color: '#000',
            transition: 'var(--transition)',
          }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-hover)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--accent)'}
          >Get started</Link>
        </div>
      </nav>

      {/* ══════════════════ 2. HERO ══════════════════ */}
      <section style={{
        minHeight: 'calc(100dvh - 64px)',
        display: 'flex', alignItems: 'center',
        padding: '60px 40px',
        position: 'relative', overflow: 'hidden',
        background: 'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(245,158,11,0.06) 0%, transparent 70%)',
      }}>
        <ParticleField />

        <div style={{
          maxWidth: 1120, margin: '0 auto', width: '100%',
          display: 'flex', alignItems: 'center', gap: 80,
          position: 'relative', zIndex: 1,
        }}>
          {/* Left: text */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 14px', borderRadius: 20,
              background: 'var(--accent-dim)', border: '1px solid rgba(245,158,11,0.25)',
              fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
              color: 'var(--accent)', marginBottom: 28,
            }}>
              ✦ AI-Powered Travel Research
            </div>

            <h1 style={{
              fontSize: 'clamp(2.4rem, 5.5vw, 3.8rem)',
              fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.1,
              marginBottom: 24, color: 'var(--text-primary)',
            }}>
              Find places tourists{' '}
              <span style={{ color: 'var(--accent)', fontStyle: 'italic' }}>never find</span>
            </h1>

            <p style={{
              fontSize: '1.05rem', color: 'var(--text-secondary)', lineHeight: 1.75,
              maxWidth: 480, marginBottom: 40,
            }}>
              AI scans Reddit, travel blogs and local sources to surface hidden gems — scored 1–10 by how off-the-beaten-path they actually are.
            </p>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
              <Link href="/auth" style={{
                padding: '13px 32px', background: 'var(--accent)', color: '#000',
                borderRadius: 10, fontWeight: 700, fontSize: '0.95rem',
                boxShadow: 'var(--shadow-accent)', transition: 'var(--transition)',
              }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-hover)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent)'; e.currentTarget.style.transform = 'translateY(0)'; }}
              >Start planning free →</Link>
              <Link href="/explore" style={{
                padding: '13px 24px', background: 'transparent', color: 'var(--text-secondary)',
                borderRadius: 10, fontWeight: 600, fontSize: '0.9rem',
                border: '1px solid var(--border)', transition: 'var(--transition)',
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
              >Browse cities</Link>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Free to use · No credit card required</p>
          </div>

          {/* Right: animated spot card mockups */}
          <div style={{
            flexShrink: 0, position: 'relative', width: 300, height: 380,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {/* Back card (offset) */}
            <div style={{ position: 'absolute', top: 30, left: 20, opacity: 0.55 }}>
              <SpotCardMockup
                name="LX Factory" city="Lisbon" score={9}
                label="Off the Map" price="Free"
                rotate={-2} animClass="floatAlt"
              />
            </div>
            {/* Front card */}
            <div style={{ position: 'relative', zIndex: 2 }}>
              <SpotCardMockup
                name="Miradouro da Vitória" city="Porto" score={8}
                label="Local Secret" price="Free"
                rotate={3} animClass="float"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════ 3. STATS BAR ══════════════════ */}
      <section style={{
        background: 'var(--surface)',
        borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
        padding: '0',
      }}>
        <div style={{
          maxWidth: 1120, margin: '0 auto',
          display: 'grid', gridTemplateColumns: 'repeat(4,1fr)',
        }}>
          {STATS.map((s, i) => (
            <div key={s.label} style={{
              padding: '32px 24px', textAlign: 'center',
              borderRight: i < 3 ? '1px solid var(--border)' : 'none',
            }}>
              <p style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--accent)', letterSpacing: '-0.03em', marginBottom: 4 }}>{s.value}</p>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ══════════════════ 4. HOW IT WORKS ══════════════════ */}
      <section id="how" style={{ padding: '96px 40px' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 64 }}>
            <p style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>HOW IT WORKS</p>
            <h2 style={{ fontSize: 'clamp(1.8rem,3.5vw,2.4rem)', fontWeight: 800, letterSpacing: '-0.03em' }}>Three steps to hidden gems</h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 40, position: 'relative' }}>
            {/* Connecting line */}
            <div style={{
              position: 'absolute', top: 36, left: 'calc(16.66% + 20px)', right: 'calc(16.66% + 20px)',
              height: 1, background: 'linear-gradient(90deg, var(--border), rgba(245,158,11,0.3), var(--border))',
              zIndex: 0,
            }} />

            {HOW_STEPS.map((step, i) => (
              <div key={step.n} style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
                <div style={{
                  width: 72, height: 72, borderRadius: 18, margin: '0 auto 24px',
                  background: i === 1 ? 'var(--accent)' : 'var(--surface)',
                  border: `1px solid ${i === 1 ? 'transparent' : 'var(--border)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: i === 1 ? '#000' : 'var(--text-secondary)',
                  boxShadow: i === 1 ? 'var(--shadow-accent)' : 'none',
                }}>
                  {step.icon}
                </div>
                <p style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Step {step.n}</p>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 10, letterSpacing: '-0.01em' }}>{step.title}</h3>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════ 5. FEATURED DESTINATIONS ══════════════════ */}
      <section style={{
        padding: '96px 40px',
        background: 'var(--surface)',
        borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <p style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>DESTINATIONS</p>
            <h2 style={{ fontSize: 'clamp(1.8rem,3.5vw,2.4rem)', fontWeight: 800, letterSpacing: '-0.03em' }}>Cities we've researched</h2>
            <p style={{ color: 'var(--text-secondary)', marginTop: 12, fontSize: '0.9rem' }}>Works for any city worldwide — these are just the ones we love most.</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
            {FEATURED.map((c) => (
              <Link
                key={c.city}
                href={`/explore/${c.city.toLowerCase()}`}
                style={{ textDecoration: 'none', display: 'block' }}
                onMouseEnter={() => setHoveredCity(c.city)}
                onMouseLeave={() => setHoveredCity(null)}
              >
                <div style={{
                  borderRadius: 16, overflow: 'hidden',
                  border: '1px solid var(--border)',
                  transition: 'transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
                  transform: hoveredCity === c.city ? 'translateY(-4px)' : 'translateY(0)',
                  borderColor: hoveredCity === c.city ? 'rgba(245,158,11,0.3)' : 'var(--border)',
                  boxShadow: hoveredCity === c.city ? '0 12px 40px rgba(0,0,0,0.5)' : 'none',
                  position: 'relative',
                }}>
                  {/* Gradient banner */}
                  <div style={{
                    height: 100,
                    background: `linear-gradient(135deg, ${c.g1}, ${c.g2})`,
                    position: 'relative', overflow: 'hidden',
                    display: 'flex', alignItems: 'flex-start', padding: '12px 14px',
                  }}>
                    <span style={{ fontSize: '1.6rem', fontWeight: 800, color: 'rgba(255,255,255,0.15)', letterSpacing: '-0.02em', lineHeight: 1 }}>{c.code}</span>
                    {c.isNew && (
                      <span style={{
                        position: 'absolute', top: 10, right: 10,
                        fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.05em',
                        background: 'var(--teal)', color: '#000', borderRadius: 20, padding: '2px 7px',
                      }}>NEW</span>
                    )}
                    {/* Hover overlay */}
                    <div style={{
                      position: 'absolute', inset: 0,
                      background: 'rgba(0,0,0,0.55)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      opacity: hoveredCity === c.city ? 1 : 0,
                      transition: 'opacity 0.2s ease',
                    }}>
                      <span style={{ color: '#fff', fontWeight: 700, fontSize: '0.85rem' }}>Explore →</span>
                    </div>
                  </div>

                  {/* Body */}
                  <div style={{ padding: '14px', background: 'var(--card)' }}>
                    <p style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 2 }}>{c.city}</p>
                    <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 10 }}>{c.country}</p>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {c.vibes.map(v => (
                        <span key={v} style={{
                          fontSize: '0.65rem', padding: '2px 8px', borderRadius: 20,
                          background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
                          color: 'var(--text-muted)',
                        }}>{v}</span>
                      ))}
                      <span style={{
                        fontSize: '0.65rem', padding: '2px 8px', borderRadius: 20,
                        background: 'var(--accent-dim)', border: '1px solid rgba(245,158,11,0.15)',
                        color: 'var(--accent)', marginLeft: 'auto',
                      }}>{c.spots} spots</span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════ 6. HIDDENNESS EXPLAINER ══════════════════ */}
      <section style={{ padding: '96px 40px' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 64 }}>
            <p style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>THE DIFFERENCE</p>
            <h2 style={{ fontSize: 'clamp(1.8rem,3.5vw,2.4rem)', fontWeight: 800, letterSpacing: '-0.03em' }}>Not another tourist list</h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 32, alignItems: 'start' }}>
            {/* Left: tourist */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: 28, opacity: 0.7 }}>
              <p style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 20 }}>🗺️ What every travel app shows</p>
              {TOURIST_SPOTS.map(s => (
                <div key={s.name} style={{
                  padding: '14px 16px', borderRadius: 12, marginBottom: 10,
                  background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div>
                    <p style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{s.name}</p>
                    <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 3 }}>{s.city}</p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>⭐ {s.rating}</p>
                    <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{s.reviews}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* VS divider */}
            <div style={{
              width: 48, height: 48, borderRadius: '50%',
              background: 'var(--surface)', border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, fontSize: '0.75rem', color: 'var(--text-muted)',
              alignSelf: 'center', flexShrink: 0,
            }}>VS</div>

            {/* Right: venture */}
            <div style={{ background: 'var(--surface)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 20, padding: 28 }}>
              <p style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 20 }}>✦ What Venture finds</p>
              {HIDDEN_SPOTS.map(s => (
                <div key={s.name} style={{
                  padding: '14px 16px', borderRadius: 12, marginBottom: 10,
                  background: 'var(--accent-dim)', border: '1px solid rgba(245,158,11,0.15)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div>
                    <p style={{ fontWeight: 600, fontSize: '0.875rem' }}>{s.name}</p>
                    <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 3 }}>{s.city}</p>
                  </div>
                  <HiddennessDots score={s.score} size={7} showScore />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════ 7. TESTIMONIALS ══════════════════ */}
      <section style={{
        padding: '96px 40px',
        background: 'var(--surface)',
        borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <p style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>WHAT PEOPLE SAY</p>
            <h2 style={{ fontSize: 'clamp(1.8rem,3.5vw,2.4rem)', fontWeight: 800, letterSpacing: '-0.03em' }}>Built for curious travellers</h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 24 }}>
            {TESTIMONIALS.map((t, i) => (
              <div key={t.name} style={{
                background: 'var(--card)', border: '1px solid var(--border)',
                borderRadius: 20, padding: 28,
                animation: `fadeUp 0.5s ease both`,
                animationDelay: `${i * 80}ms`,
              }}>
                <p style={{ fontSize: '1.4rem', color: 'var(--accent)', marginBottom: 14, lineHeight: 1 }}>"</p>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.75, marginBottom: 24 }}>{t.text}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 38, height: 38, borderRadius: '50%',
                    background: 'linear-gradient(135deg, var(--accent), #f97316)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: '0.75rem', color: '#000', flexShrink: 0,
                  }}>{t.initials}</div>
                  <div>
                    <p style={{ fontWeight: 600, fontSize: '0.875rem' }}>{t.name}</p>
                    <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{t.location}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════ 8. FINAL CTA ══════════════════ */}
      <section style={{
        padding: '112px 40px',
        textAlign: 'center',
        background: 'linear-gradient(180deg, transparent 0%, rgba(245,158,11,0.04) 50%, transparent 100%)',
        borderTop: '1px solid rgba(245,158,11,0.12)',
      }}>
        <div style={{ maxWidth: 560, margin: '0 auto' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 14px', borderRadius: 20,
            background: 'var(--accent-dim)', border: '1px solid rgba(245,158,11,0.25)',
            fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
            color: 'var(--accent)', marginBottom: 28,
          }}>
            ✦ Free forever
          </div>
          <h2 style={{
            fontSize: 'clamp(2rem,4vw,3rem)', fontWeight: 800,
            letterSpacing: '-0.03em', lineHeight: 1.15, marginBottom: 20,
          }}>
            Ready to find your<br />
            <span style={{ color: 'var(--accent)' }}>hidden gems?</span>
          </h2>
          <p style={{ fontSize: '1rem', color: 'var(--text-secondary)', marginBottom: 36, lineHeight: 1.7 }}>
            Join travellers who've stopped doing the tourist trail.<br />Free to use, no credit card, works for any city on earth.
          </p>
          <Link href="/auth" style={{
            display: 'inline-block',
            padding: '15px 48px', background: 'var(--accent)', color: '#000',
            borderRadius: 12, fontWeight: 800, fontSize: '1rem',
            boxShadow: '0 6px 32px rgba(245,158,11,0.35)', transition: 'var(--transition)',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-hover)'; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 10px 40px rgba(245,158,11,0.45)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent)'; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 6px 32px rgba(245,158,11,0.35)'; }}
          >
            Start planning free →
          </Link>
        </div>
      </section>

      {/* ══════════════════ 9. FOOTER ══════════════════ */}
      <footer style={{
        borderTop: '1px solid var(--border)',
        padding: '32px 40px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16,
        fontSize: '0.78rem', color: 'var(--text-muted)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 24, height: 24, borderRadius: 6,
            background: 'linear-gradient(135deg, #f59e0b, #f97316)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, color: '#000', fontSize: '0.8rem',
          }}>V</div>
          <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Venture</span>
          <span>· Made with ♥ for curious travellers</span>
        </div>
        <div style={{ display: 'flex', gap: 24 }}>
          <Link href="/explore" style={{ color: 'var(--text-muted)', transition: 'color 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-secondary)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
          >Explore</Link>
          <Link href="/auth" style={{ color: 'var(--text-muted)', transition: 'color 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-secondary)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
          >Sign in</Link>
          <span>© 2026</span>
        </div>
      </footer>
    </div>
  );
}
