import React, { useEffect, useState, useCallback } from 'react';
import {
  LogOut,
  RefreshCw,
  User,
  ArrowRight,
  Compass,
  Sparkles,
  ChevronDown,
  MessageSquare,
  MapPin,
  Ticket,
  Wallet,
  Vote,
  ShieldCheck,
  Radio,
  Database,
} from 'lucide-react';
import { apiRequest, clearAuthSession, getStoredUser, setAuthSession } from './api/client';
import AuthModal from './components/AuthModal';
import ConstraintBanner from './components/ConstraintBanner';
import TripChatHub from './components/TripChatHub';
import TripsSection from './components/TripsSection';
import PlannerSection from './components/PlannerSection';
import VotingSection from './components/VotingSection';
import SagaSection from './components/SagaSection';
import ExpensesSection from './components/ExpensesSection';
import OperatorSection from './components/OperatorSection';
import LiveRadarSection from './components/LiveRadarSection';
import AuditSection from './components/AuditSection';

const WORKSPACE_TABS = [
  { id: 'chat', label: 'Trip Workspace', icon: MessageSquare },
  { id: 'radar', label: 'Live Radar', icon: Radio },
  { id: 'voting', label: 'Group Approvals', icon: Vote },
  { id: 'saga', label: 'Booking Engine', icon: ShieldCheck },
  { id: 'tickets', label: 'Heritage Tickets', icon: Ticket },
  { id: 'audit', label: 'Activity Logs', icon: Database },
  { id: 'trips', label: 'All Trips', icon: Compass },
];

export default function App() {
  const [user, setUser] = useState(() => getStoredUser());
  const [authOpen, setAuthOpen] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [activeTab, setActiveTab] = useState('chat');
  const [isScrolled, setIsScrolled] = useState(false);

  const [status, setStatus] = useState(null);
  const [allUsers, setAllUsers] = useState([]);
  const [trips, setTrips] = useState([]);
  const [activeTripId, setActiveTripId] = useState(1);
  const [tripDetail, setTripDetail] = useState(null);
  const [itineraries, setItineraries] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [sagas, setSagas] = useState([]);
  const [finances, setFinances] = useState(null);
  const [pois, setPois] = useState([]);
  const [slots, setSlots] = useState([]);
  const [holds, setHolds] = useState([]);
  const [auditRows, setAuditRows] = useState([]);
  const [nosqlDocs, setNosqlDocs] = useState({ supplier_snapshots: [], llm_conversations: [] });

  // Track window scroll for smooth frosted-glass navbar blur
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 8);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const notify = useCallback((type, message, pgDetail = null) => {
    setFeedback({ type, message, pgDetail });
  }, []);

  const refreshAll = useCallback(async (targetTripId) => {
    const tid = targetTripId || activeTripId;
    try {
      const [sys, usersData, tripsData, poisData, slotsData, holdsData, auditLogData, nosqlData] = await Promise.all([
        apiRequest('/api/audit/system-status'),
        apiRequest('/api/auth/users'),
        apiRequest('/api/trips'),
        apiRequest('/api/inventory/pois'),
        apiRequest('/api/inventory/slots'),
        apiRequest('/api/inventory/holds'),
        apiRequest('/api/audit/postgres-log').catch(() => []),
        apiRequest('/api/audit/nosql-documents').catch(() => ({})),
      ]);
      setStatus(sys);
      setAllUsers(usersData);
      setTrips(tripsData);
      setPois(poisData);
      setSlots(slotsData);
      setHolds(holdsData);
      setAuditRows(auditLogData || []);
      setNosqlDocs(nosqlData || { supplier_snapshots: [], llm_conversations: [] });

      const resolvedTripId = tid || tripsData[0]?.trip_id;
      if (resolvedTripId) {
        setActiveTripId(resolvedTripId);
        const [detail, itins, props, sagaList, fin] = await Promise.all([
          apiRequest(`/api/trips/${resolvedTripId}`),
          apiRequest(`/api/itineraries/trip/${resolvedTripId}`),
          apiRequest(`/api/voting/trip/${resolvedTripId}`),
          apiRequest(`/api/saga/trip/${resolvedTripId}`),
          apiRequest(`/api/expenses/trip/${resolvedTripId}`),
        ]);
        setTripDetail(detail);
        setItineraries(itins);
        setProposals(props);
        setSagas(sagaList);
        setFinances(fin);
      }
    } catch (err) {
      notify('error', `Sync error: ${err.message}`);
    }
  }, [activeTripId, notify]);

  useEffect(() => {
    refreshAll(activeTripId);
  }, [activeTripId, refreshAll]);

  const currentIdx = WORKSPACE_TABS.findIndex((t) => t.id === activeTab);
  const nextTab = WORKSPACE_TABS[(currentIdx + 1) % WORKSPACE_TABS.length];

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col font-sans">
      {/* Modern Clean Navbar (with subtle blur on scroll) */}
      <header
        className={`sticky top-0 z-40 h-16 transition-all duration-200 ${
          isScrolled
            ? 'bg-white/90 backdrop-blur-md shadow-xs border-b border-hairline'
            : 'bg-white border-b border-hairline'
        }`}
      >
        <div className="max-w-[1280px] mx-auto h-full px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            {/* Confident Editorial Logo */}
            <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => setActiveTab('chat')}>
              <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold shadow-2xs">
                <Compass className="w-4.5 h-4.5 text-sky-400" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-bold tracking-tight text-black">Yatra</span>
                <span className="hidden sm:inline-block text-[11px] font-mono uppercase tracking-wider text-black/50">
                  Smart Group Tourism
                </span>
              </div>
            </div>

            {/* Trip Selector Dropdown */}
            <select
              aria-label="Active Trip"
              className="text-xs bg-surface-soft hover:bg-hairline border border-hairline rounded-pill px-3.5 py-1.5 font-semibold text-black focus:outline-none focus:ring-1 focus:ring-black max-w-[200px] sm:max-w-[320px] truncate transition-colors"
              value={activeTripId}
              onChange={(e) => setActiveTripId(Number(e.target.value))}
            >
              {trips.length === 0 ? (
                <option value="">No previous trips</option>
              ) : (
                trips.map((t) => (
                  <option key={t.trip_id} value={t.trip_id}>
                    Trip #{t.trip_id}: {t.title}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="flex items-center gap-3">
            {/* Refresh Button */}
            <button
              onClick={() => refreshAll(activeTripId)}
              title="Refresh Data"
              className="w-9 h-9 rounded-full bg-surface-soft hover:bg-hairline text-black/70 flex items-center justify-center transition-colors shadow-2xs"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>

            {/* User Profile / Auth Button */}
            {user ? (
              <div className="flex items-center gap-2">
                <div className="relative group">
                  <button className="flex items-center gap-2 text-xs font-semibold px-3.5 py-1.5 rounded-pill bg-surface-soft hover:bg-hairline text-black border border-hairline transition-colors">
                    <div className="w-5 h-5 rounded-full bg-sky-100 border border-sky-300 text-sky-900 flex items-center justify-center text-[10px] font-bold">
                      {user.full_name?.charAt(0) || 'U'}
                    </div>
                    <span className="max-w-[120px] truncate">{user.full_name}</span>
                    <ChevronDown className="w-3 h-3 text-black/40" />
                  </button>
                  <div className="absolute right-0 mt-1 w-48 bg-white border border-hairline rounded-xl shadow-lg p-2 hidden group-hover:block z-50">
                    <div className="px-2 py-1.5 border-b border-hairline mb-1">
                      <span className="text-xs font-bold text-black block truncate">{user.full_name}</span>
                      <span className="text-[11px] text-black/50 block truncate">{user.email}</span>
                    </div>
                    <button
                      onClick={() => {
                        clearAuthSession();
                        setUser(null);
                        notify('success', 'Signed out successfully.');
                      }}
                      className="w-full text-left px-2.5 py-1.5 text-xs rounded-lg text-rose-600 hover:bg-rose-50 flex items-center gap-1.5 font-medium transition-colors"
                    >
                      <LogOut className="w-3.5 h-3.5" /> Sign out
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAuthOpen(true)}
                className="btn-primary text-xs py-2 px-5"
              >
                Sign in
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Modern Segmented Navigation Tabs */}
      <div className="max-w-[1280px] mx-auto w-full px-6 pt-6 pb-2">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar border-b border-hairline pb-3">
          {WORKSPACE_TABS.map((t) => {
            const Icon = t.icon;
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`whitespace-nowrap px-4 py-2 text-xs font-semibold rounded-pill flex items-center gap-1.5 transition-all duration-200 ease-out active:scale-95 ${
                  isActive
                    ? 'bg-white text-black border border-hairline font-semibold shadow-xs scale-[1.02]'
                    : 'text-black/60 hover:text-black hover:bg-surface-soft border border-transparent'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 transition-transform duration-200 ${isActive ? 'scale-110 text-black' : 'text-black/40'}`} />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content Area */}
      <main className="max-w-[1280px] mx-auto w-full px-6 pb-16 flex-1 space-y-6">
        <div key={activeTab} className="animate-tab-shift space-y-6">
          {activeTab === 'chat' && (
            <TripChatHub
              activeTripId={activeTripId}
              setActiveTripId={setActiveTripId}
              trips={trips}
              tripDetail={tripDetail}
              itineraries={itineraries}
              proposals={proposals}
              slots={slots}
              finances={finances}
              currentUser={user}
              onOpenAuth={() => setAuthOpen(true)}
              onRefresh={refreshAll}
              notify={notify}
            />
          )}
          {activeTab === 'itinerary' && (
            <PlannerSection
              activeTripId={activeTripId}
              tripDetail={tripDetail}
              itineraries={itineraries}
              slots={slots}
              onRefresh={refreshAll}
              notify={notify}
            />
          )}
          {activeTab === 'radar' && (
            <LiveRadarSection
              activeTripId={activeTripId}
              tripDetail={tripDetail}
              onRefresh={refreshAll}
              notify={notify}
            />
          )}
          {activeTab === 'tickets' && (
            <OperatorSection
              pois={pois}
              slots={slots}
              holds={holds}
              onRefresh={refreshAll}
              notify={notify}
            />
          )}
          {activeTab === 'expenses' && (
            <ExpensesSection
              activeTripId={activeTripId}
              tripDetail={tripDetail}
              finances={finances}
              onRefresh={refreshAll}
              notify={notify}
            />
          )}
          {activeTab === 'voting' && (
            <VotingSection
              activeTripId={activeTripId}
              tripDetail={tripDetail}
              proposals={proposals}
              itineraries={itineraries}
              currentUser={user}
              onRefresh={refreshAll}
              notify={notify}
            />
          )}
          {activeTab === 'saga' && (
            <SagaSection
              activeTripId={activeTripId}
              itineraries={itineraries}
              sagas={sagas}
              onRefresh={refreshAll}
              notify={notify}
            />
          )}
          {activeTab === 'audit' && (
            <AuditSection
              auditRows={auditRows}
              nosqlDocs={nosqlDocs}
            />
          )}
          {activeTab === 'trips' && (
            <TripsSection
              trips={trips}
              activeTripId={activeTripId}
              setActiveTripId={setActiveTripId}
              tripDetail={tripDetail}
              allUsers={allUsers}
              currentUser={user}
              onNavigateTab={(tab) => setActiveTab(tab)}
              onRefresh={refreshAll}
              notify={notify}
            />
          )}
        </div>
      </main>

      {/* Production Consumer App Footer */}
      <footer className="border-t border-hairline bg-canvas py-6 px-6 mt-auto">
        <div className="max-w-[1280px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-ink/50">
          <div className="flex items-center gap-2">
            <span className="font-bold text-ink">Yatra</span>
            <span>·</span>
            <span>Smart Group Tourism Platform</span>
          </div>
          <div>
            <span>© 2026 Yatra Travel Technologies Inc. · Plan smarter together.</span>
          </div>
        </div>
      </footer>

      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onAuthSuccess={(u) => {
          setUser(u);
          notify('success', `Signed in as ${u.full_name}`);
        }}
      />
      <ConstraintBanner feedback={feedback} onClose={() => setFeedback(null)} />
    </div>
  );
}
