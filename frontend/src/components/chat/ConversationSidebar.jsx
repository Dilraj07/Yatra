import React, { useMemo, useState } from 'react';
import { Bell, Plus, Search, Users } from 'lucide-react';

function formatShortTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function getInitials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Y';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function ConversationSidebar({
  conversations = [],
  activeConversationId,
  onSelectConversation,
  onOpenNewModal,
  onOpenInvitesModal,
  pendingInviteCount = 0,
}) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      const title = (c.display_title || c.title || '').toLowerCase();
      const preview = (c.last_message_body || '').toLowerCase();
      return title.includes(q) || preview.includes(q);
    });
  }, [conversations, search]);

  return (
    <aside className="flex flex-col h-full bg-white border-r border-hairline w-full md:w-72 lg:w-80 shrink-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-hairline flex items-center justify-between">
        <h2 className="text-sm font-bold text-black tracking-tight">Groups & Chats</h2>
        <button
          type="button"
          onClick={onOpenNewModal}
          title="New group, direct chat, or join code"
          className="px-3 py-1.5 rounded-pill bg-black text-white hover:bg-black/85 text-xs font-semibold flex items-center gap-1 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New</span>
        </button>
      </div>

      {/* Pending Invites Strip (only shown when relevant) */}
      {pendingInviteCount > 0 && (
        <button
          type="button"
          onClick={onOpenInvitesModal}
          className="mx-3 mt-2.5 px-3 py-2 rounded-xl bg-block-lime border border-hairline text-xs font-semibold text-black flex items-center justify-between hover:opacity-90"
        >
          <span className="flex items-center gap-1.5">
            <Bell className="w-3.5 h-3.5" />
            {pendingInviteCount} pending group invite{pendingInviteCount === 1 ? '' : 's'}
          </span>
          <span className="underline">Review</span>
        </button>
      )}

      {/* Search */}
      <div className="p-3 border-b border-hairline">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-black/40 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-surface-soft border border-hairline rounded-pill focus:outline-none focus:border-black"
          />
        </div>
      </div>

      {/* Conversations */}
      <div className="flex-1 overflow-y-auto divide-y divide-hairline">
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-xs text-black/50">
            No conversations yet. Click <strong>New</strong> to create a group.
          </div>
        ) : (
          filtered.map((conv) => {
            const active = Number(conv.conversation_id) === Number(activeConversationId);
            const title = conv.display_title || conv.title;
            const unread = Number(conv.unread_count || 0);
            const lastPreview = conv.last_message_body
              ? `${conv.last_message_sender ? `${conv.last_message_sender.split(' ')[0]}: ` : ''}${conv.last_message_body}`
              : 'Tap to start talking';

            return (
              <button
                key={conv.conversation_id}
                type="button"
                onClick={() => onSelectConversation(conv.conversation_id)}
                className={`w-full px-3.5 py-3 flex items-center gap-3 text-left transition-colors ${
                  active ? 'bg-block-lime/35 border-l-2 border-black' : 'hover:bg-surface-soft'
                }`}
              >
                <div
                  className={`w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-xs font-bold border border-hairline ${
                    conv.kind === 'GROUP' ? 'bg-block-lime text-black' : 'bg-surface-soft text-black'
                  }`}
                >
                  {conv.kind === 'GROUP' ? <Users className="w-4 h-4" /> : getInitials(title)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-black truncate">{title}</span>
                    <span className="text-[11px] text-black/45 shrink-0">
                      {formatShortTime(conv.last_message_at || conv.updated_at)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <p className="text-xs text-black/60 truncate">{lastPreview}</p>
                    {unread > 0 && (
                      <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-black text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                        {unread}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
