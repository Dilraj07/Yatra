import React, { useState } from 'react';
import { Users, Plus } from 'lucide-react';
import { apiRequest } from '../api/client';

export default function TripsSection({ trips, activeTripId, setActiveTripId, tripDetail, allUsers, onRefresh, notify }) {
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('2026-12-22');
  const [endDate, setEndDate] = useState('2026-12-25');
  const [quorumPct, setQuorumPct] = useState(67);
  const [orgBudget, setOrgBudget] = useState(18000);
  const [orgCity, setOrgCity] = useState('Bengaluru');

  const [memberUserId, setMemberUserId] = useState('');
  const [memberBudget, setMemberBudget] = useState(15000);
  const [memberCity, setMemberCity] = useState('Bengaluru');

  async function handleCreateTrip(e) {
    e.preventDefault();
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
      notify('success', `Created trip "${created.title}".`);
      onRefresh(created.trip_id);
    } catch (err) {
      notify('error', err.message, err.pgDetail);
    }
  }

  async function handleAddMember(e) {
    e.preventDefault();
    if (!activeTripId || !memberUserId) return;
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
      notify('success', 'Member added to trip.');
      onRefresh(activeTripId);
    } catch (err) {
      notify('error', err.message, err.pgDetail);
    }
  }

  return (
    <div className="color-block bg-block-lime space-y-6">
      <div>
        <span className="eyebrow-mono">TRIP SETTINGS & TRAVELERS</span>
        <h2 className="display-lg mt-1">Manage your group and quorum threshold.</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="editorial-card lg:col-span-2 space-y-5">
          {tripDetail ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-hairline-soft">
                <div>
                  <span className="caption-mono">TRIP #{tripDetail.trip.trip_id} · {tripDetail.trip.status}</span>
                  <h3 className="text-xl font-bold">{tripDetail.trip.title}</h3>
                  <p className="text-sm">{tripDetail.trip.start_date} to {tripDetail.trip.end_date} · Quorum {tripDetail.trip.quorum_pct}%</p>
                </div>
              </div>

              <div className="space-y-2.5">
                <div className="flex items-center gap-2"><Users className="w-4 h-4" /><span className="caption-mono">MEMBERS ({tripDetail.members.length})</span></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {tripDetail.members.map((m) => (
                    <div key={m.user_id} className="rounded-md bg-surface-soft p-3 border border-hairline-soft">
                      <div className="flex justify-between items-center">
                        <span className="font-medium text-sm">{m.full_name}</span>
                        <span className="caption-mono px-2 py-0.5 bg-canvas rounded-pill border border-hairline">{m.role}</span>
                      </div>
                      <p className="text-xs font-mono mt-1">Budget INR {Number(m.budget_ceiling).toLocaleString()} · {m.joining_city}</p>
                    </div>
                  ))}
                </div>
              </div>

              <form onSubmit={handleAddMember} className="pt-4 border-t border-hairline-soft grid grid-cols-1 sm:grid-cols-4 gap-2.5 items-end">
                <div>
                  <label className="caption-mono block mb-1">User</label>
                  <select className="field-input" value={memberUserId} onChange={(e) => setMemberUserId(e.target.value)} required>
                    <option value="">Select...</option>
                    {allUsers.map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="caption-mono block mb-1">Budget</label>
                  <input className="field-input" type="number" value={memberBudget} onChange={(e) => setMemberBudget(e.target.value)} required />
                </div>
                <div>
                  <label className="caption-mono block mb-1">City</label>
                  <input className="field-input" value={memberCity} onChange={(e) => setMemberCity(e.target.value)} required />
                </div>
                <button type="submit" className="btn-primary text-sm py-2.5"><Plus className="w-4 h-4" /> Add</button>
              </form>
            </>
          ) : (
            <p>Create or select a trip to begin.</p>
          )}
        </div>

        <div className="editorial-card space-y-3.5 h-fit">
          <span className="caption-mono">NEW TRIP</span>
          <form onSubmit={handleCreateTrip} className="space-y-3">
            <input className="field-input" placeholder="Trip title (e.g., Hampi Weekend)" value={title} onChange={(e) => setTitle(e.target.value)} required />
            <div className="grid grid-cols-2 gap-2">
              <input className="field-input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
              <input className="field-input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className="field-input" type="number" min="1" max="100" value={quorumPct} onChange={(e) => setQuorumPct(e.target.value)} placeholder="Quorum %" required />
              <input className="field-input" type="number" value={orgBudget} onChange={(e) => setOrgBudget(e.target.value)} placeholder="Budget" required />
            </div>
            <input className="field-input" value={orgCity} onChange={(e) => setOrgCity(e.target.value)} placeholder="Your city" required />
            <button type="submit" className="btn-primary w-full">Create Trip</button>
          </form>
        </div>
      </div>
    </div>
  );
}
