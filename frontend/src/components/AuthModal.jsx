import React, { useState } from 'react';
import { X } from 'lucide-react';
import { apiRequest, setAuthSession } from '../api/client';

export default function AuthModal({ open, onClose, onAuthSuccess }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('dilraj@yatra.local');
  const [password, setPassword] = useState('yatra123');
  const [fullName, setFullName] = useState('');
  const [homeCity, setHomeCity] = useState('Bengaluru');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body = mode === 'login' ? { email, password } : { email, password, full_name: fullName, home_city: homeCity };
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md bg-canvas rounded-lg border border-hairline p-7">
        <div className="flex items-center justify-between mb-5">
          <span className="eyebrow-mono">{mode === 'login' ? 'SIGN IN' : 'REGISTER'}</span>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-surface-soft flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex gap-2 mb-5">
          <button type="button" onClick={() => setMode('login')} className={mode === 'login' ? 'btn-primary text-sm py-1.5 px-4' : 'btn-secondary text-sm py-1.5 px-4'}>
            Sign in
          </button>
          <button type="button" onClick={() => setMode('register')} className={mode === 'register' ? 'btn-primary text-sm py-1.5 px-4' : 'btn-secondary text-sm py-1.5 px-4'}>
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {mode === 'register' && (
            <>
              <div>
                <label className="caption-mono block mb-1">Full Name</label>
                <input className="field-input" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div>
                <label className="caption-mono block mb-1">Home City</label>
                <input className="field-input" required value={homeCity} onChange={(e) => setHomeCity(e.target.value)} />
              </div>
            </>
          )}
          <div>
            <label className="caption-mono block mb-1">Email</label>
            <input className="field-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="caption-mono block mb-1">Password</label>
            <input className="field-input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <p className="text-sm border border-primary rounded-md p-2.5 bg-block-pink">{error}</p>}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? 'Working...' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div className="mt-5 pt-4 border-t border-hairline-soft space-y-2">
          <span className="caption-mono block">QUICK FILL (PASSWORD: yatra123)</span>
          <div className="flex flex-wrap gap-1.5">
            {['dilraj@yatra.local', 'arya@yatra.local', 'aarush@yatra.local', 'operator@asi.gov.in'].map((em) => (
              <button
                key={em}
                type="button"
                onClick={() => { setMode('login'); setEmail(em); setPassword('yatra123'); }}
                className="text-xs font-mono px-2.5 py-1 rounded-pill bg-surface-soft hover:bg-block-lime"
              >
                {em}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
