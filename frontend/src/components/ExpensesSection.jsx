import React, { useState } from 'react';
import { ArrowRight, CreditCard } from 'lucide-react';
import { apiRequest } from '../api/client';
import { openRazorpayCheckout } from '../api/payment';

export default function ExpensesSection({ activeTripId, tripDetail, finances, onRefresh, notify }) {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState(2400);
  const [payerId, setPayerId] = useState('');
  const [testUnbalanced, setTestUnbalanced] = useState(false);

  async function handleAdd(e) {
    e.preventDefault();
    const pid = Number(payerId || tripDetail?.members?.[0]?.user_id);
    if (!activeTripId || !pid) return;
    try {
      await apiRequest('/api/expenses', {
        method: 'POST',
        body: JSON.stringify({
          trip_id: activeTripId,
          payer_id: pid,
          description,
          amount: Number(amount),
          currency: 'INR',
          fx_to_inr: 1.0,
          rule: 'EQUAL',
          test_unbalanced_ledger: testUnbalanced,
        }),
      });
      setDescription('');
      notify('success', 'Balanced double-entry expense posted.');
      onRefresh(activeTripId);
    } catch (err) {
      notify('error', err.message, err.pgDetail);
    }
  }

  return (
    <div className="color-block bg-block-mint space-y-6">
      <div>
        <span className="eyebrow-mono">FAIR GROUP EXPENSES & BALANCED LEDGER</span>
        <h2 className="display-lg mt-1">Split costs fairly with automated math.</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="editorial-card lg:col-span-2 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(finances?.balances || []).map((b) => (
              <div key={b.user_id} className="rounded-md bg-surface-soft p-3.5 border border-hairline-soft">
                <div className="text-sm font-medium">{b.full_name}</div>
                <div className="text-lg font-bold font-mono mt-0.5">
                  {Number(b.net_balance_inr) >= 0 ? '+' : ''}INR {Number(b.net_balance_inr).toLocaleString()}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2 pt-3 border-t border-hairline-soft">
            <span className="caption-mono block">WHO OWES WHOM</span>
            {(finances?.settlements || []).map((s, idx) => (
              <div key={idx} className="flex items-center justify-between rounded-md bg-surface-soft px-4 py-2.5 text-sm">
                <span className="flex items-center gap-2 font-medium">{s.from_name} <ArrowRight className="w-4 h-4" /> {s.to_name}</span>
                <div className="flex items-center gap-3">
                  <span className="font-mono font-bold">INR {Number(s.amount_inr).toLocaleString()}</span>
                  <button
                    onClick={() => {
                      openRazorpayCheckout({
                        amountInr: Number(s.amount_inr),
                        title: `Debt Clearance: ${s.from_name} to ${s.to_name}`,
                        description: `Trip #${activeTripId} Balanced Settlement`,
                        customerName: s.from_name,
                        onSuccess: (paymentDetails) => {
                          notify('success', `Settlement INR ${Number(s.amount_inr).toLocaleString()} settled (${paymentDetails.payment_id}).`);
                          if (onRefresh) onRefresh(activeTripId);
                        },
                        onFailure: (err) => {
                          notify('error', `Settlement payment declined: ${err.description || 'Simulated error'}`);
                        },
                      });
                    }}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs py-1 px-2.5 rounded flex items-center gap-1 transition-all shadow-xs active:scale-95 cursor-pointer"
                  >
                    <CreditCard className="w-3.5 h-3.5" /> Settle
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="editorial-card space-y-3 h-fit">
          <span className="caption-mono">ADD EXPENSE</span>
          <form onSubmit={handleAdd} className="space-y-3">
            <input className="field-input" placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} required />
            <input className="field-input" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            <select className="field-input" value={payerId || tripDetail?.members?.[0]?.user_id || ''} onChange={(e) => setPayerId(e.target.value)}>
              {(tripDetail?.members || []).map((m) => <option key={m.user_id} value={m.user_id}>Paid by {m.full_name}</option>)}
            </select>
            <div className="text-[11px] text-black/50 bg-surface-soft p-2.5 rounded-md font-mono">
              Split Policy: Automatically split equally across all active group members with balanced ledger integrity.
            </div>
            <button type="submit" className="btn-primary w-full">Post Expense</button>
          </form>
        </div>
      </div>
    </div>
  );
}
