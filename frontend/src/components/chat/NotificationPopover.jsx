import React, { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { chatApi, getChatAuthToken } from '../../api/chatApi';

function formatAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function NotificationPopover({
  notifications = [],
  unreadCount = 0,
  onRefresh,
  onSelectNotification,
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    function handleOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  async function handleOpen() {
    const next = !open;
    setOpen(next);
    if (next && getChatAuthToken()) {
      onRefresh?.();
    }
  }

  async function handleMarkRead(n) {
    try {
      if (!n.is_read) {
        await chatApi.markNotificationRead(n.notification_id);
        onRefresh?.();
      }
    } catch {
      // ignore if unauthenticated
    }
    setOpen(false);
    onSelectNotification?.(n);
  }

  async function handleMarkAllRead() {
    try {
      await chatApi.markAllNotificationsRead();
      onRefresh?.();
    } catch {
      // ignore
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={handleOpen}
        title="Notifications"
        className="relative w-9 h-9 rounded-full border border-hairline bg-white hover:bg-surface-soft flex items-center justify-center text-black transition-colors"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-black text-white text-[10px] font-bold flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white border border-hairline rounded-2xl shadow-xl overflow-hidden z-50">
          <div className="px-4 py-2.5 border-b border-hairline bg-surface-soft flex items-center justify-between">
            <span className="text-xs font-bold text-black">Notifications</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-[11px] font-semibold text-black/65 hover:text-black flex items-center gap-1"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>Mark all read</span>
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-hairline">
            {!getChatAuthToken() ? (
              <div className="p-4 text-center text-xs text-black/55">
                Sign in to see live chat & task notifications.
              </div>
            ) : notifications.length === 0 ? (
              <div className="p-6 text-center text-xs text-black/50">
                You are all caught up.
              </div>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.notification_id}
                  type="button"
                  onClick={() => handleMarkRead(n)}
                  className={`w-full px-4 py-3 text-left hover:bg-surface-soft transition-colors ${
                    !n.is_read ? 'bg-block-lime/25' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-black truncate">{n.title}</span>
                    <span className="text-[10px] text-black/45 shrink-0">
                      {formatAgo(n.created_at)}
                    </span>
                  </div>
                  <p className="text-[11px] text-black/65 mt-0.5 line-clamp-2">{n.body}</p>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
