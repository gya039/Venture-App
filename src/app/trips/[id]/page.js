'use client';

import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { getTrip, addSpotToDayPlan, getCityPass, getSpotNotes, setTripPublic, getSpotSaveCounts, saveSpotReview, getSpotReviewAggregates, saveTripAsTemplate } from '@/lib/db';
import { track } from '@/lib/analytics';
import { useDestination } from '@/hooks/useDestination';
import { useDayPlanner } from '@/hooks/useDayPlanner';
import { useSavedSpots } from '@/hooks/useSavedSpots';
import { runResearch, runDeepResearch, runEventsResearch } from '@/lib/functions';
import { isEventsCity } from '@/lib/db';
import SpotCard from '@/components/SpotCard';
import SpotDrawer from '@/components/SpotDrawer';
import CountdownBadge from '@/components/CountdownBadge';
import DayPlanColumn from '@/components/DayPlanColumn';
import DaysBuilder from '@/components/DaysBuilder';
import DayPassCalculator from '@/components/DayPassCalculator';
import MapView from '@/components/MapView';
import ErrorBoundary from '@/components/ErrorBoundary';
import TopNav from '@/components/TopNav';
import { useToast } from '@/components/ToastProvider';
import { INTERESTS } from '@/constants/interests';
import { getHiddennessLevel } from '@/constants/hiddenness';
import { flagEmoji } from '@/utils/flagEmoji';

/* ── Score options (shared between filter bar and filteredSpots) ─────────── */
const SCORE_OPTS = [
  { label: 'All scores',       min: 0 },
  { label: '5+ Local Secret',  min: 5 },
  { label: '7+ Off the Radar', min: 7 },
  { label: '9+ Ultra Hidden',  min: 9 },
];

/* ── Helpers ──────────────────────────────────────────────────────────────── */
function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short',
  });
}


/* ── Step progress bar ────────────────────────────────────────────────────── */
const STEPS = ['Research', 'Days', 'Pass'];

function StepProgress({ activeTab, setActiveTab }) {
  const activeIdx = STEPS.indexOf(activeTab);
  return (
    <div className="step-progress">
      {STEPS.map((step, i) => {
        const isDone   = i < activeIdx;
        const isActive = step === activeTab;
        return (
          <Fragment key={step}>
            {i > 0 && (
              <div className={`step-divider${isDone ? ' done' : ''}`} />
            )}
            <button
              type="button"
              onClick={() => setActiveTab(step)}
              className={`step-progress-btn${isActive ? ' active' : isDone ? ' done' : ''}`}
            >
              <span className="step-num">
                {isDone ? '✓' : i + 1}
              </span>
              <span className="step-label">{step}</span>
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

/* ── Saved spot mini-row (Days sidebar) ───────────────────────────────────── */
function SavedSpotRow({ spot, onAdd, added, adding }) {
  const level = getHiddennessLevel(spot?.hiddennessScore ?? 1);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 10px', borderRadius: 8,
      background: added ? 'color-mix(in oklch, var(--olive) 8%, var(--card))' : 'var(--bg)',
      border: `1px solid ${added ? 'color-mix(in oklch, var(--olive) 30%, transparent)' : 'var(--border)'}`,
      marginBottom: 5, transition: 'all 0.15s',
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: level.color, flexShrink: 0,
        boxShadow: `0 0 4px ${level.color}60`,
      }} />
      <span style={{
        flex: 1, fontSize: '0.78rem', fontWeight: 500,
        color: 'var(--text-primary)', overflow: 'hidden',
        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{spot.name}</span>
      <button
        type="button"
        onClick={() => onAdd(spot)}
        disabled={adding || added}
        style={{
          padding: '3px 8px', borderRadius: 6, flexShrink: 0,
          background: added ? 'transparent' : 'var(--accent)',
          border: added ? '1px solid color-mix(in oklch, var(--olive) 35%, transparent)' : 'none',
          color: added ? 'var(--green)' : '#000',
          fontSize: '0.68rem', fontWeight: 700,
          cursor: added || adding ? 'default' : 'pointer',
          transition: 'all 0.15s',
        }}
      >
        {added ? '✓' : adding ? '…' : '+'}
      </button>
    </div>
  );
}

/* ── Main ─────────────────────────────────────────────────────────────────── */
export default function TripDetailPage() {
  const { id: tripId }      = useParams();
  const { user, authReady } = useAuth();
  const toast = useToast();
  const { savedIds, toggle: toggleSave } = useSavedSpots(user?.uid);

  const [trip,          setTrip]         = useState(null);
  const [tripLoading,   setTripLoading]  = useState(true);
  const [tripError,     setTripError]    = useState(null);
  const [selectedIdx,   setSelectedIdx]  = useState(0);

  // Reset destination index when switching between trips
  useEffect(() => { setSelectedIdx(0); }, [tripId]);

  const [activeTab,      setActiveTab]     = useState('Research');
  const [filterInterests, setFilterInterests] = useState(new Set()); // multi-select category IDs
  const [minScoreFilter,  setMinScoreFilter]  = useState(0);   // 0 = all scores
  const [searchQuery,     setSearchQuery]     = useState('');
  const [isResearching,  setIsResearching] = useState(false);
  const [researchError,  setResearchError] = useState(null);
  const [streamingSpots, setStreamingSpots]= useState([]);
  const [researchStatus, setResearchStatus]= useState('');

  // Mobile view toggle for Research tab
  const [mobileView, setMobileView] = useState('list'); // 'list' | 'map'

  // Lazy-load map state (effects wired up after spots/selectedDest are in scope)
  const [mapMounted,     setMapMounted]     = useState(false);
  const [mapFitRevision, setMapFitRevision] = useState(0);

  // Selected spot (drives map focus + inline expansion)
  const [selectedSpotId, setSelectedSpotId] = useState(null);

  // Add-to-day state
  const [addSpotModal,  setAddSpotModal] = useState(null);
  const [addSpotSlot,   setAddSpotSlot]  = useState('morning');
  const [spotSearch,    setSpotSearch]   = useState('');
  const [addingSpot,    setAddingSpot]   = useState(null);
  const [addedSpots,    setAddedSpots]   = useState(new Set());

  // Sidebar quick-add state (Days tab)
  const [sidebarAdding, setSidebarAdding] = useState(null);  // spotId being added
  const [sidebarAdded,  setSidebarAdded]  = useState(new Set()); // spotIds added

  // Pass tab city pass data
  const [cityPass, setCityPass] = useState(null);

  // Spot drawer
  const [drawerSpot, setDrawerSpot] = useState(null);

  // pinPixel removed — popup is now a native mapboxgl.Popup inside MapView

  // Quick-add to day popover (from Research tab "+ Day" button)
  const [quickAddSpot, setQuickAddSpot] = useState(null); // spot object
  const [quickAddDay,  setQuickAddDay]  = useState('');
  const [quickAddSlot, setQuickAddSlot] = useState('morning');
  const [quickAdding,  setQuickAdding]  = useState(false);
  const [quickAdded,   setQuickAdded]   = useState(new Set()); // spotIds added via quick-add

  // Spot notes map { spotId: { note, visited } }
  const [spotNotes, setSpotNotes] = useState({});

  // Share state
  const [sharing, setSharing] = useState(false);

  // Keyboard shortcut help modal
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Spot reviews { spotId: { avgRating, count } }
  const [reviewAggregates, setReviewAggregates] = useState({});
  // User's submitted ratings { spotId: 1-5 }
  const [userRatings, setUserRatings] = useState({});

  // Research sub-tab: 'spots' | 'discover'
  const [researchSubTab, setResearchSubTab] = useState('spots');
  // Most recently streamed spot id — drives reveal/justFound animation on SpotCard
  const [justFoundId, setJustFoundId] = useState(null);
  // Discover: spot save counts { spotId: count }
  const [saveCounts, setSaveCounts] = useState({});
  const [saveCountsLoading, setSaveCountsLoading] = useState(false);
  // Confirm dialog before force-refresh
  const [refreshConfirmVisible, setRefreshConfirmVisible] = useState(false);

  // Filter bar dropdown + starred state
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const [scoreDropdownOpen,    setScoreDropdownOpen]    = useState(false);
  const [starredOnly,          setStarredOnly]          = useState(false);

  // Recurring events (Phase 3 — Glasgow only)
  const [cityEvents,       setCityEvents]        = useState([]);

  // Deep browse lens (Phase 2B)
  const [deepInterestId,   setDeepInterestId]   = useState(null);   // null = curated mode
  const [deepSpots,        setDeepSpots]        = useState([]);
  const [deepStreaming,    setDeepStreaming]     = useState([]);
  const [deepLoading,      setDeepLoading]      = useState(false);
  const [deepError,        setDeepError]        = useState(null);

  /* ── Load trip ──────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!tripId || !authReady) return;
    getTrip(tripId)
      .then((t) => { setTrip(t); if (!t) setTripError('Trip not found.'); })
      .catch((err) => setTripError(err.message))
      .finally(() => setTripLoading(false));
  }, [tripId, authReady]);

  /* ── Destination + spots ────────────────────────────────────────────────── */
  const selectedDest = trip?.destinations?.[selectedIdx] ?? null;
  const { spots, loading: spotsLoading, refetch }       = useDestination(selectedDest?.id);
  const { days,  loading: daysLoading,  refetch: refetchDays } = useDayPlanner(selectedDest?.id, selectedDest?.city);

  // Past trip detection (needs selectedDest)
  const isPastTrip = selectedDest?.endDate
    ? new Date(selectedDest.endDate + 'T00:00:00') < new Date()
    : false;

  // Lazy-load map effects (need spots + mobileView — must come after hook calls)
  useEffect(() => {
    if (mobileView === 'map') {
      setMapMounted(true);
      // Dispatch a resize event after the CSS transition so Mapbox recalculates bounds
      setTimeout(() => window.dispatchEvent(new Event('resize')), 150);
    }
  }, [mobileView]);
  useEffect(() => { if (spots.length >= 5) setMapMounted(true); }, [spots.length]); // eslint-disable-line

  /* ── Load city pass data when Pass tab selected ─────────────────────────── */
  useEffect(() => {
    if (activeTab !== 'Pass' || !selectedDest?.city) return;
    getCityPass(selectedDest.city).then(setCityPass).catch(() => setCityPass(null));
  }, [activeTab, selectedDest?.city]);

  /* ── Load recurring events when Days tab opens (Glasgow only) ───────────── */
  useEffect(() => {
    if (activeTab !== 'Days' || !selectedDest?.city) return;
    if (!isEventsCity(selectedDest.city)) return;
    runEventsResearch(selectedDest.city, false, {
      onEvent:    (ev) => setCityEvents((prev) => [...prev, ev]),
      onSummary:  (s)  => { if (!s.fromCache) toast.info?.(`${s.geocoded} recurring events loaded for ${selectedDest.city}`); },
    }).catch(() => {});
  }, [activeTab, selectedDest?.city]); // eslint-disable-line

  /* ── Load spot notes ─────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!user?.uid) return;
    getSpotNotes(user.uid).then(setSpotNotes).catch(() => {});
  }, [user?.uid]);

  /* ── Load review aggregates for past trips ───────────────────────────────── */
  useEffect(() => {
    if (!isPastTrip || spots.length === 0) return;
    getSpotReviewAggregates(spots.map((s) => s.id))
      .then(setReviewAggregates)
      .catch(() => {});
  }, [isPastTrip, spots.length]); // eslint-disable-line

  /* ── Auto-clear justFoundId after badge animation ───────────────────────── */
  useEffect(() => {
    if (!justFoundId) return;
    const t = setTimeout(() => setJustFoundId(null), 2400);
    return () => clearTimeout(t);
  }, [justFoundId]);

  /* ── Load save counts for Discover tab ──────────────────────────────────── */
  useEffect(() => {
    if (researchSubTab !== 'discover' || !selectedDest?.city) return;
    setSaveCountsLoading(true);
    getSpotSaveCounts(selectedDest.city)
      .then(setSaveCounts)
      .catch(() => setSaveCounts({}))
      .finally(() => setSaveCountsLoading(false));
  }, [researchSubTab, selectedDest?.city]);

  /* ── Set default day for quick-add when days load ────────────────────────── */
  useEffect(() => {
    if (days.length > 0 && !quickAddDay) setQuickAddDay(days[0]?.id ?? '');
  }, [days, quickAddDay]);

  // filteredSpots must be declared BEFORE the keyboard useEffect that references it
  // (useMemo deps are evaluated synchronously — referencing a const before its declaration = TDZ error)
  const filteredSpots = useMemo(() => {
    let s = filterInterests.size > 0
      ? spots.filter((sp) => (sp.interests ?? []).some(i => filterInterests.has(i)))
      : spots;
    if (minScoreFilter > 0) {
      s = s.filter((sp) => (sp.hiddennessScore ?? 1) >= minScoreFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      s = s.filter((sp) =>
        sp.name?.toLowerCase().includes(q) ||
        sp.description?.toLowerCase().includes(q) ||
        sp.category?.toLowerCase().includes(q)
      );
    }
    if (starredOnly) {
      s = s.filter((sp) => savedIds.has(sp.id));
    }
    // Default: highest score first
    return [...s].sort((a, b) => (b.hiddennessScore ?? 1) - (a.hiddennessScore ?? 1));
  }, [spots, filterInterests, minScoreFilter, searchQuery, starredOnly, savedIds]);

  /* ── Keyboard navigation ────────────────────────────────────────────────── */
  useEffect(() => {
    function onKey(e) {
      // Don't intercept when typing in inputs/textareas
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

      // ? — show shortcuts modal
      if (e.key === '?' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        setShowShortcuts((v) => !v);
        return;
      }
      // Escape — close open overlays
      if (e.key === 'Escape') {
        if (showShortcuts)  { setShowShortcuts(false); return; }
        if (drawerSpot)     { setDrawerSpot(null); return; }
        if (quickAddSpot)   { setQuickAddSpot(null); return; }
        if (addSpotModal)   { setAddSpotModal(null); return; }
        if (selectedSpotId) { setSelectedSpotId(null); return; }
        return;
      }
      // Research tab: arrow keys navigate spots list
      if (activeTab === 'Research' && researchSubTab === 'spots') {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const idx = filteredSpots.findIndex((s) => s.id === selectedSpotId);
          let next;
          if (e.key === 'ArrowDown') next = idx < filteredSpots.length - 1 ? idx + 1 : 0;
          else next = idx > 0 ? idx - 1 : filteredSpots.length - 1;
          setSelectedSpotId(filteredSpots[next]?.id ?? null);
          return;
        }
        // Enter — open drawer for selected spot
        if (e.key === 'Enter' && selectedSpotId) {
          const spot = filteredSpots.find((s) => s.id === selectedSpotId);
          if (spot) setDrawerSpot(spot);
          return;
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTab, researchSubTab, filteredSpots, selectedSpotId, drawerSpot, quickAddSpot, addSpotModal, showShortcuts]); // eslint-disable-line

  /* ── Research ───────────────────────────────────────────────────────────── */
  const triggerResearch = useCallback(async (force = false) => {
    if (!selectedDest) return;
    setIsResearching(true);
    setResearchError(null);
    setStreamingSpots([]);
    setResearchStatus('');
    let spotCount = 0;
    try {
      await runResearch(
        selectedDest.city,
        trip?.interests ?? [],
        selectedDest.id,
        force,
        {
          onSpot:    (spot) => { setStreamingSpots((prev) => [...prev, spot]); setJustFoundId(spot.id ?? spot.name); spotCount++; },
          onStatus:  (msg)  => setResearchStatus(msg),
          onSummary: (s)    => toast.info?.(
            `${s.geocoded} spots mapped` +
            (s.qualityDropped > 0 ? ` · ${s.qualityDropped} quality-filtered` : '') +
            (s.dropped > 0 ? ` · ${s.dropped} ungeocodeable` : '')
          ),
        },
      );
      await refetch();
      setMapFitRevision((v) => v + 1); // force map to re-fit to the full geocoded set
      track('research_completed', { city: selectedDest?.city, spotCount });
    } catch (err) {
      console.error('Research error:', err);
      const msg = err.message ?? 'Research failed. Please try again.';
      setResearchError(msg);
      toast.error(msg);
    } finally {
      setIsResearching(false);
      setStreamingSpots([]);
      setResearchStatus('');
    }
  }, [selectedDest, trip, refetch]);

  useEffect(() => {
    if (spotsLoading || isResearching || researchError) return;
    if (!selectedDest) return;
    if (spots.length > 0) return;
    triggerResearch();
  }, [selectedDest?.id, spots.length, spotsLoading, isResearching]); // eslint-disable-line

  /* ── Deep browse research ───────────────────────────────────────────────── */
  const triggerDeepResearch = useCallback(async (interestId) => {
    const interest = INTERESTS.find((i) => i.id === interestId);
    if (!interest || !selectedDest?.city) return;
    setDeepInterestId(interestId);
    setDeepLoading(true);
    setDeepError(null);
    setDeepStreaming([]);
    setDeepSpots([]);
    try {
      const { spots: result } = await runDeepResearch(
        selectedDest.city,
        interest.label,
        false,
        {
          onSpot:    (s)   => setDeepStreaming((prev) => [...prev, s]),
          onStatus:  (msg) => setResearchStatus(msg),
          onSummary: (s)   => toast.info?.(`${s.fromCache ? 'Loaded' : 'Found'} ${s.geocoded} ${interest.label} spots`),
        },
      );
      setDeepSpots(result);
      setDeepStreaming([]);
    } catch (err) {
      setDeepError(err.message);
      toast.error(err.message);
    } finally {
      setDeepLoading(false);
      setResearchStatus('');
    }
  }, [selectedDest?.city, toast]); // eslint-disable-line

  // (pin pixel state removed — popup handled inside MapView)

  // Reset filter + selection + streaming state on dest change
  useEffect(() => {
    setFilterInterests(new Set());
    setMinScoreFilter(0);
    setSearchQuery('');
    setSelectedSpotId(null);
    setStreamingSpots([]);
    setResearchStatus('');
    setMobileView('list');
    setSidebarAdded(new Set());
    setQuickAddDay('');   // prevent stale day ID from previous destination
    setMapMounted(false); // re-lazy-load map for new destination
    setResearchSubTab('spots');
    setSaveCounts({});
    setStarredOnly(false);
    setCategoryDropdownOpen(false);
    setScoreDropdownOpen(false);
    setDeepInterestId(null);
    setDeepSpots([]);
    setDeepStreaming([]);
    setDeepError(null);
    setCityEvents([]);
  }, [selectedDest?.id]);

  /* ── Derived ────────────────────────────────────────────────────────────── */
  // filteredSpots is declared earlier (before the keyboard useEffect) to avoid TDZ crash

  const presentInterests = useMemo(
    () => INTERESTS.filter((i) => spots.some((s) => (s.interests ?? []).includes(i.id))),
    [spots]
  );

  const selectedSpot = spots.find(s => s.id === selectedSpotId) ?? null;

  const visitedIds = useMemo(
    () => new Set(Object.keys(spotNotes).filter((id) => spotNotes[id]?.visited)),
    [spotNotes]
  );

  // Saved spots for current destination (for Days sidebar)
  const savedSpots = useMemo(
    () => spots.filter((s) => savedIds.has(s.id)),
    [spots, savedIds]
  );

  // First day plan for sidebar quick-add
  const firstDayPlanId = days[0]?.id ?? null;

  const handleSpotClick = useCallback(
    (spot) => setSelectedSpotId(spot.id),
    []
  );

  /* ── Sidebar quick-add to first day ─────────────────────────────────────── */
  const handleSidebarAdd = useCallback(async (spot) => {
    if (!firstDayPlanId || !spot?.id) return;
    setSidebarAdding(spot.id);
    try {
      await addSpotToDayPlan(firstDayPlanId, spot.id, spot.city, 'morning');
      setSidebarAdded((prev) => new Set([...prev, spot.id]));
      refetchDays();
      toast.success(`${spot.name} added to Day 1`);
    } catch (err) { console.error(err); }
    finally { setSidebarAdding(null); }
  }, [firstDayPlanId, refetchDays, toast]);

  /* ── Quick-add from Research tab "+ Day" button ──────────────────────────── */
  const confirmQuickAdd = useCallback(async () => {
    if (!quickAddSpot || !quickAddDay || quickAdding) return;
    setQuickAdding(true);
    try {
      await addSpotToDayPlan(quickAddDay, quickAddSpot.id, quickAddSpot.city ?? selectedDest?.city, quickAddSlot);
      setQuickAdded((prev) => new Set([...prev, quickAddSpot.id]));
      refetchDays();
      track('spot_added_to_day', { spotId: quickAddSpot.id, city: quickAddSpot.city ?? selectedDest?.city, slot: quickAddSlot });
      toast.success(`${quickAddSpot.name} added to day plan`);
      setQuickAddSpot(null);
    } catch (err) { console.error(err); toast.error('Failed to add spot'); }
    finally { setQuickAdding(false); }
  }, [quickAddSpot, quickAddDay, quickAddSlot, quickAdding, selectedDest, refetchDays, toast]);

  /* ── Add to day from drawer ──────────────────────────────────────────────── */
  const handleDrawerAddToDay = useCallback(async (dayPlanId, spot, slot) => {
    await addSpotToDayPlan(dayPlanId, spot.id, spot.city ?? selectedDest?.city, slot);
    refetchDays();
    toast.success(`${spot.name} added to day plan`);
  }, [selectedDest, refetchDays, toast]);

  /* ── Loading / error shell ──────────────────────────────────────────────── */
  if (tripLoading || !authReady) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>
        <TopNav />
        {/* Trip page skeleton — mirrors the actual header + list layout */}
        <div style={{ flexShrink: 0, padding: '14px 28px 0', borderBottom: '1px solid var(--border)' }}>
          {/* Breadcrumb */}
          <div style={{ width: 48, height: 12, borderRadius: 4, marginBottom: 14 }} className="skeleton" />
          {/* Title + date */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ width: 180, height: 20, borderRadius: 4 }} className="skeleton" />
            <div style={{ width: 80, height: 14, borderRadius: 4 }} className="skeleton" />
          </div>
          {/* Step progress */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 12 }}>
            {[80, 6, 70, 6, 60].map((w, i) => (
              <div key={i} style={{ width: w, height: i % 2 === 1 ? 1 : 16, borderRadius: 4, background: i % 2 === 1 ? 'var(--border)' : undefined }} className={i % 2 === 0 ? 'skeleton' : ''} />
            ))}
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
          {/* List panel skeleton */}
          <div style={{ width: 'clamp(300px, 36vw, 440px)', flexShrink: 0, borderRight: '1px solid var(--border)', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ height: 36, borderRadius: 8 }} className="skeleton" />
            <div style={{ height: 28, width: '60%', borderRadius: 20 }} className="skeleton" />
            {[90, 76, 76, 76, 76, 76].map((h, i) => (
              <div key={i} style={{ height: h, borderRadius: 8, animationDelay: `${i * 0.08}s` }} className="skeleton" />
            ))}
          </div>
          {/* Map panel skeleton */}
          <div style={{ flex: 1, background: '#0a0a0a' }} />
        </div>
      </div>
    );
  }

  if (tripError || !trip) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>
        <TopNav />
        <div style={{ flex: 1, padding: '40px 48px', overflowY: 'auto' }}>
          <p style={{ color: 'var(--text-muted)' }}>{tripError ?? 'Trip not found.'}</p>
          <Link href="/" style={{ color: 'var(--accent)', fontSize: '0.85rem', marginTop: 12, display: 'inline-block' }}>← Back to trips</Link>
        </div>
      </div>
    );
  }

  /* ── Header info ────────────────────────────────────────────────────────── */
  const firstDest = trip.destinations[0];
  const lastDest  = trip.destinations[trip.destinations.length - 1];
  const headerTitle = trip.name
    ?? (trip.isMultiCity
        ? trip.destinations.map((d) => d.city).join(' · ')
        : `${flagEmoji(firstDest?.countryCode)} ${firstDest?.city}`);
  const dateRange = `${fmtDate(firstDest?.startDate)} – ${fmtDate(lastDest?.endDate)}`;

  /* ── Render ─────────────────────────────────────────────────────────────── */
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>
      <TopNav />

      {/* ── Content below nav ───────────────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>

        {/* ── Command bar ─────────────────────────────────────────────────── */}
        <header className="trip-cmd-bar">

          {/* Back arrow */}
          <Link href="/" className="backbtn" title="All trips">←</Link>

          {/* Trip name + dates */}
          <div className="trip-id" style={{ minWidth: 0, flex: 1 }}>
            <span className="flag" style={{ fontSize: 22 }}>{flagEmoji(firstDest?.countryCode)}</span>
            <span className="nm">{trip.name ?? (trip.isMultiCity ? trip.destinations.map((d) => d.city).join(' · ') : firstDest?.city)}</span>
            <span className="dates trip-cmd-dates">{dateRange}</span>
          </div>

          {/* Segmented tab switcher */}
          <nav className="trip-cmd-seg">
            {STEPS.map((step) => (
              <button
                key={step}
                type="button"
                className={activeTab === step ? 'active' : ''}
                onClick={() => setActiveTab(step)}
              >
                {step === 'Research' && <span className="tdot" />}
                {step}
              </button>
            ))}
          </nav>

          {/* Refresh — only in Research tab when spots exist */}
          {activeTab === 'Research' && spots.length > 0 && !isResearching && (
            <button
              type="button"
              onClick={() => setRefreshConfirmVisible(true)}
              style={{
                flexShrink: 0, padding: '5px 12px', borderRadius: 7,
                background: 'transparent', border: '1px solid var(--line-strong)',
                color: 'var(--muted)', fontSize: '0.75rem', fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--terracotta)'; e.currentTarget.style.color = 'var(--terracotta)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line-strong)'; e.currentTarget.style.color = 'var(--muted)'; }}
              title="Re-run research for this city"
            >
              ↻ Refresh
            </button>
          )}

          {/* Countdown + share */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <span className="countdown">
              <span className="planet" />
              <CountdownBadge date={firstDest?.startDate} />
            </span>
            <div style={{ width: 1, height: 26, background: 'var(--line)' }} />
            <button
              type="button"
              className="sharebtn"
              disabled={sharing}
              onClick={async () => {
                if (sharing || !tripId) return;
                setSharing(true);
                try {
                  await setTripPublic(tripId, user?.uid);
                  track('itinerary_shared', { tripId });
                  window.open(`/trips/${tripId}/share`, '_blank', 'noopener,noreferrer');
                } catch (err) {
                  console.error('[Share] error:', err);
                  toast.error?.('Could not generate share link');
                } finally {
                  setSharing(false);
                }
              }}
              title="Share read-only itinerary"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/>
                <path d="M8.3 10.7l7.4-4.4M8.3 13.3l7.4 4.4"/>
              </svg>
              {sharing ? '…' : 'Share'}
            </button>
          </div>
        </header>

        {/* Multi-city destination strip */}
        {trip.isMultiCity && trip.destinations.length > 1 && (
          <div style={{
            flexShrink: 0, display: 'flex', gap: 6, padding: '0 20px',
            height: 40, alignItems: 'center',
            borderBottom: '1px solid var(--border)', background: 'var(--bg)',
            overflowX: 'auto',
          }}>
            {trip.destinations.map((dest, idx) => (
              <button
                key={dest.id}
                type="button"
                onClick={() => setSelectedIdx(idx)}
                style={{
                  padding: '3px 10px', borderRadius: 8, flexShrink: 0,
                  border: `1px solid ${selectedIdx === idx ? 'var(--accent)' : 'var(--border)'}`,
                  background: selectedIdx === idx ? 'var(--accent-dim)' : 'transparent',
                  color: selectedIdx === idx ? 'var(--accent)' : 'var(--text-secondary)',
                  fontWeight: selectedIdx === idx ? 600 : 400,
                  fontSize: '0.78rem', cursor: 'pointer', whiteSpace: 'nowrap',
                  transition: 'all 0.15s',
                }}
              >
                {flagEmoji(dest.countryCode)} {dest.city}
              </button>
            ))}
          </div>
        )}

        {/* ── Tab content ─────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', minHeight: 0 }}>

          {/* ════════════════ RESEARCH ════════════════ */}
          {activeTab === 'Research' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>


              {/* Mobile view toggle — only for Spots sub-tab */}
              {researchSubTab === 'spots' && (
                <div
                  className="mobile-view-toggle"
                  style={{
                    borderBottom: '1px solid var(--border)',
                    padding: '8px 16px',
                    gap: 8,
                    background: 'var(--bg)',
                    flexShrink: 0,
                  }}
                >
                  {['list', 'map'].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setMobileView(v)}
                      style={{
                        flex: 1, padding: '8px', borderRadius: 8,
                        border: `1px solid ${mobileView === v ? 'var(--accent)' : 'var(--border)'}`,
                        background: mobileView === v ? 'var(--accent-dim)' : 'transparent',
                        color: mobileView === v ? 'var(--accent)' : 'var(--text-muted)',
                        fontWeight: mobileView === v ? 600 : 400,
                        fontSize: '0.82rem', cursor: 'pointer', transition: 'all 0.15s',
                      }}
                    >
                      {v === 'list' ? '☰ List' : '🗺 Map'}
                    </button>
                  ))}
                </div>
              )}

              {/* Past trip visited summary banner */}
              {isPastTrip && !isResearching && spots.length > 0 && (() => {
                const visitedSpots = spots.filter((s) => spotNotes[s.id]?.visited);
                const hiddenVisited = visitedSpots.filter((s) => (s.hiddennessScore ?? 1) >= 6);
                const visitedPct = Math.round((visitedSpots.length / spots.length) * 100);
                if (visitedSpots.length === 0) {
                  return (
                    <div style={{
                      flexShrink: 0, padding: '10px 16px',
                      background: 'color-mix(in oklch, var(--terracotta) 7%, var(--paper))',
                      borderBottom: '1px solid color-mix(in oklch, var(--terracotta) 22%, transparent)',
                      display: 'flex', alignItems: 'center', gap: 10,
                    }}>
                      <span style={{ fontSize: '0.8rem' }}>✈️</span>
                      <p style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        You visited <strong style={{ color: 'var(--text-primary)' }}>{selectedDest?.city}</strong>! Mark spots you visited with <strong>✓ Visited</strong> in spot details to see your summary.
                      </p>
                    </div>
                  );
                }
                return (
                  <div style={{
                    flexShrink: 0, padding: '10px 16px',
                    background: 'color-mix(in oklch, var(--olive) 6%, var(--card))',
                    borderBottom: '1px solid color-mix(in oklch, var(--olive) 20%, transparent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: '0.85rem' }}>🏅</span>
                      <p style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        You visited <strong style={{ color: 'var(--green)' }}>{visitedSpots.length} spot{visitedSpots.length !== 1 ? 's' : ''}</strong> in {selectedDest?.city}
                        {hiddenVisited.length > 0 && (
                          <> · <strong style={{ color: '#f59e0b' }}>{hiddenVisited.length} hidden gem{hiddenVisited.length !== 1 ? 's' : ''}</strong></>
                        )}
                      </p>
                    </div>
                    <span style={{
                      fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                      background: 'color-mix(in oklch, var(--olive) 14%, var(--card))', color: 'var(--green)',
                      border: '1px solid color-mix(in oklch, var(--olive) 30%, transparent)', flexShrink: 0,
                    }}>
                      {visitedPct}% explored
                    </span>
                  </div>
                );
              })()}

              {/* ── Filter bar — spots mode only ── */}
              {researchSubTab === 'spots' && (
                <>
                  {/* Transparent backdrop — closes open dropdowns */}
                  {(categoryDropdownOpen || scoreDropdownOpen) && (
                    <div
                      style={{ position: 'fixed', inset: 0, zIndex: 40 }}
                      onClick={() => { setCategoryDropdownOpen(false); setScoreDropdownOpen(false); }}
                    />
                  )}
                  <div className="filter-bar">
                    {/* Search */}
                    <div className="fb-search">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3" strokeLinecap="round"/>
                      </svg>
                      <input
                        type="text"
                        placeholder="Search spots…"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                      {searchQuery && (
                        <button type="button" onClick={() => setSearchQuery('')}
                          style={{ background: 'none', border: 'none', color: 'var(--faint)', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: 0, flexShrink: 0 }}>×</button>
                      )}
                    </div>

                    {/* Categories dropdown */}
                    <div className="fb-dropdown">
                      <button
                        type="button"
                        className={`fb-btn${filterInterests.size > 0 ? ' active' : ''}`}
                        onClick={() => { setCategoryDropdownOpen(v => !v); setScoreDropdownOpen(false); }}
                      >
                        {filterInterests.size > 0 ? `Categories · ${filterInterests.size}` : 'Categories'}
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 9l6 6 6-6"/></svg>
                      </button>
                      {categoryDropdownOpen && (
                        <div className="fb-dropdown-panel">
                          <button type="button" className={'chip' + (filterInterests.size === 0 ? ' on' : '')} onClick={() => setFilterInterests(new Set())}>All</button>
                          {presentInterests.map((i) => (
                            <button key={i.id} type="button" className={'chip' + (filterInterests.has(i.id) ? ' on' : '')}
                              onClick={() => setFilterInterests(prev => { const next = new Set(prev); if (next.has(i.id)) next.delete(i.id); else next.add(i.id); return next; })}
                            >{i.icon} {i.label}</button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Score dropdown */}
                    <div className="fb-dropdown">
                      <button
                        type="button"
                        className={`fb-btn${minScoreFilter > 0 ? ' active' : ''}`}
                        onClick={() => { setScoreDropdownOpen(v => !v); setCategoryDropdownOpen(false); }}
                      >
                        {SCORE_OPTS.find(o => o.min === minScoreFilter)?.label ?? 'All scores'}
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 9l6 6 6-6"/></svg>
                      </button>
                      {scoreDropdownOpen && (
                        <div className="fb-score-panel">
                          {SCORE_OPTS.map(({ label, min }) => (
                            <button key={min} type="button"
                              className={'fb-score-opt' + (minScoreFilter === min ? ' active' : '')}
                              onClick={() => { setMinScoreFilter(min); setScoreDropdownOpen(false); }}
                            >{label}</button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Starred only toggle */}
                    <button
                      type="button"
                      className={`fb-toggle${starredOnly ? ' on' : ''}`}
                      onClick={() => setStarredOnly(v => !v)}
                    >
                      ★ Starred only
                    </button>

                    {/* Live result count */}
                    {spots.length > 0 && !isResearching && (
                      <span className="fb-count">{filteredSpots.length} spots</span>
                    )}
                  </div>
                </>
              )}

              {/* Research split view — always visible */}
              <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

                {/* Left: spot list */}
                <div
                  className="research-list-panel"
                  data-hidden={mobileView !== 'list' ? 'true' : 'false'}
                  style={{
                    width:         'clamp(300px, 36vw, 440px)',
                    flexShrink:    0,
                    display:       'flex',
                    flexDirection: 'column',
                    borderRight:   '1px solid var(--line)',
                    minHeight:     0,          /* allow flex shrink so spotlist can scroll */
                    /* no overflow:hidden — let .spotlist own its own scroll */
                  }}
                >
                  {/* ── Sidebar controls (mode toggle only) ── */}
                  <div className="side-controls">
                    {/* Spots / Discover mode toggle */}
                    <div className="modetoggle">
                      <button
                        type="button"
                        className={'mode' + (researchSubTab === 'spots' ? ' on' : '')}
                        onClick={() => setResearchSubTab('spots')}
                      >
                        Spots<span className="mc">AI</span>
                      </button>
                      <button
                        type="button"
                        className={'mode' + (researchSubTab === 'discover' ? ' on' : '')}
                        onClick={() => setResearchSubTab('discover')}
                      >
                        Discover<span className="mc">COMMUNITY</span>
                      </button>
                    </div>

                    {/* Research error banner */}
                    {researchSubTab === 'spots' && researchError && !isResearching && (
                      <div style={{ padding: '8px 10px', background: 'color-mix(in oklch, var(--error) 7%, transparent)', border: '1px solid color-mix(in oklch, var(--error) 20%, transparent)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <p style={{ fontSize: '0.75rem', color: 'var(--error)', lineHeight: 1.4, flex: 1 }}>{researchError}</p>
                        <button type="button" onClick={() => triggerResearch()} style={{ background: 'none', border: '1px solid color-mix(in oklch, var(--error) 30%, transparent)', borderRadius: 6, color: 'var(--error)', fontSize: '0.72rem', padding: '3px 8px', cursor: 'pointer', flexShrink: 0 }}>Retry</button>
                      </div>
                    )}
                  </div>

                  {/* ── Status bar — research in progress only ── */}
                  {researchSubTab === 'spots' && isResearching && (
                    <div className="statusbar">
                      <div className="radar">
                        <div className="ring"/><div className="ring"/><div className="ring"/>
                        <div className="core"/>
                      </div>
                      <div className="status-txt">
                        <div className="line1">Researching {selectedDest?.city}</div>
                        <div className="line2">
                          <span className="uncover">
                            {researchStatus || `uncovering hidden gems…`}
                          </span>
                        </div>
                      </div>
                      <div className="progresscount">
                        <b>{streamingSpots.length}</b> found
                      </div>
                    </div>
                  )}

                  {researchSubTab === 'discover' && (
                    <div className="statusbar done">
                      <div className="status-txt">
                        <div className="line1">Loved by Venture travellers</div>
                        <div className="line2">Most-saved spots in {selectedDest?.city}, ranked by the community</div>
                      </div>
                    </div>
                  )}

                  {/* ── "Go deep" prompt — single category active, not yet in deep mode ── */}
                  {researchSubTab === 'spots' && filterInterests.size === 1 && !deepInterestId && !isResearching && filteredSpots.length > 0 && (() => {
                    const activeInterest = INTERESTS.find((i) => filterInterests.has(i.id));
                    return activeInterest ? (
                      <div style={{
                        flexShrink: 0, padding: '7px 14px',
                        background: 'color-mix(in oklch, var(--ink) 3%, var(--paper-2))',
                        borderBottom: '1px solid var(--line)',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                      }}>
                        <span style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {filteredSpots.length} curated {activeInterest.label.toLowerCase()} spots
                        </span>
                        <button
                          type="button"
                          onClick={() => triggerDeepResearch(activeInterest.id)}
                          style={{
                            flexShrink: 0, background: 'none', border: 'none',
                            color: 'var(--terracotta)', fontSize: 12.5, fontWeight: 700,
                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3,
                            padding: '2px 0',
                          }}
                        >
                          Show everything →
                        </button>
                      </div>
                    ) : null;
                  })()}

                  {/* ── Deep browse lens ── */}
                  {deepInterestId && (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
                      {/* Lens header */}
                      <div style={{
                        flexShrink: 0, padding: '10px 14px',
                        background: 'color-mix(in oklch, var(--terracotta) 8%, var(--paper-2))',
                        borderBottom: '1px solid color-mix(in oklch, var(--terracotta) 20%, transparent)',
                        display: 'flex', alignItems: 'center', gap: 10,
                      }}>
                        <button
                          type="button"
                          onClick={() => { setDeepInterestId(null); setDeepSpots([]); setDeepStreaming([]); setDeepError(null); }}
                          style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 13, fontWeight: 700, padding: '2px 6px 2px 0', flexShrink: 0 }}
                        >
                          ←
                        </button>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: 'var(--mono)', fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--terracotta)', marginBottom: 2 }}>
                            Everything in {INTERESTS.find((i) => i.id === deepInterestId)?.label}
                          </div>
                          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>
                            {deepLoading
                              ? `${deepStreaming.length} found so far…`
                              : `${deepSpots.length} places · sorted by hiddenness`}
                          </div>
                        </div>
                        {deepLoading && (
                          <div style={{ width: 14, height: 14, border: '2px solid var(--line)', borderTopColor: 'var(--terracotta)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
                        )}
                      </div>

                      {/* Error state */}
                      {deepError && (
                        <div style={{ padding: '12px 14px', background: 'color-mix(in oklch, var(--error) 7%, transparent)', borderBottom: '1px solid color-mix(in oklch, var(--error) 20%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          <p style={{ fontSize: 12.5, color: 'var(--error)' }}>{deepError}</p>
                          <button type="button" onClick={() => triggerDeepResearch(deepInterestId)} style={{ background: 'none', border: '1px solid color-mix(in oklch, var(--error) 30%, transparent)', borderRadius: 6, color: 'var(--error)', fontSize: 11, padding: '3px 8px', cursor: 'pointer', flexShrink: 0 }}>Retry</button>
                        </div>
                      )}

                      {/* Spot list — same SpotCard, existing + flow */}
                      <div className="spotlist">
                        {(deepLoading ? deepStreaming : deepSpots)
                          .slice()
                          .sort((a, b) => (b.hiddennessScore ?? 1) - (a.hiddennessScore ?? 1))
                          .map((spot) => (
                            <SpotCard
                              key={spot.id ?? spot.name}
                              spot={spot}
                              active={selectedSpotId === spot.id}
                              onSelect={() => setSelectedSpotId(selectedSpotId === spot.id ? null : spot.id)}
                              saved={savedIds.has(spot.id)}
                              onToggleSave={toggleSave}
                              onOpenDrawer={setDrawerSpot}
                              onAddToDay={isPastTrip ? null : ((s) => { setQuickAddSpot(s); setQuickAddDay(days[0]?.id ?? ''); setQuickAddSlot('morning'); })}
                              isPastTrip={isPastTrip}
                            />
                        ))}
                        {deepLoading && deepStreaming.length === 0 && (
                          <div className="skel">
                            <div className="sk-med shimmer" />
                            <div className="sk-lines">
                              <div className="sk-l shimmer" style={{ width: '40%' }} />
                              <div className="sk-l shimmer" style={{ width: '75%', height: 13 }} />
                              <div className="sk-l shimmer" style={{ width: '30%', marginBottom: 0 }} />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── Curated / discover spot list (shown when NOT in deep mode) ── */}
                  {!deepInterestId && researchSubTab === 'discover' && (
                    <div className="spotlist" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ textAlign: 'center', padding: '48px 24px' }}>
                        <div style={{ fontSize: '2.8rem', marginBottom: 16, opacity: 0.7 }}>👥</div>
                        <h3 style={{ fontFamily: 'var(--serif)', fontSize: '1.15rem', fontStyle: 'italic', fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 10 }}>
                          Community spots
                        </h3>
                        <p style={{ fontSize: '0.82rem', color: 'var(--muted)', lineHeight: 1.7, maxWidth: 220, margin: '0 auto' }}>
                          See where real travellers are going.<br />Coming soon.
                        </p>
                      </div>
                    </div>
                  )}

                  {!deepInterestId && researchSubTab !== 'discover' && (
                    <div className="spotlist">
                      {/* Skeleton while streaming starts */}
                      {isResearching && streamingSpots.length === 0 && (
                        <div className="skel">
                          <div className="sk-med shimmer" />
                          <div className="sk-lines">
                            <div className="sk-l shimmer" style={{ width: '40%' }} />
                            <div className="sk-l shimmer" style={{ width: '75%', height: 13 }} />
                            <div className="sk-l shimmer" style={{ width: '30%', marginBottom: 0 }} />
                          </div>
                        </div>
                      )}

                      {/* Streaming cards (live reveal) */}
                      {isResearching && streamingSpots.map((spot) => (
                        <SpotCard
                          key={spot.name ?? spot.id}
                          spot={spot}
                          active={false}
                          onSelect={() => {}}
                          reveal={justFoundId === (spot.id ?? spot.name)}
                          justFound={justFoundId === (spot.id ?? spot.name)}
                          saved={savedIds.has(spot.id)}
                          onToggleSave={toggleSave}
                        />
                      ))}

                      {/* Full list after research */}
                      {!isResearching && filteredSpots.map((spot) => (
                        <SpotCard
                          key={spot.id}
                          spot={spot}
                          active={selectedSpotId === spot.id}
                          onSelect={() => setSelectedSpotId(selectedSpotId === spot.id ? null : spot.id)}
                          saved={savedIds.has(spot.id)}
                          onToggleSave={toggleSave}
                          visited={spotNotes[spot.id]?.visited ?? false}
                          onOpenDrawer={setDrawerSpot}
                          onAddToDay={isPastTrip ? null : ((s) => { setQuickAddSpot(s); setQuickAddDay(days[0]?.id ?? ''); setQuickAddSlot('morning'); })}
                          isPastTrip={isPastTrip}
                          reviewAggregate={reviewAggregates[spot.id] ?? null}
                          userRating={userRatings[spot.id] ?? 0}
                          onRate={async (spotId, rating) => {
                            if (!user?.uid) return;
                            setUserRatings((prev) => ({ ...prev, [spotId]: rating }));
                            try {
                              await saveSpotReview(user.uid, spotId, rating);
                              const updated = await getSpotReviewAggregates([spotId]);
                              setReviewAggregates((prev) => ({ ...prev, ...updated }));
                              toast.success('Rating saved!');
                            } catch (err) { console.error(err); }
                          }}
                        />
                      ))}

                      {/* Empty filter state */}
                      {!isResearching && spots.length > 0 && filteredSpots.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--muted)' }}>
                          <div style={{ fontFamily: 'var(--serif)', fontSize: 19, fontStyle: 'italic', color: 'var(--ink-soft)', marginBottom: 6 }}>Nothing matches.</div>
                          <div style={{ fontSize: 13.5, marginBottom: 14 }}>Try clearing a filter or your search.</div>
                          <button type="button" onClick={() => { setFilterInterests(new Set()); setMinScoreFilter(0); setSearchQuery(''); setStarredOnly(false); }} style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', background: 'var(--card)', border: '1px solid var(--line-strong)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>
                            Clear filters
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Right: map */}
                <div
                  className="research-map-panel"
                  data-hidden={mobileView !== 'map' ? 'true' : 'false'}
                  style={{ flex: 1, position: 'relative', background: 'var(--paper-2)', minWidth: 0, flexDirection: 'column' }}
                >
                  {/* Inset frame — gives the map a visual border, scales naturally */}
                  <div style={{
                    position: 'absolute',
                    inset: 14,
                    borderRadius: 18,
                    overflow: 'hidden',
                    border: '1px solid var(--line)',
                    boxShadow: '0 2px 8px oklch(0.3 0.02 60 / 0.08), 0 12px 32px -8px oklch(0.3 0.02 60 / 0.18)',
                  }}>
                  {mapMounted ? (
                    <ErrorBoundary fallback={
                      <div style={{ position: 'absolute', inset: 0, background: 'var(--map-paper)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                        <span style={{ fontSize: '2rem', opacity: 0.5 }}>🗺️</span>
                        <p style={{ fontSize: '0.78rem', color: 'var(--muted)', textAlign: 'center', maxWidth: 200, lineHeight: 1.6 }}>Map failed to load. Try refreshing the page.</p>
                      </div>
                    }>
                      <MapView
                        key={selectedDest?.id ?? 'map'}
                        spots={deepInterestId ? (deepLoading ? deepStreaming : deepSpots) : isResearching ? streamingSpots : filteredSpots}
                        centerLat={selectedDest?.centerLat ?? spots.find(s => s.lat)?.lat}
                        centerLng={selectedDest?.centerLng ?? spots.find(s => s.lng)?.lng}
                        onSpotClick={handleSpotClick}
                        onOpenDrawer={setDrawerSpot}
                        filterInterest={filterInterests.size === 1 ? [...filterInterests][0] : ''}
                        minScore={minScoreFilter || 1}
                        focusSpotId={selectedSpotId}
                        visitedIds={visitedIds}
                        fitRevision={mapFitRevision}
                      />
                    </ErrorBoundary>
                  ) : (
                    <div style={{ position: 'absolute', inset: 0, background: 'var(--map-paper)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
                      <span style={{ fontSize: '2rem', opacity: 0.3 }}>🗺️</span>
                      <p style={{ fontSize: '0.78rem', color: 'var(--muted)', fontFamily: 'var(--mono)', letterSpacing: '0.04em' }}>Map loads with first spots…</p>
                    </div>
                  )}

                  {/* Research streaming overlay */}
                  {isResearching && streamingSpots.length === 0 && (
                    <div style={{ position: 'absolute', inset: 0, background: 'color-mix(in oklch, var(--map-paper) 70%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(3px)' }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid var(--line)', borderTopColor: 'var(--terracotta)', animation: 'spin 0.8s linear infinite', margin: '0 auto 10px' }} />
                        <p style={{ color: 'var(--muted)', fontSize: '0.78rem', fontFamily: 'var(--mono)' }}>Finding spots in {selectedDest?.city}…</p>
                      </div>
                    </div>
                  )}


                  </div>{/* end map frame */}

                  {/* Popup is now a native mapboxgl.Popup rendered inside MapView */}
                </div>
              </div>
            </div>
          )}

          {/* ════════════════ DAYS ════════════════ */}
          {activeTab === 'Days' && (
            <DaysBuilder
              days={days}
              daysLoading={daysLoading}
              spots={spots}
              savedIds={savedIds}
              city={selectedDest?.city ?? ''}
              tripId={tripId}
              trip={trip}
              selectedDest={selectedDest}
              user={user}
              onRefetch={refetchDays}
              onSwitchToResearch={() => setActiveTab('Research')}
              onToggleSave={toggleSave}
              events={cityEvents}
              toast={toast}
            />
          )}

          {/* ════════════════ PASS ════════════════ */}
          {activeTab === 'Pass' && (
            <div className="pass-scroll">
              <div className="pass-wrap">
                <div className="pass-eyebrow">City pass verdict</div>
                <h1>{selectedDest?.city ?? 'City'} Pass</h1>
                <p className="ph-sub">We compare your planned entry costs against the pass price.</p>

                {daysLoading ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 28 }}>
                    {[1,2].map(i => <div key={i} className="skel" style={{ height: 120, borderRadius: 24 }} />)}
                  </div>
                ) : (() => {
                  // Inline pass calculation (mirrors DayPassCalculator logic)
                  const allSpots  = days.flatMap((d) => d.spots ?? []);
                  const paidSpots = allSpots.filter((s) => (s.entryPrice ?? 0) > 0);
                  const freeSpots = allSpots.filter((s) => !(s.entryPrice > 0));
                  const totalEntries = paidSpots.reduce((sum, s) => sum + (s.entryPrice ?? 0), 0);

                  if (!cityPass) return (
                    <div className="verdict skip" style={{ marginTop: 28 }}>
                      <div className="verdict-top">
                        <div className="verdict-badge">
                          <div className="vb-ring" />
                          <span className="vb-ic">🔍</span>
                          <span className="vb-w">No data</span>
                        </div>
                        <div className="verdict-main">
                          <div className="vm-k">No pass found</div>
                          <h2>{selectedDest?.city ?? 'This city'} — <em>check manually</em></h2>
                          <p>
                            We don't have pass data for {selectedDest?.city} yet.{' '}
                            <a href={`https://www.google.com/search?q=${encodeURIComponent((selectedDest?.city ?? '') + ' city tourist pass')}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--terracotta-deep)' }}>Search Google →</a>
                          </p>
                        </div>
                      </div>
                    </div>
                  );

                  if (days.length === 0 || allSpots.length === 0) return (
                    <div className="verdict skip" style={{ marginTop: 28 }}>
                      <div className="verdict-top">
                        <div className="verdict-badge">
                          <div className="vb-ring" />
                          <span className="vb-ic">📅</span>
                          <span className="vb-w">No plan yet</span>
                        </div>
                        <div className="verdict-main">
                          <div className="vm-k">Plan needed</div>
                          <h2>Build your <em>day plan</em> first</h2>
                          <p>Add spots to your Morning / Afternoon / Evening slots — then we'll calculate whether the {cityPass.name ?? 'city pass'} is worth it.</p>
                        </div>
                      </div>
                    </div>
                  );

                  const tripDays = (() => {
                    if (!selectedDest?.startDate || !selectedDest?.endDate) return 1;
                    return Math.max(1, Math.round((new Date(selectedDest.endDate) - new Date(selectedDest.startDate)) / 86400000) + 1);
                  })();

                  // Pick cheapest tier that covers the trip length
                  const tier = cityPass.tiers
                    ? [...cityPass.tiers].sort((a, b) => a.days - b.days).find((t) => t.days >= tripDays) ?? cityPass.tiers[cityPass.tiers.length - 1]
                    : { price: cityPass.price, days: tripDays };

                  const passPrice      = tier?.price ?? cityPass.price ?? 0;
                  const transportBonus = cityPass.includesTransport ? (cityPass.transportValue ?? 0) * tripDays : 0;
                  const passValue      = totalEntries + transportBonus;
                  const savings        = passValue - passPrice;
                  const worthIt        = savings > 0;

                  return (
                    <>
                      {/* Verdict hero */}
                      <div className={`verdict ${worthIt ? 'buy' : 'skip'}`}>
                        <div className="verdict-top">
                          <div className="verdict-badge">
                            <div className="vb-ring" />
                            <span className="vb-ic">{worthIt ? '✓' : '✕'}</span>
                            <span className="vb-w">{worthIt ? 'Buy it' : 'Skip it'}</span>
                          </div>
                          <div className="verdict-main">
                            <div className="vm-k">Our verdict</div>
                            <h2>
                              {worthIt
                                ? <><em>Buy</em> the {cityPass.name ?? 'city pass'}.</>
                                : <>Skip the pass — <em>pay as you go.</em></>
                              }
                            </h2>
                            <p>
                              {worthIt
                                ? `Your planned entries total €${totalEntries}${transportBonus > 0 ? ` plus €${transportBonus} transport value` : ''}. At €${passPrice} for the pass, you save €${savings}.`
                                : `Your planned entries total €${totalEntries} — less than the €${passPrice} pass price. Save €${Math.abs(savings)} by paying individually.`
                              }
                            </p>
                          </div>
                        </div>

                        {/* Math row */}
                        <div className="math">
                          <div className="mcell">
                            <div className="ml">Pass price</div>
                            <div className="mv">€{passPrice}</div>
                            <div className="mvsub">{tier?.days ?? tripDays}-day pass</div>
                          </div>
                          <div className="mcell">
                            <div className="ml">Usable value</div>
                            <div className="mv">€{passValue}</div>
                            <div className="mvsub">entries + transport</div>
                          </div>
                          <div className={`mcell save${savings < 0 ? ' neg' : ''}`}>
                            <div className="ml">{savings >= 0 ? 'You save' : 'You lose'}</div>
                            <div className="mv">€{Math.abs(savings)}</div>
                            <div className="mvsub">{worthIt ? 'with the pass' : 'if you buy it'}</div>
                          </div>
                        </div>
                      </div>

                      {/* Covered / not-covered breakdown */}
                      {(paidSpots.length > 0 || freeSpots.length > 0) && (
                        <div className="pass-cols">
                          {paidSpots.length > 0 && (
                            <div className="pass-card">
                              <div className="pc-head">
                                <span className="pc-t">Covered by pass</span>
                                <span className="pc-meta">{paidSpots.length} spots</span>
                              </div>
                              <div className="pass-rows">
                                {paidSpots.map((s) => (
                                  <div key={s.id ?? s.name} className="pass-row">
                                    <div className="pr-nm">
                                      <div className="n">{s.name}</div>
                                      <div className="m">{s.category ?? s.cat}</div>
                                    </div>
                                    <span className="pr-cost covered">€{s.entryPrice}</span>
                                  </div>
                                ))}
                              </div>
                              <div className="pass-foot">
                                <span className="pf-l">Total entries</span>
                                <span className="pf-v">€{totalEntries}</span>
                              </div>
                            </div>
                          )}

                          {freeSpots.length > 0 && (
                            <div className="pass-card">
                              <div className="pc-head">
                                <span className="pc-t">Not covered</span>
                                <span className="pc-meta">{freeSpots.length} free spots</span>
                              </div>
                              <div className="pass-rows">
                                {freeSpots.map((s) => (
                                  <div key={s.id ?? s.name} className="pass-row">
                                    <div className="pr-nm">
                                      <div className="n">{s.name}</div>
                                      <div className="m">{s.category ?? s.cat}</div>
                                    </div>
                                    <span className="pr-cost free">Free</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Note + CTA */}
                      <div className="pass-note">
                        <div className="pn-ic">i</div>
                        <p className="pn-tx">
                          Calculations are estimates based on your planned spots. <b>Entry prices may vary</b> — verify on each attraction's website before buying.
                        </p>
                      </div>

                      <div className="pass-cta">
                        {cityPass.url && (
                          <a href={cityPass.url} target="_blank" rel="noopener noreferrer"
                            className="btn btn-primary"
                            style={{ textDecoration: 'none', flex: 'none' }}>
                            Buy {cityPass.name ?? 'City Pass'} →
                          </a>
                        )}
                        <button type="button" className="btn btn-secondary"
                          onClick={() => setActiveTab('Days')}
                          style={{ border: '1.5px solid var(--line-strong)', cursor: 'pointer' }}>
                          Edit day plan
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ── Add-spot-to-day modal ────────────────────────────────────────── */}
      {addSpotModal && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setAddSpotModal(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'flex-end', zIndex: 200 }}
        >
          <div style={{ width: '100%', background: 'var(--card)', borderRadius: '16px 16px 0 0', padding: 20, paddingBottom: 'calc(20px + env(safe-area-inset-bottom))', maxHeight: '75dvh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <p style={{ fontWeight: 600, fontSize: '0.95rem' }}>Add to Day {addSpotModal.dayNumber}</p>
              <button type="button" onClick={() => setAddSpotModal(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1 }}>×</button>
            </div>
            <input
              type="text"
              placeholder="Search spots…"
              value={spotSearch}
              onChange={(e) => setSpotSearch(e.target.value)}
              autoFocus
              style={{ width: '100%', padding: '9px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none', marginBottom: 10, boxSizing: 'border-box' }}
            />
            {/* Slot selector */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {[['morning','🌅','Morning'],['afternoon','☀️','Afternoon'],['evening','🌙','Evening']].map(([slot, icon, label]) => (
                <button
                  key={slot}
                  type="button"
                  onClick={() => setAddSpotSlot(slot)}
                  style={{
                    flex: 1, padding: '7px 4px', borderRadius: 8, fontSize: '0.75rem',
                    border: `1px solid ${addSpotSlot === slot ? 'var(--accent)' : 'var(--border)'}`,
                    background: addSpotSlot === slot ? 'color-mix(in oklch, var(--terracotta) 12%, transparent)' : 'transparent',
                    color: addSpotSlot === slot ? 'var(--accent)' : 'var(--text-muted)',
                    fontWeight: addSpotSlot === slot ? 600 : 400,
                    cursor: 'pointer', transition: 'all 0.12s',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                  }}
                >{icon} {label}</button>
              ))}
            </div>
            <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {spots.length === 0 && (
                <div style={{ textAlign: 'center', padding: '24px 16px' }}>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    No spots researched yet.
                  </p>
                  <button
                    type="button"
                    onClick={() => { setAddSpotModal(null); setActiveTab('Research'); }}
                    style={{ marginTop: 10, background: 'none', border: 'none', color: 'var(--accent)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}
                  >
                    Go to Research →
                  </button>
                </div>
              )}
              {spots
                .filter((s) => !spotSearch || s.name.toLowerCase().includes(spotSearch.toLowerCase()))
                .map((spot) => {
                  const added  = addedSpots.has(spot.id);
                  const adding = addingSpot === spot.id;
                  return (
                    <button
                      key={spot.id}
                      type="button"
                      disabled={adding || added}
                      onClick={async () => {
                        setAddingSpot(spot.id);
                        try {
                          await addSpotToDayPlan(addSpotModal.dayPlanId, spot.id, spot.city, addSpotSlot);
                          setAddedSpots((prev) => new Set([...prev, spot.id]));
                          refetchDays();
                          toast.success(`${spot.name} added to Day ${addSpotModal.dayNumber}`);
                        } catch (err) { console.error(err); }
                        finally { setAddingSpot(null); }
                      }}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px', background: added ? 'rgba(45,106,79,0.08)' : 'var(--bg)', border: `1px solid ${added ? 'rgba(45,106,79,0.3)' : 'var(--border)'}`, borderRadius: 8, cursor: added || adding ? 'default' : 'pointer', textAlign: 'left' }}
                    >
                      <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-primary)', flex: 1 }}>{spot.name}</span>
                      <span style={{ fontSize: '0.72rem', color: added ? 'var(--green)' : 'var(--text-muted)', flexShrink: 0 }}>
                        {added ? '✓ Added' : adding ? '…' : '+ Add'}
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* ── Quick-add to day popover (from Research tab) ─────────────────── */}
      {quickAddSpot && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setQuickAddSpot(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 250, padding: '0 0 env(safe-area-inset-bottom)' }}
        >
          <div style={{ width: '100%', maxWidth: 480, background: 'var(--card)', borderRadius: '16px 16px 0 0', padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <p style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>Add to Day Plan</p>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>{quickAddSpot.name}</p>
              </div>
              <button type="button" onClick={() => setQuickAddSpot(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.3rem', lineHeight: 1 }}>×</button>
            </div>

            {days.length === 0 ? (
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 16 }}>
                No day plans yet. Add dates to your trip to create day slots.
              </p>
            ) : (
              <>
                {/* Day selector */}
                <div style={{ marginBottom: 12 }}>
                  <p style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 7 }}>Day</p>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {days.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => setQuickAddDay(d.id)}
                        style={{
                          padding: '6px 14px', borderRadius: 8, fontSize: '0.8rem',
                          border: `1px solid ${quickAddDay === d.id ? 'var(--accent)' : 'var(--border)'}`,
                          background: quickAddDay === d.id ? 'color-mix(in oklch, var(--terracotta) 12%, transparent)' : 'var(--bg)',
                          color: quickAddDay === d.id ? 'var(--accent)' : 'var(--text-secondary)',
                          cursor: 'pointer', fontWeight: quickAddDay === d.id ? 600 : 400,
                          transition: 'all 0.12s',
                        }}
                      >
                        Day {d.dayNumber}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Slot selector */}
                <div style={{ marginBottom: 18 }}>
                  <p style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 7 }}>Time of Day</p>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {['morning', 'afternoon', 'evening'].map((slot) => (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => setQuickAddSlot(slot)}
                        style={{
                          flex: 1, padding: '8px 6px', borderRadius: 8, fontSize: '0.78rem',
                          border: `1px solid ${quickAddSlot === slot ? 'var(--accent)' : 'var(--border)'}`,
                          background: quickAddSlot === slot ? 'color-mix(in oklch, var(--terracotta) 12%, transparent)' : 'var(--bg)',
                          color: quickAddSlot === slot ? 'var(--accent)' : 'var(--text-secondary)',
                          cursor: 'pointer', fontWeight: quickAddSlot === slot ? 600 : 400,
                          transition: 'all 0.12s',
                        }}
                      >
                        {slot === 'morning' ? '🌅' : slot === 'afternoon' ? '☀️' : '🌙'} {slot.charAt(0).toUpperCase() + slot.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={confirmQuickAdd}
                  disabled={quickAdding}
                  style={{
                    width: '100%', padding: '11px', borderRadius: 10,
                    background: 'var(--accent)', color: '#000',
                    border: 'none', fontSize: '0.9rem', fontWeight: 700,
                    cursor: 'pointer', opacity: quickAdding ? 0.6 : 1,
                    transition: 'opacity 0.15s',
                  }}
                >
                  {quickAdding ? 'Adding…' : '+ Add to Plan'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Spot detail drawer ────────────────────────────────────────────── */}
      {drawerSpot && (
        <SpotDrawer
          spot={drawerSpot}
          days={days}
          userId={user?.uid ?? null}
          onClose={() => setDrawerSpot(null)}
          onAddToDay={handleDrawerAddToDay}
          starred={drawerSpot ? savedIds.has(drawerSpot.id) : false}
          onStar={(id) => { const spot = spots.find((s) => s.id === id); if (spot) toggleSave(spot, !savedIds.has(id)); }}
        />
      )}

      {/* ── Keyboard shortcuts modal ──────────────────────────────────────── */}
      {showShortcuts && (
        <div
          onClick={() => setShowShortcuts(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400, backdropFilter: 'blur(4px)' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '24px 28px', maxWidth: 360, width: '100%', margin: '0 16px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700 }}>Keyboard shortcuts</h3>
              <button type="button" onClick={() => setShowShortcuts(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}>×</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { key: '↑ / ↓',    desc: 'Navigate spots list'      },
                { key: 'Enter',     desc: 'Open spot details drawer'  },
                { key: 'Esc',       desc: 'Close drawer / deselect'   },
                { key: '?',         desc: 'Show this shortcuts panel'  },
              ].map(({ key, desc }) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{desc}</span>
                  <kbd style={{
                    background: 'rgba(255,255,255,0.07)', border: '1px solid var(--border)',
                    borderRadius: 6, padding: '3px 8px', fontSize: '0.72rem',
                    fontFamily: 'monospace', color: 'var(--text-primary)',
                    flexShrink: 0, whiteSpace: 'nowrap',
                  }}>{key}</kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Refresh confirm dialog ──────────────────────────────────────────── */}
      {refreshConfirmVisible && (
        <div
          onClick={() => setRefreshConfirmVisible(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500, backdropFilter: 'blur(4px)' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '28px 32px', maxWidth: 380, width: '100%', margin: '0 16px', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}
          >
            <div style={{ fontSize: '1.5rem', marginBottom: 12, textAlign: 'center' }}>↻</div>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 10, textAlign: 'center' }}>Refresh research?</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.65, textAlign: 'center', marginBottom: 24 }}>
              This will replace all current spots for {selectedDest?.city} with a fresh AI research run. Spots already added to your day plan will remain.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => setRefreshConfirmVisible(false)}
                style={{ flex: 1, padding: '11px', borderRadius: 10, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { setRefreshConfirmVisible(false); triggerResearch(true); }}
                style={{ flex: 1, padding: '11px', borderRadius: 10, background: 'var(--terracotta, #c2410c)', border: 'none', color: '#fff', fontSize: '0.875rem', fontWeight: 700, cursor: 'pointer' }}
              >
                Yes, refresh
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
