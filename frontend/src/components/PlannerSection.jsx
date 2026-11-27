import React, { useState } from 'react';
import { Sparkles, CalendarClock } from 'lucide-react';
import { apiRequest } from '../api/client';

export default function PlannerSection({ activeTripId, tripDetail, itineraries, onRefresh, notify }) {
  const [prompt, setPrompt] = useState('Plan a 3-day Goa & Hampi trip under 25000 INR');
  const [loading, setLoading] = useState(false);

  const [legTitle, setLegTitle] = useState('Palolem Beach Kayaking & Heritage Tour');
  const [spanStart, setSpanStart] = useState('2026-12-18T08:00');
  const [spanEnd, setSpanEnd] = useState('2026-12-18T09:30');
  const [legCost, setLegCost] = useState(1200);

  async function handleAiDraft(e) {
    e.preventDefault();
    if (!activeTripId) return;
    setLoading(true);
    try {
      const res = await apiRequest('/api/itineraries/ai-draft', {
        method: 'POST',
        body: JSON.stringify({ trip_id: activeTripId, prompt, inject_overlap_test: false }),
      });
      notify('success', `Created Plan v${res.itinerary.version}.`);
      onRefresh(activeTripId);
    } catch (err) {
      notify('error', err.message, err.pgDetail);
    } finally {
      setLoading(false);
    }
  }

  async function handleQuickLeg(e) {
    e.preventDefault();
    const itinId = itineraries[0]?.itinerary_id;
    if (!itinId) return;
    try {
      await apiRequest(`/api/itineraries/${itinId}/legs`, {
        method: 'POST',
        body: JSON.stringify({
          kind: 'ACTIVITY',
          title: legTitle,
          span_start: new Date(spanStart).toISOString(),
          span_end: new Date(spanEnd).toISOString(),
          est_cost_inr: Number(legCost),
          participant_ids: (tripDetail?.members || []).map((m) => m.user_id),
        }),
      });
      notify('success', 'Activity added.');
      onRefresh(activeTripId);
    } catch (err) {
      notify('error', err.message, err.pgDetail);
    }
  }

  async function handleSendToVote(itineraryId) {
    try {
      await apiRequest('/api/voting/proposals', {
        method: 'POST',
        body: JSON.stringify({ trip_id: activeTripId, itinerary_id: itineraryId }),
      });
      notify('success', 'Shared with the group for approval.');
      onRefresh(activeTripId);
    } catch (err) {
      notify('error', err.message, err.pgDetail);
    }
  }

  return (
    <div className="color-block bg-block-lilac space-y-6">
      <div>
        <h2 className="display-lg">Itinerary</h2>
        <p className="text-xs text-ink/70 mt-1">Generate a trip plan or add activities without schedule conflicts.</p>
      </div>

      <div className="editorial-card">
        <form onSubmit={handleAiDraft} className="flex flex-col md:flex-row gap-3">
          <input className="field-input flex-1" value={prompt} onChange={(e) => setPrompt(e.target.value)} required />
          <button type="submit" disabled={loading} className="btn-magenta shrink-0">
            <Sparkles className="w-4 h-4" /> {loading ? 'Generating...' : 'Generate Plan'}
          </button>
        </form>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {itineraries.map((it) => (
            <div key={it.itinerary_id} className="editorial-card space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-hairline-soft">
                <div>
                  <span className="caption-mono">Plan v{it.version} · {it.status}</span>
                  <p className="text-sm font-medium">{it.summary}</p>
                </div>
                {it.status === 'DRAFT' && (
                  <button onClick={() => handleSendToVote(it.itinerary_id)} className="btn-primary text-xs py-1.5 px-4">
                    Request Approval
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {it.legs.map((leg) => (
                  <div key={leg.leg_id} className="rounded-md bg-surface-soft p-3 flex justify-between items-center gap-3 text-sm">
                    <div>
                      <span className="caption-mono bg-primary text-white px-1.5 py-0.5 rounded-xs mr-2">{leg.kind}</span>
                      <span className="font-medium">{leg.title}</span>
                      <div className="text-xs font-mono mt-0.5 flex items-center gap-1">
                        <CalendarClock className="w-3.5 h-3.5" />
                        {new Date(leg.span_start).toLocaleString()} → {new Date(leg.span_end).toLocaleTimeString()}
                      </div>
                    </div>
                    <span className="font-mono font-medium">₹{Number(leg.est_cost_inr).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="editorial-card space-y-3 h-fit">
          <span className="caption-mono">ADD ACTIVITY</span>
          <p className="text-xs text-ink/70">Overlapping times are automatically blocked.</p>
          <form onSubmit={handleQuickLeg} className="space-y-2.5">
            <input className="field-input" value={legTitle} onChange={(e) => setLegTitle(e.target.value)} required />
            <input className="field-input" type="datetime-local" value={spanStart} onChange={(e) => setSpanStart(e.target.value)} required />
            <input className="field-input" type="datetime-local" value={spanEnd} onChange={(e) => setSpanEnd(e.target.value)} required />
            <input className="field-input" type="number" value={legCost} onChange={(e) => setLegCost(e.target.value)} />
            <button type="submit" className="btn-primary w-full">Add Activity</button>
          </form>
        </div>
      </div>
    </div>
  );
}
