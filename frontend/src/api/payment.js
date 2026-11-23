/**
 * Yatra Razorpay Payment Gateway Service
 * 
 * Handles opening the visible Razorpay checkout modal for user purchases.
 * Works seamlessly with real Razorpay Checkout SDK (Test Mode) and provides
 * an embedded fallback modal if offline or on restricted Wi-Fi.
 */

export function openRazorpayCheckout({
  amountInr,
  title,
  description,
  customerName = 'Arya Wadhwa',
  customerEmail = 'arya@yatra.local',
  customerPhone = '+919876543210',
  onSuccess,
  onFailure,
  onDismiss,
}) {
  const amountPaise = Math.round(Number(amountInr) * 100);

  // Check if official Razorpay checkout script loaded
  if (typeof window !== 'undefined' && window.Razorpay) {
    try {
      const options = {
        key: 'rzp_test_1DP5mmOlF5G5ag', // Public standard Razorpay sandbox test key
        amount: amountPaise,
        currency: 'INR',
        name: 'Yatra · Travel Platform',
        description: description || title,
        image: 'https://cdn-icons-png.flaticon.com/512/201/201623.png',
        handler: function (response) {
          if (onSuccess) {
            onSuccess({
              payment_id: response.razorpay_payment_id || `pay_${Date.now()}`,
              order_id: response.razorpay_order_id || `order_${Date.now()}`,
              signature: response.razorpay_signature || 'test_sig',
              amount_inr: amountInr,
            });
          }
        },
        prefill: {
          name: customerName,
          email: customerEmail,
          contact: customerPhone,
        },
        notes: {
          platform: 'Yatra DBMS CD252IA',
          item: title,
        },
        theme: {
          color: '#161b22', // Yatra brand theme
        },
        modal: {
          ondismiss: function () {
            if (onDismiss) onDismiss();
          },
        },
      };

      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', function (response) {
        if (onFailure) {
          onFailure(response.error || { description: 'Payment declined by bank.' });
        }
      });
      rzp.open();
      return;
    } catch (err) {
      console.warn('Razorpay SDK error, falling back to embedded checkout modal', err);
    }
  }

  // Fallback: If external script is blocked by network, launch interactive Razorpay modal
  launchFallbackModal({
    amountInr,
    title,
    description,
    customerName,
    onSuccess,
    onFailure,
    onDismiss,
  });
}

function launchFallbackModal({
  amountInr,
  title,
  description,
  customerName,
  onSuccess,
  onFailure,
  onDismiss,
}) {
  // Remove existing modal if any
  const existing = document.getElementById('yatra-rzp-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'yatra-rzp-modal';
  overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200';

  overlay.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden text-slate-800 font-sans border border-slate-200">
      <!-- Header -->
      <div class="bg-slate-900 text-white p-5 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-orange-500/20 text-orange-400 font-black text-lg flex items-center justify-center border border-orange-500/30">
            या
          </div>
          <div>
            <div class="font-bold text-base flex items-center gap-2">
              Yatra Payment Gateway
              <span class="text-[10px] bg-emerald-500/20 text-emerald-300 font-mono px-2 py-0.5 rounded-full border border-emerald-500/30">RAZORPAY TEST</span>
            </div>
            <div class="text-xs text-slate-400 font-mono">Secured with 256-bit encryption</div>
          </div>
        </div>
        <button id="rzp-close-btn" class="text-slate-400 hover:text-white text-xl p-1 transition-colors">✕</button>
      </div>

      <!-- Amount Banner -->
      <div class="bg-slate-50 border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div>
          <div class="text-xs text-slate-500 uppercase tracking-wider font-semibold font-mono">Amount Payable</div>
          <div class="text-2xl font-black text-slate-900 mt-0.5">₹${Number(amountInr).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
        </div>
        <div class="text-right">
          <div class="text-xs font-semibold text-slate-700">${title || 'Tour Item'}</div>
          <div class="text-[11px] text-slate-500 max-w-[180px] truncate">${description || 'Group Travel Item'}</div>
        </div>
      </div>

      <!-- Payment Methods Body -->
      <div class="p-6 space-y-4">
        <div class="text-xs font-mono uppercase text-slate-500 tracking-wider">Select Payment Method</div>

        <!-- UPI / QR -->
        <div class="p-3.5 rounded-xl border-2 border-orange-500/40 bg-orange-500/5 flex items-center justify-between cursor-pointer">
          <div class="flex items-center gap-3">
            <span class="text-2xl">📱</span>
            <div>
              <div class="text-sm font-bold text-slate-900">UPI / QR (Instant)</div>
              <div class="text-xs text-slate-500 font-mono">Google Pay, PhonePe, Paytm, BHIM</div>
            </div>
          </div>
          <span class="text-xs font-bold text-orange-600 bg-orange-100 px-2 py-1 rounded-md">Default</span>
        </div>

        <!-- Cards -->
        <div class="p-3.5 rounded-xl border border-slate-200 hover:border-slate-300 bg-white flex items-center justify-between opacity-80 cursor-pointer">
          <div class="flex items-center gap-3">
            <span class="text-2xl">💳</span>
            <div>
              <div class="text-sm font-semibold text-slate-900">Cards (Debit / Credit)</div>
              <div class="text-xs text-slate-400 font-mono">Visa, MasterCard, RuPay</div>
            </div>
          </div>
        </div>

        <!-- Netbanking -->
        <div class="p-3.5 rounded-xl border border-slate-200 hover:border-slate-300 bg-white flex items-center justify-between opacity-80 cursor-pointer">
          <div class="flex items-center gap-3">
            <span class="text-2xl">🏦</span>
            <div>
              <div class="text-sm font-semibold text-slate-900">Net Banking</div>
              <div class="text-xs text-slate-400 font-mono">All Indian Banks Supported</div>
            </div>
          </div>
        </div>

        <div class="text-[11px] text-slate-500 bg-slate-100 p-2.5 rounded-lg border border-slate-200 text-center font-mono">
          🔒 System reservation lock is active while payment is being authorized.
        </div>

        <!-- Actions for evaluation demo -->
        <div class="pt-2 grid grid-cols-2 gap-3">
          <button id="rzp-pay-success" class="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-sm rounded-xl transition-all shadow-md flex items-center justify-center gap-1.5">
            <span>✅ Authorize Payment</span>
          </button>
          <button id="rzp-pay-fail" class="w-full py-3 px-4 bg-rose-50 hover:bg-rose-100 active:scale-95 text-rose-700 border border-rose-200 font-semibold text-xs rounded-xl transition-all flex items-center justify-center gap-1">
            <span>❌ Simulate Card Decline</span>
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Event handlers
  const closeBtn = overlay.querySelector('#rzp-close-btn');
  const successBtn = overlay.querySelector('#rzp-pay-success');
  const failBtn = overlay.querySelector('#rzp-pay-fail');

  function cleanup() {
    overlay.remove();
  }

  closeBtn.onclick = () => {
    cleanup();
    if (onDismiss) onDismiss();
  };

  successBtn.onclick = () => {
    cleanup();
    const fakePaymentId = `pay_rzp_${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
    const fakeOrderId = `order_rzp_${Math.random().toString(36).substring(2, 10)}`;
    if (onSuccess) {
      onSuccess({
        payment_id: fakePaymentId,
        order_id: fakeOrderId,
        amount_inr: amountInr,
      });
    }
  };

  failBtn.onclick = () => {
    cleanup();
    if (onFailure) {
      onFailure({
        code: 'BAD_REQUEST_ERROR',
        description: 'Payment was declined by user testing failure mode.',
      });
    }
  };
}

