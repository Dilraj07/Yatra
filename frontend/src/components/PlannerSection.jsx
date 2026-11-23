import React, { useState } from 'react';
import { Sparkles, CalendarClock } from 'lucide-react';
import { apiRequest } from '../api/client';

export default function PlannerSection({ activeTripId, tripDetail, itineraries, slots, onRefresh, notify }) {
  const [prompt, setPrompt] = useState('Plan a 3-day Goa & Hampi trip with Virupaksha heritage viewing under 25000 INR');
  const [injectOverlap, setInjectOverlap] = useState(true);
  const [aiTrace, setAiTrace] = useState(null);
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
        body: JSON.stringify({ trip_id: activeTripId, prompt, inject_overlap_test: injectOverlap }),
      });
      setAiTrace(res);
      notify('success', `Drafted Itinerary v${res.itinerary.version} (${res.engine}).`);
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
      notify('success', 'Leg added cleanly.');
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
      notify('success', `Proposal opened for Itinerary #${itineraryId}.`);
      onRefresh(activeTripId);
    } catch (err) {
      notify('error', err.message, err.pgDetail);
    }
  }

  return (
    <div className="color-block bg-block-lilac space-y-6">
      <div>
        <span className="eyebrow-mono">AI ITINERARY GENERATOR</span>
        <h2 className="display-lg mt-1">Draft plans with conflict-free scheduling.</h2>
      </div>

      <div className="editorial-card space-y-4">
        <form onSubmit={handleAiDraft} className="flex flex-col md:flex-row gap-3">
          <input className="field-input flex-1" value={prompt} onChange={(e) => setPrompt(e.target.value)} required />
          <button type="submit" disabled={loading} className="btn-magenta shrink-0">
            <Sparkles className="w-4 h-4" /> {loading ? 'Drafting...' : 'Draft with AI'}
          </button>
        </form>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input type="checkbox" checked={injectOverlap} onChange={(e) => setInjectOverlap(e.target.checked)} className="accent-black" />
          <span>Enable smart schedule conflict check</span>
        </label>

        {aiTrace && (
          <div className="rounded-md bg-surface-soft p-3 space-y-1.5 font-mono text-xs">
            {aiTrace.self_correction_trace.map((t, i) => (
              <div key={i} className={t.status === 'rejected_by_postgres' ? 'bg-block-pink p-1.5 rounded-xs' : 'p-1'}>
                <strong>[{t.step}]</strong> {t.status || t.engine} {t.sqlstate ? `(${t.sqlstate})` : ''} {t.self_correction || t.title || ''}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {itineraries.map((it) => (
            <div key={it.itinerary_id} className="editorial-card space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-hairline-soft">
                <div>
                  <span className="caption-mono">ITINERARY #{it.itinerary_id} · v{it.version} · {it.status}</span>
                  <p className="text-sm font-medium">{it.summary}</p>
                </div>
                {it.status === 'DRAFT' && (
                  <button onClick={() => handleSendToVote(it.itinerary_id)} className="btn-primary text-xs py-1.5 px-4">
                    Send to Vote
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
                    <span className="font-mono font-medium">INR {Number(leg.est_cost_inr).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="editorial-card space-y-3 h-fit">
          <span className="caption-mono">QUICK ACTIVITY SCHEDULER</span>
          <p className="text-xs">Adds an activity to the current plan. Overlapping time slots are automatically prevented.</p>
          <form onSubmit={handleQuickLeg} className="space-y-2.5">
            <input className="field-input" value={legTitle} onChange={(e) => setLegTitle(e.target.value)} required />
            <input className="field-input" type="datetime-local" value={spanStart} onChange={(e) => setSpanStart(e.target.value)} required />
            <input className="field-input" type="datetime-local" value={spanEnd} onChange={(e) => setSpanEnd(e.target.value)} required />
            <input className="field-input" type="number" value={legCost} onChange={(e) => setLegCost(e.target.value)} />
            <button type="submit" className="btn-primary w-full">Insert Leg</button>
          </form>
        </div>
      </div>
    </div>
  );
}
