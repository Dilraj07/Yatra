import React, { useState } from 'react';
import { Lock, CreditCard, CheckCircle2 } from 'lucide-react';
import { apiRequest } from '../api/client';
import { openRazorpayCheckout } from '../api/payment';

export default function OperatorSection({ slots, holds, onRefresh, notify }) {
  const [holdSeatsMap, setHoldSeatsMap] = useState({});
  const [lastPayment, setLastPayment] = useState(null);

  function handleBuyWithRazorpay(slot) {
    const seats = Number(holdSeatsMap[slot.slot_id] || 5);
    const unitPrice = Number(slot.price_inr || 750);
    const totalAmount = seats * unitPrice;

    openRazorpayCheckout({
      amountInr: totalAmount,
      title: `${slot.poi_name} — Timed Entry`,
      description: `${slot.circuit} · ${seats} tickets @ ₹${unitPrice.toLocaleString()}`,
      onSuccess: async (paymentDetails) => {
        setLastPayment(paymentDetails);
        try {
          await apiRequest('/api/inventory/holds', {
            method: 'POST',
            body: JSON.stringify({ slot_id: slot.slot_id, seats }),
          });
          notify(
            'success',
            `Booked ${seats} tickets for ₹${totalAmount.toLocaleString()} (${paymentDetails.payment_id}).`
          );
          if (onRefresh) onRefresh();
        } catch (err) {
          notify(
            'success',
            `Payment ₹${totalAmount.toLocaleString()} confirmed (${paymentDetails.payment_id}).`
          );
        }
      },
      onFailure: (err) => {
        notify(
          'error',
          `Payment failed (${err.description || 'Declined'}).`
        );
      },
    });
  }

  async function handleHold(slotId) {
    const seats = Number(holdSeatsMap[slotId] || 5);
    try {
      await apiRequest('/api/inventory/holds', {
        method: 'POST',
        body: JSON.stringify({ slot_id: slotId, seats }),
      });
      notify('success', `Reserved ${seats} tickets.`);
      onRefresh();
    } catch (err) {
      notify('error', err.message, err.pgDetail);
    }
  }

  async function handleRelease(holdId) {
    try {
      await apiRequest(`/api/inventory/holds/${holdId}/release`, { method: 'POST' });
      notify('success', 'Reservation cancelled.');
      onRefresh();
    } catch (err) {
      notify('error', err.message, err.pgDetail);
    }
  }

  return (
    <div className="color-block bg-block-coral space-y-6">
      <div>
        <h2 className="display-lg">Entry Tickets</h2>
        <p className="text-xs text-ink/70 mt-1">Reserve or buy timed entry passes for sights and monuments.</p>
      </div>

      <div className="space-y-4">
        <div className="editorial-card space-y-2.5">
          {slots.map((s) => (
            <div key={s.slot_id} className="rounded-md bg-surface-soft p-3.5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-bold text-sm">{s.poi_name} · {s.circuit}</div>
                <div className="text-xs font-mono">{s.city} · ₹{Number(s.price_inr).toLocaleString()}</div>
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
                <button onClick={() => handleHold(s.slot_id)} className="btn-secondary text-xs py-1.5 px-3">
                  <Lock className="w-3.5 h-3.5" /> Reserve
                </button>
                <button
                  onClick={() => handleBuyWithRazorpay(s)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs py-1.5 px-3 rounded flex items-center gap-1.5 transition-all shadow-xs active:scale-95 cursor-pointer"
                >
                  <CreditCard className="w-3.5 h-3.5" /> Buy Ticket
                </button>
              </div>
            </div>
          ))}
        </div>

        {lastPayment && (
          <div className="rounded-lg bg-emerald-950/80 border border-emerald-500/40 p-4 text-emerald-100 flex items-center justify-between gap-3 animate-in fade-in">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <div>
                <div className="font-bold text-sm text-white">Tickets Confirmed</div>
                <div className="text-xs font-mono text-emerald-300">
                  Payment ID: {lastPayment.payment_id} · ₹{Number(lastPayment.amount_inr).toLocaleString()}
                </div>
              </div>
            </div>
            <button
              onClick={() => setLastPayment(null)}
              className="text-xs text-emerald-300 hover:text-white px-2 py-1 rounded bg-emerald-900/50"
            >
              Dismiss
            </button>
          </div>
        )}

        {holds.length > 0 && (
          <div className="editorial-card space-y-2">
            <span className="caption-mono">YOUR RESERVATIONS</span>
            {holds.slice(0, 5).map((h) => (
              <div key={h.hold_id} className="flex justify-between items-center text-sm py-1.5 border-b border-hairline-soft">
                <span>{h.poi_name} ({h.seats} tickets) · {h.state}</span>
                {h.state === 'HELD' && (
                  <button onClick={() => handleRelease(h.hold_id)} className="btn-secondary text-xs py-1 px-3">Cancel</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
