// src/lib/__tests__/spotWrites.test.js
import { describe, it, expect } from 'vitest';
import { normaliseName, planSpotWrites } from '../spotWrites.js';

// ---------------------------------------------------------------------------
// normaliseName
// ---------------------------------------------------------------------------

describe('normaliseName', () => {
  it('lowercases and trims', () => {
    expect(normaliseName('  Northern Quarter  ')).toBe('northern quarter');
  });

  it('strips diacritics', () => {
    expect(normaliseName('Café de Flore')).toBe('cafe de flore');
  });

  it('replaces punctuation with spaces', () => {
    expect(normaliseName("L'Olympia")).toBe('l olympia');
  });

  it('collapses multiple spaces', () => {
    expect(normaliseName('Foo   Bar')).toBe('foo bar');
  });

  it('handles null and undefined gracefully', () => {
    expect(normaliseName(null)).toBe('');
    expect(normaliseName(undefined)).toBe('');
    expect(normaliseName('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// planSpotWrites
// ---------------------------------------------------------------------------

describe('planSpotWrites', () => {
  it('all creates when existing is empty', () => {
    const incoming = [
      { name: 'Ancoats Dairy', lat: 53.48, lng: -2.22 },
      { name: 'Afflecks Palace', lat: 53.49, lng: -2.23 },
    ];
    const { updates, creates } = planSpotWrites([], incoming);
    expect(updates).toHaveLength(0);
    expect(creates).toHaveLength(2);
    expect(creates.map((s) => s.name)).toEqual(['Ancoats Dairy', 'Afflecks Palace']);
  });

  it('all updates when every incoming name matches an existing doc', () => {
    const existing = [
      { id: 'id-a', name: 'Northern Quarter' },
      { id: 'id-b', name: 'Salford Quays' },
    ];
    const incoming = [
      { name: 'Northern Quarter', lat: 53.48, lng: -2.23 },
      { name: 'Salford Quays',    lat: 53.47, lng: -2.29 },
    ];
    const { updates, creates } = planSpotWrites(existing, incoming);
    expect(creates).toHaveLength(0);
    expect(updates).toHaveLength(2);
    expect(updates.find((u) => u.id === 'id-a')?.spot.name).toBe('Northern Quarter');
    expect(updates.find((u) => u.id === 'id-b')?.spot.name).toBe('Salford Quays');
  });

  it('splits partial match into updates and creates', () => {
    const existing = [{ id: 'id-a', name: 'Northern Quarter' }];
    const incoming = [
      { name: 'Northern Quarter', lat: 53.48, lng: -2.23 },
      { name: 'Afflecks Palace',  lat: 53.49, lng: -2.24 },
    ];
    const { updates, creates } = planSpotWrites(existing, incoming);
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe('id-a');
    expect(creates).toHaveLength(1);
    expect(creates[0].name).toBe('Afflecks Palace');
  });

  it('existing spots absent from incoming are untouched (not in updates or creates)', () => {
    const existing = [
      { id: 'id-a', name: 'Northern Quarter' },
      { id: 'id-b', name: 'Stale Old Spot' },
    ];
    const incoming = [{ name: 'Northern Quarter', lat: 53.48, lng: -2.23 }];
    const { updates, creates } = planSpotWrites(existing, incoming);
    expect(updates).toHaveLength(1);
    expect(creates).toHaveLength(0);
    // id-b never appears in either list
    const allIds = [...updates.map((u) => u.id)];
    expect(allIds).not.toContain('id-b');
  });

  it('matching is case-insensitive', () => {
    const existing = [{ id: 'id-a', name: 'Northern Quarter' }];
    const incoming = [{ name: 'northern quarter', lat: 53.48, lng: -2.23 }];
    const { updates, creates } = planSpotWrites(existing, incoming);
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe('id-a');
    expect(creates).toHaveLength(0);
  });

  it('matching strips diacritics (Café matches Cafe)', () => {
    const existing = [{ id: 'id-c', name: 'Café de Flore' }];
    const incoming = [{ name: 'Cafe de Flore', lat: 48.85, lng: 2.33 }];
    const { updates, creates } = planSpotWrites(existing, incoming);
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe('id-c');
    expect(creates).toHaveLength(0);
  });

  it('matching trims whitespace', () => {
    const existing = [{ id: 'id-d', name: '  Salford Quays  ' }];
    const incoming = [{ name: 'Salford Quays', lat: 53.47, lng: -2.29 }];
    const { updates, creates } = planSpotWrites(existing, incoming);
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe('id-d');
    expect(creates).toHaveLength(0);
  });

  it('empty incoming returns zero updates and creates', () => {
    const existing = [{ id: 'id-a', name: 'Northern Quarter' }];
    const { updates, creates } = planSpotWrites(existing, []);
    expect(updates).toHaveLength(0);
    expect(creates).toHaveLength(0);
  });
});
