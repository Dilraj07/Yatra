import React, { useState } from 'react';
import {
  Users,
  Plus,
  Calendar,
  Compass,
  ArrowRight,
  ShieldCheck,
  UserPlus,
  Sparkles,
} from 'lucide-react';
import { apiRequest } from '../api/client';

export default function TripsSection({
  trips = [],
  activeTripId,
  setActiveTripId,
  tripDetail,
  allUsers = [],
  currentUser,
  onNavigateTab,
  onRefresh,
  notify,
}) {
  const [subTab, setSubTab] = useState('directory'); // 'directory' | 'members' | 'create'

  // New Trip Form State
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('2026-12-22');
  const [endDate, setEndDate] = useState('2026-12-25');
  const [quorumPct, setQuorumPct] = useState(67);
  const [orgBudget, setOrgBudget] = useState(18000);
  const [orgCity, setOrgCity] = useState('Bengaluru');
  const [creating, setCreating] = useState(false);

  // Add Member State
  const [memberUserId, setMemberUserId] = useState('');
  const [memberBudget, setMemberBudget] = useState(15000);
  const [memberCity, setMemberCity] = useState('Bengaluru');
  const [addingMember, setAddingMember] = useState(false);

  const getInitials = (name) => {
    if (!name) return 'U';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  const getAvatarStyle = (name) => {
    const n = (name || '').toLowerCase();
    if (n.includes('dilraj')) return 'bg-purple-100 text-purple-800 border-purple-200';
    if (n.includes('arya')) return 'bg-sky-100 text-sky-800 border-sky-200';
    if (n.includes('aarush')) return 'bg-amber-100 text-amber-800 border-amber-200';
    return 'bg-slate-100 text-slate-800 border-slate-200';
  };

  const activeTripObj = trips.find((t) => t.trip_id === activeTripId) || tripDetail?.trip;
  const currentMembers = tripDetail?.members || [];
  const existingMemberIds = new Set(currentMembers.map((m) => m.user_id));
  const availableUsersToAdd = allUsers.filter((u) => !existingMemberIds.has(u.user_id));

  async function handleCreateTrip(e) {
    e.preventDefault();
    setCreating(true);
    try {
      const created = await apiRequest('/api/trips', {
        method: 'POST',
        body: JSON.stringify({
          title,
          start_date: startDate,
          end_date: endDate,
          quorum_pct: Number(quorumPct),
          organizer_budget_ceiling: Number(orgBudget),
          organizer_joining_city: orgCity,
        }),
      });
      setTitle('');
      setActiveTripId(created.trip_id);
      notify('success', `Created trip "${created.title}". Opening workspace!`);
      if (onRefresh) onRefresh(created.trip_id);
      setSubTab('directory');
    } catch (err) {
      notify('error', err.message, err.pgDetail);
    } finally {
      setCreating(false);
    }
  }

  async function handleAddMember(e) {
    e.preventDefault();
    if (!activeTripId || !memberUserId) return;
    setAddingMember(true);
    try {
      await apiRequest(`/api/trips/${activeTripId}/members`, {
        method: 'POST',
        body: JSON.stringify({
          user_id: Number(memberUserId),
          role: 'MEMBER',
          budget_ceiling: Number(memberBudget),
          joining_city: memberCity,
        }),
      });
      notify('success', 'Traveler successfully added to trip group.');
      setMemberUserId('');
      if (onRefresh) onRefresh(activeTripId);
    } catch (err) {
      notify('error', err.message, err.pgDetail);
    } finally {
      setAddingMember(false);
    }
  }

  const handleSelectAndOpen = (tripId) => {
    setActiveTripId(tripId);
    if (onRefresh) onRefresh(tripId);
    if (onNavigateTab) onNavigateTab('chat');
  };

  return (
    <div className="color-block bg-block-lime space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="display-lg">Trips</h2>
          <p className="text-xs text-ink/70 mt-1">Switch trips, manage travelers, or start a new one.</p>
        </div>
        <button
          onClick={() => setSubTab('create')}
          className="btn-primary text-xs py-2 px-4 flex items-center gap-1.5 shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>New Trip</span>
        </button>
      </div>

      {/* Top Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-hairline rounded-2xl p-4 shadow-xs">
          <div className="flex items-center gap-2 text-neutral-400 text-xs font-medium">
            <Compass className="w-3.5 h-3.5 text-blue-600" />
            <span>TRIPS</span>
          </div>
          <div className="text-xl font-bold font-mono text-slate-900 mt-1">
            {trips.length}
          </div>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            Your group trips
          </p>
        </div>

        <div className="bg-white border border-hairline rounded-2xl p-4 shadow-xs">
          <div className="flex items-center gap-2 text-neutral-400 text-xs font-medium">
            <Users className="w-3.5 h-3.5 text-purple-600" />
            <span>TRAVELERS</span>
          </div>
          <div className="text-xl font-bold font-mono text-slate-900 mt-1">
            {currentMembers.length}
          </div>
          <p className="text-[11px] text-neutral-500 mt-0.5 truncate">
            {activeTripObj?.title || 'Current trip'}
          </p>
        </div>

        <div className="bg-white border border-hairline rounded-2xl p-4 shadow-xs">
          <div className="flex items-center gap-2 text-neutral-400 text-xs font-medium">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>APPROVAL RULE</span>
          </div>
          <div className="text-xl font-bold font-mono text-slate-900 mt-1">
            {activeTripObj?.quorum_pct || 60}%
          </div>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            Votes needed to confirm plans
          </p>
        </div>
      </div>

      {/* Sub-Tabs View Switcher */}
      <div className="bg-surface-soft border border-hairline rounded-2xl p-1.5 flex gap-1 shadow-2xs max-w-md">
        <button
          onClick={() => setSubTab('directory')}
          className={`flex-1 py-2 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-all ${
            subTab === 'directory'
              ? 'bg-white text-slate-900 shadow-xs border border-hairline font-bold'
              : 'text-neutral-500 hover:text-slate-900'
          }`}
        >
          <Compass className="w-3.5 h-3.5 text-blue-600" /> All Trips ({trips.length})
        </button>
        <button
          onClick={() => setSubTab('members')}
          className={`flex-1 py-2 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-all ${
            subTab === 'members'
              ? 'bg-white text-slate-900 shadow-xs border border-hairline font-bold'
              : 'text-neutral-500 hover:text-slate-900'
          }`}
        >
          <Users className="w-3.5 h-3.5 text-purple-600" /> Current Trip
        </button>
        <button
          onClick={() => setSubTab('create')}
          className={`flex-1 py-2 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-all ${
            subTab === 'create'
              ? 'bg-white text-slate-900 shadow-xs border border-hairline font-bold'
              : 'text-neutral-500 hover:text-slate-900'
          }`}
        >
          <Plus className="w-3.5 h-3.5 text-orange-600" /> New Trip
        </button>
      </div>

      {/* SUB-TAB 1: All Trips Directory */}
      {subTab === 'directory' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {trips.map((t) => {
            const isActive = t.trip_id === activeTripId;
            return (
              <div
                key={t.trip_id}
                className={`bg-white border rounded-2xl p-6 shadow-xs flex flex-col justify-between space-y-4 transition-all hover:shadow-md ${
                  isActive ? 'border-orange-400 ring-2 ring-orange-200' : 'border-hairline'
                }`}
              >
                <div className="space-y-3">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">{t.title}</h3>
                    <p className="text-xs text-neutral-500 mt-1 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-neutral-400" />
                      <span>{t.start_date} to {t.end_date}</span>
                    </p>
                  </div>

                  <div className="bg-surface-soft p-3 rounded-xl border border-hairline space-y-2 text-xs">
                    <div className="flex items-center justify-between text-neutral-600">
                      <span>Organizer:</span>
                      <span className="font-semibold text-slate-800">{t.organizer_name}</span>
                    </div>
                    <div className="flex items-center justify-between text-neutral-600">
                      <span>Travelers:</span>
                      <span className="font-mono font-bold text-slate-900">{t.member_count || 1}</span>
                    </div>
                    <div className="flex items-center justify-between text-neutral-600">
                      <span>Approval needed:</span>
                      <span className="font-mono font-semibold text-slate-900">{t.quorum_pct}%</span>
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-hairline flex items-center gap-2">
                  {isActive ? (
                    <button
                      onClick={() => onNavigateTab && onNavigateTab('chat')}
                      className="w-full py-2 px-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-xs cursor-pointer"
                    >
                      <span>Open Workspace</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleSelectAndOpen(t.trip_id)}
                      className="w-full py-2 px-3 rounded-xl bg-slate-900 hover:bg-black text-white font-semibold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-xs cursor-pointer"
                    >
                      <span>Switch to Trip</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {trips.length === 0 && (
            <div className="col-span-full bg-white border border-dashed border-hairline rounded-2xl p-12 text-center space-y-3 shadow-xs">
              <div className="w-12 h-12 rounded-full bg-slate-100 border border-slate-200 text-slate-400 flex items-center justify-center mx-auto">
                <Compass className="w-6 h-6 text-slate-400" />
              </div>
              <h3 className="text-base font-bold text-slate-800">No trips yet</h3>
              <p className="text-xs text-neutral-500 max-w-sm mx-auto">
                Create a trip to start planning with your group.
              </p>
              <div className="pt-2">
                <button
                  onClick={() => setSubTab('create')}
                  className="btn-primary text-xs py-2 px-4 cursor-pointer inline-flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create Trip</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 2: Selected Trip & Travelers */}
      {subTab === 'members' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Trip Info & Travelers List */}
          <div className="lg:col-span-8 bg-white border border-hairline rounded-2xl p-6 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-hairline gap-3">
              <div>
                <h3 className="text-xl font-bold text-slate-900">
                  {tripDetail?.trip?.title || activeTripObj?.title || 'Trip Details'}
                </h3>
                <p className="text-xs text-neutral-500 mt-0.5">
                  {tripDetail?.trip?.start_date} to {tripDetail?.trip?.end_date} · {tripDetail?.trip?.quorum_pct}% approval needed
                </p>
              </div>

              <button
                onClick={() => onNavigateTab && onNavigateTab('chat')}
                className="btn-secondary text-xs py-2 px-4 flex items-center gap-1.5 self-start cursor-pointer"
              >
                <span>Open Workspace</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Travelers Grid */}
            <div className="space-y-3">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-neutral-400 block">
                Travelers ({currentMembers.length})
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {currentMembers.map((m) => {
                  const isOrg = m.role === 'ORGANIZER';
                  return (
                    <div
                      key={m.user_id}
                      className="bg-surface-soft border border-hairline rounded-xl p-3.5 space-y-2 shadow-2xs"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border shadow-xs ${getAvatarStyle(
                              m.full_name
                            )}`}
                          >
                            {getInitials(m.full_name)}
                          </div>
                          <div>
                            <span className="text-sm font-bold text-slate-900 block leading-tight">
                              {m.full_name}
                            </span>
                            <span className="text-[11px] text-neutral-400 block truncate">
                              {m.email}
                            </span>
                          </div>
                        </div>

                        <span
                          className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border ${
                            isOrg
                              ? 'bg-purple-50 text-purple-700 border-purple-200'
                              : 'bg-sky-50 text-sky-700 border-sky-200'
                          }`}
                        >
                          {m.role}
                        </span>
                      </div>

                      <div className="pt-2 border-t border-hairline/80 flex items-center justify-between text-xs font-mono text-neutral-600">
                        <span>Max: ₹{Number(m.budget_ceiling).toLocaleString()}</span>
                        <span>From {m.joining_city}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Member Constraints (if present in tripDetail) */}
            {tripDetail?.constraints && tripDetail.constraints.length > 0 && (
              <div className="pt-4 border-t border-hairline space-y-3">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-neutral-400 block">
                  Preferences ({tripDetail.constraints.length})
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {tripDetail.constraints.map((c) => (
                    <div
                      key={c.constraint_id}
                      className="p-2.5 rounded-lg bg-surface-soft border border-hairline text-xs flex items-center justify-between"
                    >
                      <span className="font-semibold text-slate-800">{c.full_name}:</span>
                      <span className="font-mono text-xs bg-white px-2 py-0.5 rounded border border-hairline">
                        {c.kind}: {typeof c.value === 'object' ? JSON.stringify(c.value) : c.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Add Traveler Form */}
          <div className="lg:col-span-4 bg-white border border-hairline rounded-2xl p-6 shadow-xs space-y-4 h-fit">
            <div className="flex items-center gap-2 pb-2 border-b border-hairline">
              <UserPlus className="w-4 h-4 text-purple-600" />
              <h4 className="text-sm font-bold text-slate-900">Add Traveler</h4>
            </div>

            <form onSubmit={handleAddMember} className="space-y-3.5">
              <div>
                <label className="text-xs font-mono font-bold text-neutral-500 block mb-1">
                  TRAVELER
                </label>
                <select
                  className="w-full bg-surface-soft border border-hairline rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-black cursor-pointer"
                  value={memberUserId}
                  onChange={(e) => setMemberUserId(e.target.value)}
                  required
                >
                  <option value="">Choose person...</option>
                  {availableUsersToAdd.map((u) => (
                    <option key={u.user_id} value={u.user_id}>
                      {u.full_name} ({u.home_city || 'India'})
                    </option>
                  ))}
                </select>
                {availableUsersToAdd.length === 0 && (
                  <p className="text-[10px] text-neutral-400 mt-1">
                    Everyone is already in this trip.
                  </p>
                )}
              </div>

              <div>
                <label className="text-xs font-mono font-bold text-neutral-500 block mb-1">
                  BUDGET LIMIT (₹)
                </label>
                <input
                  type="number"
                  min="1000"
                  step="500"
                  value={memberBudget}
                  onChange={(e) => setMemberBudget(e.target.value)}
                  className="w-full bg-surface-soft border border-hairline rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-black"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-mono font-bold text-neutral-500 block mb-1">
                  FROM CITY
                </label>
                <input
                  type="text"
                  value={memberCity}
                  onChange={(e) => setMemberCity(e.target.value)}
                  placeholder="e.g. Bengaluru, Mumbai"
                  className="w-full bg-surface-soft border border-hairline rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-black"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={addingMember || !memberUserId}
                className="w-full py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-xs cursor-pointer disabled:opacity-40"
              >
                <Plus className="w-4 h-4" />
                <span>{addingMember ? 'Adding...' : 'Add Traveler'}</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: Create New Trip */}
      {subTab === 'create' && (
        <div className="max-w-2xl mx-auto bg-white border border-hairline rounded-2xl p-6 sm:p-8 shadow-xs space-y-6">
          <div className="pb-3 border-b border-hairline">
            <h3 className="text-lg font-bold text-slate-900">New Trip</h3>
            <p className="text-xs text-neutral-500 mt-0.5">
              Set your trip name, dates, and group approval rule.
            </p>
          </div>

          <form onSubmit={handleCreateTrip} className="space-y-4">
            <div>
              <label className="text-xs font-mono font-bold text-neutral-500 block mb-1">
                TRIP NAME
              </label>
              <input
                type="text"
                placeholder="e.g. Rajasthan Winter 2027"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-surface-soft border border-hairline rounded-xl px-4 py-2.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-black"
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-mono font-bold text-neutral-500 block mb-1">
                  START DATE
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full bg-surface-soft border border-hairline rounded-xl px-4 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-black cursor-pointer"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-mono font-bold text-neutral-500 block mb-1">
                  END DATE
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full bg-surface-soft border border-hairline rounded-xl px-4 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-black cursor-pointer"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-mono font-bold text-neutral-500 block mb-1">
                  APPROVAL NEEDED (%)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={quorumPct}
                    onChange={(e) => setQuorumPct(e.target.value)}
                    className="w-24 bg-surface-soft border border-hairline rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-black"
                    required
                  />
                  <span className="text-xs text-neutral-400 font-mono">% YES votes</span>
                </div>
              </div>

              <div>
                <label className="text-xs font-mono font-bold text-neutral-500 block mb-1">
                  YOUR BUDGET (₹)
                </label>
                <input
                  type="number"
                  min="1000"
                  step="500"
                  value={orgBudget}
                  onChange={(e) => setOrgBudget(e.target.value)}
                  className="w-full bg-surface-soft border border-hairline rounded-xl px-4 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-black"
                  required
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-mono font-bold text-neutral-500 block mb-1">
                DEPARTURE CITY
              </label>
              <input
                type="text"
                value={orgCity}
                onChange={(e) => setOrgCity(e.target.value)}
                placeholder="e.g. Bengaluru"
                className="w-full bg-surface-soft border border-hairline rounded-xl px-4 py-2.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-black"
                required
              />
            </div>

            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setSubTab('directory')}
                className="py-2.5 px-4 text-xs font-semibold text-neutral-600 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating || !title.trim()}
                className="btn-primary text-xs py-2.5 px-6 flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{creating ? 'Creating...' : 'Create Trip'}</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
