import React, { useState } from 'react';
import { X, Check } from 'lucide-react';
import { SignIn, useUser, useClerk } from '@clerk/react';
import { apiRequest, setAuthSession } from '../api/client';

export default function AuthModal({ open, onClose, onAuthSuccess, hasClerk = true }) {
  const [activeTab, setActiveTab] = useState('clerk'); // 'clerk' | 'demo'

  // Demo account states
  const [demoMode, setDemoMode] = useState('login');
  const [email, setEmail] = useState('dilraj@yatra.local');
  const [password, setPassword] = useState('yatra123');
  const [fullName, setFullName] = useState('');
  const [homeCity, setHomeCity] = useState('Bengaluru');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Clerk hook data
  const { isLoaded: clerkLoaded, isSignedIn: clerkSignedIn, user: clerkUser } = useUser();
  const { signOut: clerkSignOut } = useClerk();

  if (!open) return null;

  async function handleDemoSubmit(e) {
    if (e) e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const endpoint = demoMode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body = demoMode === 'login'
        ? { email, password }
        : { email, password, full_name: fullName, home_city: homeCity };
      const res = await apiRequest(endpoint, { method: 'POST', body: JSON.stringify(body) });
      setAuthSession(res.access_token, res.user);
      onAuthSuccess(res.user);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleQuickLogin(quickEmail) {
    setError('');
    setLoading(true);
    try {
      const res = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: quickEmail, password: 'yatra123' }),
      });
      setAuthSession(res.access_token, res.user);
      onAuthSuccess(res.user);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="w-full max-w-md bg-white rounded-2xl border border-hairline shadow-2xl p-6 sm:p-7 relative my-8 max-h-[90vh] overflow-y-auto no-scrollbar">
        {/* Modal Header */}
        <div className="flex items-center justify-between mb-5 pb-3 border-b border-hairline">
          <div>
            <span className="eyebrow-mono text-black/50 block">AUTHENTICATION PORTAL</span>
            <h2 className="text-lg font-bold text-black tracking-tight mt-0.5">
              Access Yatra Workspace
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-surface-soft hover:bg-hairline flex items-center justify-center transition-colors text-black/60 hover:text-black"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="grid grid-cols-2 gap-1.5 p-1 bg-surface-soft rounded-pill mb-6 border border-hairline">
          <button
            type="button"
            onClick={() => setActiveTab('clerk')}
            className={`py-2 text-xs font-semibold rounded-pill transition-all ${
              activeTab === 'clerk'
                ? 'bg-white text-black shadow-xs font-bold'
                : 'text-black/60 hover:text-black'
            }`}
          >
            Clerk Authentication
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('demo')}
            className={`py-2 text-xs font-semibold rounded-pill transition-all ${
              activeTab === 'demo'
                ? 'bg-white text-black shadow-xs font-bold'
                : 'text-black/60 hover:text-black'
            }`}
          >
            Demo Accounts
          </button>
        </div>

        {/* TAB 1: Clerk Authentication */}
        {activeTab === 'clerk' && (
          <div className="space-y-4">
            {clerkSignedIn && clerkUser ? (
              <div className="p-5 rounded-xl border border-hairline bg-surface-soft text-center space-y-3">
                <div className="w-14 h-14 rounded-full mx-auto overflow-hidden border border-hairline shadow-2xs">
                  {clerkUser.imageUrl ? (
                    <img src={clerkUser.imageUrl} alt={clerkUser.fullName || 'User'} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-slate-900 text-white flex items-center justify-center font-bold">
                      {clerkUser.firstName?.charAt(0) || 'U'}
                    </div>
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-black">{clerkUser.fullName || clerkUser.username || 'Traveler'}</h3>
                  <p className="text-xs text-black/60">{clerkUser.primaryEmailAddress?.emailAddress}</p>
                </div>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-pill bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-medium">
                  <Check className="w-3 h-3 text-emerald-600" /> Clerk Session Active
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={onClose}
                    className="btn-primary flex-1 text-xs py-2"
                  >
                    Continue to Workspace
                  </button>
                  <button
                    onClick={async () => {
                      await clerkSignOut();
                    }}
                    className="btn-secondary text-xs py-2 px-4 text-rose-600 hover:bg-rose-50"
                  >
                    Sign out
                  </button>
                </div>
              </div>
            ) : hasClerk ? (
              <div className="clerk-container w-full flex justify-center">
                <SignIn
                  routing="hash"
                  appearance={{
                    elements: {
                      rootBox: 'w-full',
                      cardBox: 'w-full shadow-none border-0 p-0 bg-transparent',
                      card: 'w-full shadow-none border-0 p-0 bg-transparent',
                      header: 'hidden',
                      headerTitle: 'hidden',
                      headerSubtitle: 'hidden',
                      socialButtonsBlockButton:
                        'border border-hairline rounded-lg text-xs font-semibold py-2.5 hover:bg-surface-soft transition-colors text-black shadow-none',
                      formButtonPrimary:
                        'btn-primary rounded-lg text-xs py-2.5 font-semibold transition-all shadow-none w-full',
                      formFieldInput:
                        'field-input text-xs py-2 w-full',
                      footer:
                        'bg-transparent border-0 pt-2 p-0',
                      footerAction:
                        'text-xs text-black/60',
                      footerActionLink:
                        'text-sky-600 hover:text-sky-700 font-semibold text-xs',
                      dividerRow: 'my-3 text-black/40',
                      formFieldLabel: 'text-[11px] font-mono uppercase tracking-wider text-black/70 mb-1',
                    },
                  }}
                />
              </div>
            ) : (
              <div className="p-4 rounded-xl border border-hairline bg-surface-soft text-center space-y-2">
                <p className="text-xs text-black/70">
                  Clerk is not configured in this environment. Please switch to the Demo Accounts tab.
                </p>
                <button
                  onClick={() => setActiveTab('demo')}
                  className="btn-primary text-xs py-1.5 px-4"
                >
                  Use Demo Accounts
                </button>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Demo & Local Accounts */}
        {activeTab === 'demo' && (
          <div className="space-y-5">
            {/* 1-Click Fast Logins */}
            <div>
              <span className="caption-mono block mb-2 text-black/60">ONE-CLICK DEMO ACCESS</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { name: 'Dilraj Singh', role: 'Trip Organizer', email: 'dilraj@yatra.local' },
                  { name: 'Arya Wadhwa', role: 'Trip Member', email: 'arya@yatra.local' },
                  { name: 'Aarush Luthra', role: 'Trip Member', email: 'aarush@yatra.local' },
                  { name: 'Archaeological Survey', role: 'Heritage Operator', email: 'operator@asi.gov.in' },
                ].map((acc) => (
                  <button
                    key={acc.email}
                    type="button"
                    disabled={loading}
                    onClick={() => handleQuickLogin(acc.email)}
                    className="p-3 text-left rounded-xl border border-hairline bg-surface-soft hover:bg-hairline hover:border-black/30 transition-all flex flex-col justify-between group"
                  >
                    <div>
                      <span className="text-xs font-bold text-black block group-hover:text-black">
                        {acc.name}
                      </span>
                      <span className="text-[10px] text-black/50 block font-mono">
                        {acc.role}
                      </span>
                    </div>
                    <span className="text-[10px] text-sky-700 font-mono mt-1.5 truncate">
                      {acc.email}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Direct Form Fallback */}
            <div className="pt-3 border-t border-hairline space-y-3">
              <div className="flex items-center justify-between">
                <span className="caption-mono text-black/60">
                  {demoMode === 'login' ? 'OR SIGN IN MANUALLY' : 'REGISTER NEW DEMO ACCOUNT'}
                </span>
                <button
                  type="button"
                  onClick={() => setDemoMode(demoMode === 'login' ? 'register' : 'login')}
                  className="text-xs text-sky-700 hover:underline font-medium"
                >
                  {demoMode === 'login' ? 'Create new account' : 'Back to sign in'}
                </button>
              </div>

              <form onSubmit={handleDemoSubmit} className="space-y-3">
                {demoMode === 'register' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="caption-mono block mb-1">Full Name</label>
                      <input
                        className="field-input text-xs"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="John Doe"
                      />
                    </div>
                    <div>
                      <label className="caption-mono block mb-1">Home City</label>
                      <input
                        className="field-input text-xs"
                        required
                        value={homeCity}
                        onChange={(e) => setHomeCity(e.target.value)}
                        placeholder="Bengaluru"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="caption-mono block mb-1">Email</label>
                  <input
                    className="field-input text-xs"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                <div>
                  <label className="caption-mono block mb-1">Password</label>
                  <input
                    className="field-input text-xs"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>

                {error && (
                  <p className="text-xs border border-rose-200 bg-rose-50 text-rose-800 rounded-lg p-2.5">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary w-full text-xs py-2.5 font-semibold"
                >
                  {loading ? 'Authenticating...' : demoMode === 'login' ? 'Sign in' : 'Create account'}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
