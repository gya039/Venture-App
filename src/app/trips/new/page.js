'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { createTrip, generateDayPlans } from '@/lib/db';
import TopNav from '@/components/TopNav';
import { useToast } from '@/components/ToastProvider';
import { INTERESTS } from '@/constants/interests';
import { flagEmoji } from '@/utils/flagEmoji';

const emptyDest = (city = '') => ({ city, countryCode: '', startDate: '', endDate: '' });

export default function NewTripPage() {
  const { user, authReady } = useAuth();
  const toast = useToast();

  const [tripName,  setTripName]  = useState('');
  const [isMulti,   setIsMulti]   = useState(false);
  const [dests,     setDests]     = useState([emptyDest()]);
  const [interests, setInterests] = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');

  useEffect(() => {
    const city = new URLSearchParams(window.location.search).get('city');
    if (city) setDests([emptyDest(city)]);
  }, []);

  const addDest    = () => { if (dests.length < 6) setDests([...dests, emptyDest()]); };
  const removeDest = (i) => setDests(dests.filter((_, idx) => idx !== i));
  const updateDest = (i, field, val) => setDests(dests.map((d, idx) => idx === i ? { ...d, [field]: val } : d));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user) { setError('You must be signed in to create a trip.'); return; }
    if (!authReady) { setError('Still verifying your account — please try again in a moment.'); return; }

    const missing = dests.find((d) => !d.city.trim() || !d.startDate || !d.endDate);
    if (missing) { setError('Please fill in city and dates for every destination.'); return; }

    const badDates = dests.find((d) => d.startDate >= d.endDate);
    if (badDates) { setError('End date must be after start date.'); return; }

    setError(''); setLoading(true);
    try {
      const { tripId, destIds } = await createTrip({
        userId: user.uid,
        name: tripName.trim() || null,
        isMultiCity: isMulti,
        interests,
        destinations: dests.map((d) => ({
          city: d.city.trim(),
          countryCode: d.countryCode.trim().toUpperCase().slice(0, 2) || null,
          startDate: d.startDate,
          endDate: d.endDate,
        })),
      });
      await Promise.all(
        dests.map((d, i) => generateDayPlans(destIds[i], user.uid, tripId, d.startDate, d.endDate))
      );
      window.location.href = `/trips/${tripId}`;
    } catch (err) {
      const msg = err.message ?? 'Something went wrong. Please try again.';
      setError(msg);
      toast.error(msg);
      setLoading(false);
    }
  };

  // Summary text
  const citySummary = dests.filter((d) => d.city.trim()).map((d) => d.city.trim()).join(' → ');
  const interestSummary = interests.length > 0
    ? `${interests.length} interest${interests.length !== 1 ? 's' : ''} selected`
    : 'No focus — research all categories';

  return (
    <div style={{ background: 'var(--paper)', minHeight: '100vh' }}>
      <TopNav />

      <div className="nt-wrap">

        {/* ── Header ── */}
        <div className="nt-eyebrow">Plan a new trip</div>
        <h1>Where are you <em>going?</em></h1>
        <p className="nt-sub">Tell us the city and dates — we'll research dozens of hidden gems and build your day plan.</p>

        <form onSubmit={handleSubmit}>

          {/* ── Step 1: Trip type ── */}
          <div className="nt-step">
            <div className="step-head">
              <span className="step-n">01</span>
              <span className="step-t">Trip type</span>
            </div>
            <div className="tt-toggle">
              <button
                type="button"
                className={`tt-opt${!isMulti ? ' on' : ''}`}
                onClick={() => { setIsMulti(false); setDests([dests[0]]); }}
              >
                <div className="tt-ic">📍</div>
                <div className="tt-nm">Single city</div>
                <div className="tt-d">One destination, focused research</div>
              </button>
              <button
                type="button"
                className={`tt-opt${isMulti ? ' on' : ''}`}
                onClick={() => setIsMulti(true)}
              >
                <div className="tt-ic">🗺️</div>
                <div className="tt-nm">Multi-city</div>
                <div className="tt-d">Up to 6 stops, route planning</div>
              </button>
            </div>
          </div>

          {/* ── Step 2: Destinations ── */}
          <div className="nt-step">
            <div className="step-head">
              <span className="step-n">02</span>
              <span className="step-t">{isMulti ? 'Destinations' : 'Destination'}</span>
              {isMulti && <span className="step-hint">{dests.length} / 6 stops</span>}
            </div>

            {/* Optional trip name */}
            <div style={{ marginBottom: 18 }}>
              <span className="fieldlab">Trip name <span style={{ fontFamily: 'var(--sans)', textTransform: 'none', letterSpacing: 0, color: 'var(--faint)' }}>(optional)</span></span>
              <input
                className="nt-input"
                type="text"
                placeholder="e.g. Summer Euro Trip"
                value={tripName}
                onChange={(e) => setTripName(e.target.value)}
              />
            </div>

            <div className="dest-list">
              {dests.map((dest, idx) => (
                <div key={idx} className="dest-card">
                  {isMulti && <div className="dest-idx">{idx + 1}</div>}
                  {isMulti && dests.length > 1 && (
                    <button type="button" className="dest-rm" onClick={() => removeDest(idx)}>×</button>
                  )}
                  <div className="dest-grid">
                    {/* City field */}
                    <div>
                      <span className="fieldlab">City</span>
                      <div className="city-field">
                        <span className="cf-flag">{flagEmoji(dest.countryCode) || '🌍'}</span>
                        <input
                          type="text"
                          placeholder="Amsterdam"
                          value={dest.city}
                          onChange={(e) => updateDest(idx, 'city', e.target.value)}
                          required
                        />
                      </div>
                    </div>
                    {/* Start date */}
                    <div>
                      <span className="fieldlab">Arrive</span>
                      <input
                        className="nt-input"
                        type="date"
                        value={dest.startDate}
                        onChange={(e) => updateDest(idx, 'startDate', e.target.value)}
                        style={{ colorScheme: 'light' }}
                        required
                      />
                    </div>
                    {/* End date */}
                    <div>
                      <span className="fieldlab">Depart</span>
                      <input
                        className="nt-input"
                        type="date"
                        value={dest.endDate}
                        onChange={(e) => updateDest(idx, 'endDate', e.target.value)}
                        style={{ colorScheme: 'light' }}
                        required
                      />
                    </div>
                  </div>
                  {/* Country code (hidden but needed) */}
                  <div style={{ marginTop: 10 }}>
                    <span className="fieldlab">Country code <span style={{ fontFamily: 'var(--sans)', textTransform: 'none', letterSpacing: 0, color: 'var(--faint)' }}>(optional — sets flag)</span></span>
                    <input
                      className="nt-input"
                      type="text"
                      placeholder="NL"
                      value={dest.countryCode}
                      onChange={(e) => updateDest(idx, 'countryCode', e.target.value.slice(0, 2))}
                      maxLength={2}
                      style={{ textTransform: 'uppercase', letterSpacing: '0.1em', maxWidth: 80 }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {isMulti && dests.length < 6 && (
              <button type="button" className="add-dest" onClick={addDest}>
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Add another stop
              </button>
            )}
          </div>

          {/* ── Step 3: Interests ── */}
          <div className="nt-step">
            <div className="step-head">
              <span className="step-n">03</span>
              <span className="step-t">Interests</span>
              <span className="step-hint">optional — biases AI research</span>
            </div>
            <div className="int-grid">
              {INTERESTS.map((interest) => {
                const on = interests.includes(interest.id);
                return (
                  <button
                    key={interest.id}
                    type="button"
                    className={`int-chip${on ? ' on' : ''}`}
                    onClick={() => setInterests((prev) =>
                      prev.includes(interest.id)
                        ? prev.filter((i) => i !== interest.id)
                        : [...prev, interest.id]
                    )}
                  >
                    <span className="ico">{interest.icon}</span>
                    {interest.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Error ── */}
          {error && (
            <div style={{
              marginTop: 24, padding: '12px 16px',
              background: 'color-mix(in oklch, var(--error) 8%, var(--card))',
              border: '1px solid color-mix(in oklch, var(--error) 25%, transparent)',
              borderRadius: 12, color: 'var(--error)', fontSize: 14, lineHeight: 1.5,
            }}>
              {error}
            </div>
          )}

          {/* ── Submit bar ── */}
          <div className="nt-submit">
            <div className="nt-summary">
              {citySummary ? <><b>{citySummary}</b><br /></> : null}
              <span className="mono">{interestSummary}</span>
            </div>
            <button
              type="submit"
              disabled={loading || !authReady}
              className="btn btn-primary btn-lg"
              style={{
                border: 'none', cursor: loading || !authReady ? 'not-allowed' : 'pointer',
                opacity: loading || !authReady ? 0.7 : 1,
              }}
            >
              {loading ? 'Creating trip…' : !authReady ? 'Verifying session…' : 'Create trip →'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}
