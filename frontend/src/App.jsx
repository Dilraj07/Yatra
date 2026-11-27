import React, { useEffect, useState, useCallback } from 'react';
import {
  LogOut,
  RefreshCw,
  User,
  Compass,
  ChevronDown,
  MessageSquare,
  MapPin,
  Ticket,
  Wallet,
  Vote,
  Plane,
} from 'lucide-react';
import { useUser, useClerk, UserButton } from '@clerk/react';
import { apiRequest, clearAuthSession, getStoredUser, clerkSync } from './api/client';
import AuthModal from './components/AuthModal';
import ConstraintBanner from './components/ConstraintBanner';
import TripChatHub from './components/TripChatHub';
import TripsSection from './components/TripsSection';
import PlannerSection from './components/PlannerSection';
import VotingSection from './components/VotingSection';
import ExpensesSection from './components/ExpensesSection';
import OperatorSection from './components/OperatorSection';
import LiveRadarSection from './components/LiveRadarSection';
import NotificationPopover from './components/chat/NotificationPopover';
import { chatApi, getChatAuthToken } from './api/chatApi';

const WORKSPACE_TABS = [
  { id: 'chat', label: 'Workspace', icon: MessageSquare },
  { id: 'itinerary', label: 'Itinerary', icon: MapPin },
  { id: 'radar', label: 'Flights & Stays', icon: Plane },
  { id: 'tickets', label: 'Tickets', icon: Ticket },
  { id: 'voting', label: 'Approvals', icon: Vote },
  { id: 'expenses', label: 'Expenses', icon: Wallet },
  { id: 'trips', label: 'Trips', icon: Compass },
];

function YatraLogo({ size = 'md' }) {
  const iconClass = size === 'sm' ? 'w-5 h-5' : 'w-7 h-7';
  return (
    <svg
      viewBox="0 0 24 24"
      className={`${iconClass} shrink-0`}
      fill="none"
      aria-hidden="true"
    >
      {/* Companion traveler pin */}
      <path
        d="M16.5 3.5a4.5 4.5 0 0 0-4.5 4.5c0 3.2 4.5 9.5 4.5 9.5S21 11.2 21 8a4.5 4.5 0 0 0-4.5-4.5z"
        fill="#dceeb1"
        stroke="#000000"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="16.5" cy="8" r="1.4" fill="#000000" />
      {/* Primary destination pin */}
      <path
        d="M8.5 5.5a5 5 0 0 0-5 5c0 3.6 5 10 5 10s5-6.4 5-10a5 5 0 0 0-5-5z"
        fill="#000000"
        stroke="#ffffff"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <circle cx="8.5" cy="10.5" r="1.8" fill="#ffffff" />
    </svg>
  );
}

export default function App({ hasClerk = true }) {
  const [user, setUser] = useState(() => getStoredUser());
  const [authOpen, setAuthOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [activeTab, setActiveTab] = useState('chat');
  const [isScrolled, setIsScrolled] = useState(false);

  // Clerk Authentication Hooks
  const { isLoaded: clerkLoaded, isSignedIn: clerkSignedIn, user: clerkUser } = useUser();
  const { signOut: clerkSignOut } = useClerk();

  const [allUsers, setAllUsers] = useState([]);
  const [trips, setTrips] = useState([]);
  const [activeTripId, setActiveTripId] = useState(1);
  const [tripDetail, setTripDetail] = useState(null);
  const [itineraries, setItineraries] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [finances, setFinances] = useState(null);
  const [slots, setSlots] = useState([]);
  const [holds, setHolds] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [chatNavTarget, setChatNavTarget] = useState(null);

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

  // Synchronize authenticated Clerk session with Yatra local & backend profile
  useEffect(() => {
    if (hasClerk && clerkLoaded && clerkSignedIn && clerkUser) {
      const clerkEmail = clerkUser.primaryEmailAddress?.emailAddress || `${clerkUser.id}@clerk.local`;
      if (!user || user.clerk_id !== clerkUser.id || user.email !== clerkEmail) {
        clerkSync(clerkUser).then((synced) => {
          setUser({ ...synced, clerk_id: clerkUser.id });
          notify('success', `Signed in as ${synced.full_name} via Clerk`);
        });
      }
    }
  }, [hasClerk, clerkLoaded, clerkSignedIn, clerkUser, user, notify]);

  const handleSignOut = async () => {
    if (clerkSignedIn) {
      try {
        await clerkSignOut();
      } catch (err) {
        console.warn('Clerk sign out:', err);
      }
    }
    clearAuthSession();
    setUser(null);
    setNotifications([]);
    setUnreadNotifications(0);
    notify('success', 'Signed out successfully.');
  };


  const refreshAll = useCallback(async (targetTripId) => {
    const tid = targetTripId || activeTripId;
    try {
      const [usersData, tripsData, slotsData, holdsData] = await Promise.all([
        apiRequest('/api/auth/users'),
        apiRequest('/api/trips'),
        apiRequest('/api/inventory/slots'),
        apiRequest('/api/inventory/holds'),
      ]);
      setAllUsers(usersData);
      setTrips(tripsData);
      setSlots(slotsData);
      setHolds(holdsData);

      const resolvedTripId = tid || tripsData[0]?.trip_id;
      if (resolvedTripId) {
        setActiveTripId(resolvedTripId);
        const [detail, itins, props, fin] = await Promise.all([
          apiRequest(`/api/trips/${resolvedTripId}`),
          apiRequest(`/api/itineraries/trip/${resolvedTripId}`),
          apiRequest(`/api/voting/trip/${resolvedTripId}`),
          apiRequest(`/api/expenses/trip/${resolvedTripId}`),
        ]);
        setTripDetail(detail);
        setItineraries(itins);
        setProposals(props);
        setFinances(fin);
      }
    } catch (err) {
      notify('error', `Sync error: ${err.message}`);
    }
  }, [activeTripId, notify]);

  useEffect(() => {
    refreshAll(activeTripId);
  }, [activeTripId, refreshAll]);

  const handleNotificationStateChange = useCallback((list, unread) => {
    setNotifications(list || []);
    setUnreadNotifications(unread || 0);
  }, []);

  const handleNavigateFromChat = useCallback((tab, targetTripId) => {
    if (targetTripId) {
      setActiveTripId(Number(targetTripId));
    }
    setActiveTab(tab);
  }, []);

  useEffect(() => {
    if (!getChatAuthToken()) return;
    chatApi.listNotifications()
      .then((res) => handleNotificationStateChange(res.notifications, res.unread_count))
      .catch(() => {});
  }, [user, handleNotificationStateChange]);

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
            {/* Simple Travel Logo */}
            <div className="flex items-center gap-2.5 cursor-pointer group" onClick={() => setActiveTab('chat')}>
              <div className="group-hover:scale-105 transition-transform">
                <YatraLogo />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-bold tracking-tight text-black">Yatra</span>
                <span className="hidden sm:inline-block text-[11px] font-mono uppercase tracking-wider text-black/45">
                  Group Travel
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
                <option value="">No trips yet</option>
              ) : (
                trips.map((t) => (
                  <option key={t.trip_id} value={t.trip_id}>
                    {t.title}
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

            <NotificationPopover
              notifications={notifications}
              unreadCount={unreadNotifications}
              onRefresh={async () => {
                if (!getChatAuthToken()) return;
                try {
                  const res = await chatApi.listNotifications();
                  setNotifications(res.notifications || []);
                  setUnreadNotifications(res.unread_count || 0);
                } catch {
                  // ignore silently
                }
              }}
              onSelectNotification={(n) => {
                setActiveTab('chat');
                setChatNavTarget({
                  conversationId: n.conversation_id,
                  messageId: n.message_id,
                  taskId: n.task_id,
                  ts: Date.now(),
                });
              }}
            />

            {/* User Profile / Auth Button */}
            {user ? (
              <div className="flex items-center gap-2">
                <div className="relative">
                  <button
                    onClick={() => setProfileOpen(!profileOpen)}
                    className="flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-pill bg-surface-soft hover:bg-hairline text-black border border-hairline transition-colors cursor-pointer"
                  >
                    {user.avatar_url ? (
                      <img
                        src={user.avatar_url}
                        alt={user.full_name}
                        className="w-5 h-5 rounded-full object-cover border border-hairline"
                      />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-sky-100 border border-sky-300 text-sky-900 flex items-center justify-center text-[10px] font-bold">
                        {user.full_name?.charAt(0) || 'U'}
                      </div>
                    )}
                    <span className="max-w-[120px] truncate">{user.full_name}</span>
                    <ChevronDown className="w-3 h-3 text-black/40" />
                  </button>
                  {profileOpen && (
                    <div className="absolute right-0 mt-1 w-52 bg-white border border-hairline rounded-xl shadow-lg p-2 z-50 animate-in fade-in duration-100">
                      <div className="px-2 py-1.5 border-b border-hairline mb-1">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-xs font-bold text-black block truncate">{user.full_name}</span>
                          {clerkSignedIn && (
                            <span className="text-[9px] font-mono uppercase bg-emerald-50 text-emerald-800 px-1.5 py-0.5 rounded-sm border border-emerald-200">
                              Clerk
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-black/50 block truncate">{user.email}</span>
                      </div>
                      <button
                        onClick={() => {
                          setProfileOpen(false);
                          handleSignOut();
                        }}
                        className="w-full text-left px-2.5 py-1.5 text-xs rounded-lg text-rose-600 hover:bg-rose-50 flex items-center gap-1.5 font-medium transition-colors cursor-pointer"
                      >
                        <LogOut className="w-3.5 h-3.5" /> Sign out
                      </button>
                    </div>
                  )}
                </div>

                {/* Native Clerk UserButton when Clerk session is active */}
                {clerkSignedIn && (
                  <div className="flex items-center">
                    <UserButton afterSignOutUrl="/" />
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={() => setAuthOpen(true)}
                className="btn-primary text-xs py-2 px-5 flex items-center gap-1.5"
              >
                <User className="w-3.5 h-3.5" />
                <span>Sign in</span>
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
              allUsers={allUsers}
              itineraries={itineraries}
              proposals={proposals}
              slots={slots}
              finances={finances}
              currentUser={user}
              onOpenAuth={() => setAuthOpen(true)}
              onNavigateTab={handleNavigateFromChat}
              onRefresh={refreshAll}
              notify={notify}
              externalNavTarget={chatNavTarget}
              onNotificationStateChange={handleNotificationStateChange}
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

      <footer className="border-t border-hairline bg-canvas py-5 px-6 mt-auto">
        <div className="max-w-[1280px] mx-auto flex items-center justify-between text-xs text-ink/50">
          <div className="flex items-center gap-2">
            <YatraLogo size="sm" />
            <span className="font-bold text-ink">Yatra</span>
          </div>
          <span>Plan trips together</span>
        </div>
      </footer>

      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        hasClerk={hasClerk}
        onAuthSuccess={(u) => {
          setUser(u);
          notify('success', `Signed in as ${u.full_name}`);
        }}
      />
      <ConstraintBanner feedback={feedback} onClose={() => setFeedback(null)} />
    </div>
  );
}
