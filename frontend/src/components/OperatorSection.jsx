import React, { useState } from 'react';
import { Lock, PlusCircle } from 'lucide-react';
import { apiRequest } from '../api/client';

export default function OperatorSection({ pois, slots, holds, onRefresh, notify }) {
  const [poiId, setPoiId] = useState('');
  const [circuit, setCircuit] = useState('Batch 5 (22:30 - 23:00)');
  const [windowStart, setWindowStart] = useState('2026-12-18T22:30');
  const [windowEnd, setWindowEnd] = useState('2026-12-18T23:00');
  const [capacity, setCapacity] = useState(50);
  const [priceInr, setPriceInr] = useState(750);
  const [holdSeatsMap, setHoldSeatsMap] = useState({});

  async function handleCreateSlot(e) {
    e.preventDefault();
    const pid = Number(poiId || pois[0]?.poi_id);
    if (!pid) return;
    try {
      await apiRequest('/api/inventory/slots', {
        method: 'POST',
        body: JSON.stringify({
          poi_id: pid,
          circuit,
          window_start: new Date(windowStart).toISOString(),
          window_end: new Date(windowEnd).toISOString(),
          capacity_total: Number(capacity),
          price_inr: Number(priceInr),
        }),
      });
      notify('success', `Published slot "${circuit}".`);
      onRefresh();
    } catch (err) {
      notify('error', err.message, err.pgDetail);
    }
  }

  async function handleHold(slotId) {
    const seats = Number(holdSeatsMap[slotId] || 5);
    try {
      await apiRequest('/api/inventory/holds', {
        method: 'POST',
        body: JSON.stringify({ slot_id: slotId, seats }),
      });
      notify('success', `Held ${seats} seats on Slot #${slotId}.`);
      onRefresh();
    } catch (err) {
      notify('error', err.message, err.pgDetail);
    }
  }

  async function handleRelease(holdId) {
    try {
      await apiRequest(`/api/inventory/holds/${holdId}/release`, { method: 'POST' });
      notify('success', `Released Hold #${holdId}.`);
      onRefresh();
    } catch (err) {
      notify('error', err.message, err.pgDetail);
    }
  }

  return (
    <div className="color-block bg-block-coral space-y-6">
      <div>
        <span className="eyebrow-mono">HERITAGE TICKETS & CAPACITY MANAGEMENT</span>
        <h2 className="display-lg mt-1">Timed heritage slots with zero overselling.</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="editorial-card space-y-2.5">
            {slots.map((s) => (
              <div key={s.slot_id} className="rounded-md bg-surface-soft p-3.5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-bold text-sm">{s.poi_name} · {s.circuit}</div>
                  <div className="text-xs font-mono">{s.city} · INR {Number(s.price_inr).toLocaleString()}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="caption-mono px-2.5 py-1 rounded-pill bg-canvas border border-hairline">
                    {s.seats_taken}/{s.capacity_total}
                  </span>
                  <input
                    type="number"
                    min="1"
                    className="w-16 field-input py-1 px-2 text-sm text-center"
                    value={holdSeatsMap[s.slot_id] ?? 5}
                    onChange={(e) => setHoldSeatsMap({ ...holdSeatsMap, [s.slot_id]: e.target.value })}
                  />
                  <button onClick={() => handleHold(s.slot_id)} className="btn-primary text-xs py-1.5 px-3"><Lock className="w-3.5 h-3.5" /> Hold</button>
                </div>
              </div>
            ))}
          </div>

          {holds.length > 0 && (
            <div className="editorial-card space-y-2">
              <span className="caption-mono">ACTIVE & RECENT HOLDS</span>
              {holds.slice(0, 5).map((h) => (
                <div key={h.hold_id} className="flex justify-between items-center text-sm py-1.5 border-b border-hairline-soft">
                  <span>#{h.hold_id} · {h.poi_name} ({h.seats} seats) · {h.state}</span>
                  {h.state === 'HELD' && (
                    <button onClick={() => handleRelease(h.hold_id)} className="btn-secondary text-xs py-1 px-3">Release</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="editorial-card space-y-3 h-fit">
          <span className="caption-mono">PUBLISH SLOT</span>
          <form onSubmit={handleCreateSlot} className="space-y-2.5">
            <select className="field-input" value={poiId || pois[0]?.poi_id || ''} onChange={(e) => setPoiId(e.target.value)}>
              {pois.filter((p) => p.capacity_managed).map((p) => <option key={p.poi_id} value={p.poi_id}>{p.name}</option>)}
            </select>
            <input className="field-input" value={circuit} onChange={(e) => setCircuit(e.target.value)} required />
            <input className="field-input" type="datetime-local" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} required />
            <input className="field-input" type="datetime-local" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} required />
            <div className="grid grid-cols-2 gap-2">
              <input className="field-input" type="number" min="1" value={capacity} onChange={(e) => setCapacity(e.target.value)} required />
              <input className="field-input" type="number" min="0" value={priceInr} onChange={(e) => setPriceInr(e.target.value)} required />
            </div>
            <button type="submit" className="btn-primary w-full"><PlusCircle className="w-4 h-4" /> Publish</button>
          </form>
        </div>
      </div>
    </div>
  );
}
