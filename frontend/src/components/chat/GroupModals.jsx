import React, { useEffect, useState } from 'react';
import { Check, KeyRound, MessageSquarePlus, Send, Users, X } from 'lucide-react';
import { chatApi } from '../../api/chatApi';

export function NewConversationModal({
  open,
  onClose,
  currentUserId,
  platformUsers = [],
  trips = [],
  onCreated,
}) {
  const [tab, setTab] = useState('GROUP'); // 'GROUP' | 'DIRECT' | 'CODE'
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tripId, setTripId] = useState('');
  const [agentMode, setAgentMode] = useState('ACTIVE');
  const [selectedIds, setSelectedIds] = useState([]);
  const [targetUserId, setTargetUserId] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setError('');
      setSubmitting(false);
    }
  }, [open]);

  if (!open) return null;

  const otherUsers = platformUsers.filter((u) => Number(u.user_id) !== Number(currentUserId));

  function toggleMember(uid) {
    setSelectedIds((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (tab === 'CODE') {
        if (!inviteCode.trim()) throw new Error('Enter an invite code.');
        const res = await chatApi.joinByInviteCode(inviteCode.trim());
        setInviteCode('');
        onCreated?.(res.conversation || { conversation_id: res.conversation_id });
        onClose();
        return;
      }

      let res;
      if (tab === 'DIRECT') {
        if (!targetUserId) throw new Error('Select a teammate.');
        res = await chatApi.createConversation({
          kind: 'DIRECT',
          target_user_id: Number(targetUserId),
        });
      } else {
        if (!title.trim()) throw new Error('Enter a group name.');
        res = await chatApi.createConversation({
          kind: 'GROUP',
          title: title.trim(),
          description: description.trim(),
          trip_id: tripId ? Number(tripId) : null,
          member_ids: selectedIds,
          agent_enabled: agentMode !== 'OFF',
          agent_mode: agentMode,
        });
      }
      onCreated?.(res.conversation);
      setTitle('');
      setDescription('');
      setSelectedIds([]);
      setTargetUserId('');
      onClose();
    } catch (err) {
      setError(err.message || 'Could not complete request.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md bg-white border border-hairline rounded-2xl shadow-xl p-5">
        <div className="flex items-center justify-between pb-3 border-b border-hairline mb-4">
          <div className="flex items-center gap-2 font-bold text-black text-base">
            <MessageSquarePlus className="w-4 h-4" />
            <span>Start Chat</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-full hover:bg-surface-soft flex items-center justify-center text-black/60 hover:text-black"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1 p-1 bg-surface-soft border border-hairline rounded-pill mb-4">
          {[
            { id: 'GROUP', label: 'New Group' },
            { id: 'DIRECT', label: 'Direct Chat' },
            { id: 'CODE', label: 'Join Code' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                setError('');
              }}
              className={`py-1.5 text-xs font-semibold rounded-pill transition-colors ${
                tab === t.id ? 'bg-black text-white' : 'text-black/70 hover:text-black'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-3 px-3 py-2 text-xs font-medium bg-red-50 border border-red-200 text-red-700 rounded-lg">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          {tab === 'CODE' ? (
            <div>
              <label className="block text-xs font-semibold text-black/70 mb-1.5">
                Invite Code
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-black/40 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="Enter group invite code"
                  className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-hairline rounded-xl focus:outline-none focus:border-black"
                  required
                />
              </div>
            </div>
          ) : tab === 'DIRECT' ? (
            <div>
              <label className="block text-xs font-semibold text-black/70 mb-1.5">
                Choose teammate
              </label>
              <div className="max-h-56 overflow-y-auto border border-hairline rounded-xl divide-y divide-hairline">
                {otherUsers.length === 0 ? (
                  <p className="p-3 text-xs text-black/50">No other users available.</p>
                ) : (
                  otherUsers.map((u) => {
                    const active = Number(targetUserId) === Number(u.user_id);
                    return (
                      <button
                        key={u.user_id}
                        type="button"
                        onClick={() => setTargetUserId(String(u.user_id))}
                        className={`w-full px-3 py-2.5 flex items-center justify-between text-left transition-colors ${
                          active ? 'bg-block-lime/40' : 'hover:bg-surface-soft'
                        }`}
                      >
                        <div>
                          <p className="text-sm font-semibold text-black">{u.full_name}</p>
                          <p className="text-xs text-black/50">{u.email}</p>
                        </div>
                        {active && <Check className="w-4 h-4 text-black" />}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-semibold text-black/70 mb-1">Group Name</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Stay & Transport Planning"
                  className="w-full px-3 py-2 text-sm bg-white border border-hairline rounded-xl focus:outline-none focus:border-black"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-black/70 mb-1">
                  Topic (optional)
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this group for?"
                  className="w-full px-3 py-2 text-sm bg-white border border-hairline rounded-xl focus:outline-none focus:border-black"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-black/70 mb-1">Trip</label>
                  <select
                    value={tripId}
                    onChange={(e) => setTripId(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs bg-white border border-hairline rounded-xl focus:outline-none focus:border-black"
                  >
                    <option value="">General group</option>
                    {trips.map((t) => (
                      <option key={t.trip_id} value={t.trip_id}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-black/70 mb-1">
                    AI Copilot
                  </label>
                  <select
                    value={agentMode}
                    onChange={(e) => setAgentMode(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs bg-white border border-hairline rounded-xl focus:outline-none focus:border-black"
                  >
                    <option value="ACTIVE">Auto</option>
                    <option value="OBSERVE">When @mentioned</option>
                    <option value="OFF">Off</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-black/70 mb-1.5">
                  Add People ({selectedIds.length} selected)
                </label>
                <div className="max-h-36 overflow-y-auto border border-hairline rounded-xl divide-y divide-hairline">
                  {otherUsers.map((u) => {
                    const checked = selectedIds.includes(Number(u.user_id));
                    return (
                      <label
                        key={u.user_id}
                        className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-surface-soft"
                      >
                        <div>
                          <p className="text-xs font-semibold text-black">{u.full_name}</p>
                          <p className="text-[11px] text-black/50">{u.home_city || u.email}</p>
                        </div>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleMember(Number(u.user_id))}
                          className="rounded border-hairline text-black focus:ring-0"
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold rounded-pill border border-hairline text-black/70 hover:bg-surface-soft"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-xs font-semibold rounded-pill bg-black text-white hover:bg-black/85 disabled:opacity-50"
            >
              {submitting
                ? 'Please wait...'
                : tab === 'CODE'
                ? 'Join Group'
                : tab === 'DIRECT'
                ? 'Open Chat'
                : 'Create Group'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function InvitationsModal({ open, onClose, invitations = [], onUpdated }) {
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  if (!open) return null;

  async function handleRespond(invitationId, action) {
    setError('');
    setBusyId(invitationId);
    try {
      const res = await chatApi.respondInvitation(invitationId, action);
      onUpdated?.(res.status === 'ACCEPTED' ? res.conversation_id : null);
    } catch (err) {
      setError(err.message || 'Could not update invitation.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md bg-white border border-hairline rounded-2xl shadow-xl p-5">
        <div className="flex items-center justify-between pb-3 border-b border-hairline mb-4">
          <div className="flex items-center gap-2 font-bold text-black text-base">
            <Users className="w-4 h-4" />
            <span>Pending Invitations</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-full hover:bg-surface-soft flex items-center justify-center text-black/60 hover:text-black"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="mb-3 px-3 py-2 text-xs font-medium bg-red-50 border border-red-200 text-red-700 rounded-lg">
            {error}
          </div>
        )}

        <div className="space-y-2 max-h-64 overflow-y-auto">
          {invitations.length === 0 ? (
            <p className="py-6 text-center text-xs text-black/50">No pending invitations.</p>
          ) : (
            invitations.map((inv) => (
              <div
                key={inv.invitation_id}
                className="p-3 bg-surface-soft border border-hairline rounded-xl flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-black truncate">
                    {inv.conversation_title}
                  </p>
                  <p className="text-xs text-black/60">Invited by {inv.invited_by_name}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={busyId === inv.invitation_id}
                    onClick={() => handleRespond(inv.invitation_id, 'ACCEPT')}
                    className="px-3 py-1.5 text-xs font-semibold rounded-pill bg-black text-white hover:bg-black/85"
                  >
                    Join
                  </button>
                  <button
                    type="button"
                    disabled={busyId === inv.invitation_id}
                    onClick={() => handleRespond(inv.invitation_id, 'REJECT')}
                    className="px-3 py-1.5 text-xs font-semibold rounded-pill border border-hairline bg-white text-black/70 hover:bg-surface-soft"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function ForwardMessageModal({
  open,
  message,
  conversations = [],
  onClose,
  onForwarded,
}) {
  const [targetId, setTargetId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!open || !message) return null;

  async function handleForward(e) {
    e.preventDefault();
    if (!targetId) return;
    setBusy(true);
    setError('');
    try {
      await chatApi.sendMessage(Number(targetId), {
        body: message.body,
        forwarded_from_message_id: message.message_id,
      });
      onForwarded?.(Number(targetId));
      onClose();
    } catch (err) {
      setError(err.message || 'Could not forward message.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm bg-white border border-hairline rounded-2xl shadow-xl p-5">
        <div className="flex items-center justify-between pb-3 border-b border-hairline mb-3">
          <div className="flex items-center gap-2 font-bold text-sm text-black">
            <Send className="w-4 h-4" />
            <span>Forward Message</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-full hover:bg-surface-soft flex items-center justify-center text-black/60"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-2.5 mb-3 bg-surface-soft border border-hairline rounded-xl text-xs text-black/80 line-clamp-3">
          {message.body}
        </div>

        {error && (
          <div className="mb-3 px-3 py-2 text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg">
            {error}
          </div>
        )}

        <form onSubmit={handleForward} className="space-y-3">
          <div className="max-h-52 overflow-y-auto border border-hairline rounded-xl divide-y divide-hairline">
            {conversations.map((c) => {
              const selected = String(c.conversation_id) === String(targetId);
              return (
                <button
                  key={c.conversation_id}
                  type="button"
                  onClick={() => setTargetId(String(c.conversation_id))}
                  className={`w-full px-3 py-2.5 text-left flex items-center justify-between ${
                    selected ? 'bg-block-lime/40' : 'hover:bg-surface-soft'
                  }`}
                >
                  <span className="text-xs font-semibold text-black truncate">
                    {c.display_title || c.title}
                  </span>
                  {selected && <Check className="w-3.5 h-3.5 text-black shrink-0" />}
                </button>
              );
            })}
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs font-semibold rounded-pill border border-hairline text-black/70"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!targetId || busy}
              className="px-4 py-1.5 text-xs font-semibold rounded-pill bg-black text-white disabled:opacity-40"
            >
              {busy ? 'Sending...' : 'Forward'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
