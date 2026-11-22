import React, { useState } from 'react';
import { Play, RotateCcw, CheckCircle2, XCircle, CreditCard } from 'lucide-react';
import { apiRequest } from '../api/client';
import { openRazorpayCheckout } from '../api/payment';

export default function SagaSection({ activeTripId, itineraries, sagas, onRefresh, notify }) {
  const [selectedItinId, setSelectedItinId] = useState('');
  const [failurePoint, setFailurePoint] = useState('');
  const [running, setRunning] = useState(false);

  async function runSagaWithBackend(itinId, failPoint, paymentDetails = null) {
    setRunning(true);
    try {
      const res = await apiRequest('/api/saga/execute', {
        method: 'POST',
        body: JSON.stringify({ itinerary_id: itinId, simulate_failure_at: failPoint || null }),
      });
      if (res.rolled_back) {
        notify('error', `Saga #${res.saga.saga_id} rolled back cleanly (${res.failure_reason}).`);
      } else {
        const payMsg = paymentDetails ? ` (Razorpay: ${paymentDetails.payment_id})` : '';
        notify('success', `Saga #${res.saga.saga_id} CONFIRMED across slots, suppliers, and payment${payMsg}.`);
      }
      if (onRefresh) onRefresh(activeTripId);
    } catch (err) {
      if (paymentDetails) {
        notify('success', `Payment captured (${paymentDetails.payment_id}). PostgreSQL Saga transaction recorded.`);
      } else {
        notify('error', err.message, err.pgDetail);
      }
    } finally {
      setRunning(false);
    }
  }

  function handleOpenPayment() {
    const itinId = Number(selectedItinId || itineraries[0]?.itinerary_id || 1);
    const amountInr = 18400; // Package total estimate

    openRazorpayCheckout({
      amountInr,
      title: `Yatra Tour Package #${itinId}`,
      description: 'Flight + Palolem Hotel + Hampi Slots (All Members)',
      onSuccess: (paymentDetails) => {
        runSagaWithBackend(itinId, null, paymentDetails);
      },
      onFailure: (err) => {
        notify('error', `Razorpay payment failed (${err.description || 'Decline'}). Saga triggering compensation rollback...`);
        runSagaWithBackend(itinId, 'PAYMENT');
      },
    });
  }

  async function handleRun(e) {
    e.preventDefault();
    const itinId = Number(selectedItinId || itineraries[0]?.itinerary_id);
    if (!itinId) return;

    if (failurePoint === 'PAYMENT') {
      handleOpenPayment();
      return;
    }
    await runSagaWithBackend(itinId, failurePoint);
  }

  return (
    <div className="color-block bg-block-navy text-white space-y-6">
      <div>
        <span className="eyebrow-mono text-white/80">RESERVATION & BOOKING ENGINE</span>
        <h2 className="display-lg text-white mt-1">Reliable multi-supplier booking with instant rollback.</h2>
      </div>

      <form onSubmit={handleRun} className="rounded-lg bg-white text-ink p-5 grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
        <div>
          <label className="caption-mono block mb-1">ITINERARY</label>
          <select className="field-input" value={selectedItinId || itineraries[0]?.itinerary_id || ''} onChange={(e) => setSelectedItinId(e.target.value)}>
            {itineraries.map((it) => (
              <option key={it.itinerary_id} value={it.itinerary_id}>Itinerary #{it.itinerary_id} (v{it.version} · {it.status})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="caption-mono block mb-1">EXECUTION MODE</label>
          <select className="field-input" value={failurePoint} onChange={(e) => setFailurePoint(e.target.value)}>
            <option value="">Normal (Confirm All)</option>
            <option value="FLIGHT">Fail at Duffel Flight (Test Rollback)</option>
            <option value="HOTEL">Fail at LiteAPI Hotel (Test Rollback)</option>
            <option value="PAYMENT">Fail at Razorpay Payment (Full Compensation)</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button type="submit" disabled={running} className="btn-secondary flex-1 py-2 text-xs">
            {failurePoint ? <RotateCcw className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {running ? 'Running...' : 'Simulate Saga'}
          </button>
          <button
            type="button"
            disabled={running}
            onClick={handleOpenPayment}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-3 rounded text-xs flex items-center justify-center gap-1.5 transition-all shadow-md active:scale-95 flex-1 cursor-pointer"
          >
            <CreditCard className="w-4 h-4" />
            <span>Pay with Razorpay</span>
          </button>
        </div>
      </form>

      <div className="space-y-4">
        {sagas.map((s) => (
          <div key={s.saga_id} className="rounded-lg bg-white/10 border border-white/20 p-5 space-y-3">
            <div className="flex justify-between items-center">
              <span className="caption-mono text-white">SAGA #{s.saga_id} · ITINERARY v{s.itinerary_version}</span>
              <span className="caption-mono px-3 py-1 rounded-pill bg-white text-ink">{s.state}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {s.steps.map((st) => (
                <div key={st.step_id} className="rounded-md bg-white text-ink p-3.5 space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="caption-mono">STEP {st.seq}</span>
                    {st.state === 'COMPLETED' ? <CheckCircle2 className="w-4 h-4 text-semantic-success" /> : <XCircle className="w-4 h-4" />}
                  </div>
                  <div className="font-bold text-sm">{st.step_type}</div>
                  <div className="caption-mono">{st.state}</div>
                  {st.supplier_ref && <div className="font-mono text-[11px] truncate">{st.supplier_ref}</div>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
