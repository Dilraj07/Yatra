import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  Bot,
  Check,
  CheckCheck,
  ClipboardList,
  Download,
  Forward,
  MessageSquare,
  Pencil,
  Pin,
  Reply,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { chatApi } from '../../api/chatApi';
import ChatComposer from './ChatComposer';

function formatClock(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateHeading(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yest = new Date(now);
  yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ChatWindow({
  conversation,
  members = [],
  messages = [],
  openTaskCount = 0,
  currentUserId,
  onlineUserIds = [],
  typingUsers = [],
  myMembership,
  searchQuery,
  onlyPinned,
  onlyBookmarked,
  threadRootId,
  activeDrawerTab,
  onBackMobile,
  onSearchChange,
  onToggleOnlyPinned,
  onToggleOnlyBookmarked,
  onSetThreadRootId,
  onOpenDrawerTab,
  onSendMessage,
  onEditMessage,
  onDeleteMessage,
  onTogglePin,
  onToggleBookmark,
  onForwardMessage,
  onTypingChange,
  onFocusTask,
}) {
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const endRef = useRef(null);

  useEffect(() => {
    setReplyTo(null);
    setEditingId(null);
    setEditDraft('');
  }, [conversation?.conversation_id]);

  useEffect(() => {
    if (!searchQuery && !onlyPinned && !onlyBookmarked) {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages.length, conversation?.conversation_id]);

  const pinnedList = useMemo(
    () => messages.filter((m) => m.is_pinned && !m.is_deleted),
    [messages]
  );
  const onlineSet = useMemo(() => new Set(onlineUserIds.map(Number)), [onlineUserIds]);

  const roleRank = { MEMBER: 1, MODERATOR: 2, ADMIN: 3, OWNER: 4 };
  const myRank = roleRank[myMembership?.role || 'MEMBER'] || 1;
  const canModerate = myRank >= 2 || Boolean(myMembership?.can_manage_members);

  const otherDmMember =
    conversation?.kind === 'DIRECT'
      ? members.find((m) => Number(m.user_id) !== Number(currentUserId))
      : null;

  const onlineMembersCount = members.filter((m) => onlineSet.has(Number(m.user_id))).length;

  function scrollToMessage(msgId) {
    const el = document.getElementById(`msg-${msgId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-black');
      setTimeout(() => el.classList.remove('ring-2', 'ring-black'), 1400);
    }
  }

  async function submitEdit(msgId) {
    if (!editDraft.trim()) return;
    await onEditMessage(msgId, editDraft.trim());
    setEditingId(null);
    setEditDraft('');
  }

  if (!conversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-surface-soft/40 p-8 text-center">
        <div className="w-11 h-11 rounded-2xl bg-block-lime border border-hairline flex items-center justify-center mb-3">
          <MessageSquare className="w-5 h-5 text-black" />
        </div>
        <h3 className="text-base font-bold text-black">Select a group to start discussing</h3>
        <p className="text-xs text-black/60 max-w-xs mt-1">
          Pick a trip chat on the left or create a new group.
        </p>
      </div>
    );
  }

  const title = conversation.display_title || conversation.title;
  let lastDateLabel = '';

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full bg-[#fafaf8]">
      {/* Clean Minimal Header */}
      <header className="px-4 py-2.5 bg-white border-b border-hairline flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          {onBackMobile && (
            <button
              type="button"
              onClick={onBackMobile}
              className="md:hidden p-1.5 rounded-full hover:bg-surface-soft text-black"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpenDrawerTab('INFO')}
            className="text-left min-w-0 hover:opacity-80"
          >
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-black truncate">{title}</h2>
              {conversation.kind === 'DIRECT' &&
                otherDmMember &&
                onlineSet.has(Number(otherDmMember.user_id)) && (
                  <span className="w-2 h-2 rounded-full bg-emerald-600 shrink-0" title="Online" />
                )}
            </div>
            <p className="text-[11px] text-black/55 truncate">
              {typingUsers.length > 0 ? (
                <span className="font-medium text-black">
                  {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
                </span>
              ) : conversation.kind === 'DIRECT' ? (
                otherDmMember && onlineSet.has(Number(otherDmMember.user_id))
                  ? 'Online'
                  : 'Offline'
              ) : (
                `${members.length} members · ${onlineMembersCount} online`
              )}
            </p>
          </button>
        </div>

        {/* Minimal Action Buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setShowSearchBar((s) => !s)}
            title="Search & filter messages"
            className={`p-2 rounded-full border transition-colors ${
              showSearchBar || searchQuery || onlyPinned || onlyBookmarked
                ? 'bg-block-lime border-hairline text-black'
                : 'bg-white border-transparent text-black/65 hover:bg-surface-soft hover:text-black'
            }`}
          >
            <Search className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => onOpenDrawerTab('TASKS')}
            className={`px-3 py-1.5 rounded-pill text-xs font-semibold flex items-center gap-1.5 border transition-colors ${
              activeDrawerTab === 'TASKS'
                ? 'bg-black text-white border-black'
                : 'bg-white text-black border-hairline hover:bg-surface-soft'
            }`}
          >
            <ClipboardList className="w-3.5 h-3.5" />
            <span>Tasks</span>
            {openTaskCount > 0 && (
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                  activeDrawerTab === 'TASKS'
                    ? 'bg-white text-black'
                    : 'bg-block-lime text-black'
                }`}
              >
                {openTaskCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => onOpenDrawerTab('INFO')}
            className={`px-3 py-1.5 rounded-pill text-xs font-semibold flex items-center gap-1.5 border transition-colors ${
              activeDrawerTab === 'INFO'
                ? 'bg-black text-white border-black'
                : 'bg-white text-black border-hairline hover:bg-surface-soft'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Group</span>
          </button>
        </div>
      </header>

      {/* Expandable Search & Filter Strip */}
      {(showSearchBar || searchQuery || onlyPinned || onlyBookmarked) && (
        <div className="px-4 py-2 bg-surface-soft border-b border-hairline flex flex-wrap items-center gap-2 shrink-0">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-3.5 h-3.5 text-black/40 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search messages..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-hairline rounded-pill focus:outline-none focus:border-black"
            />
          </div>
          <button
            type="button"
            onClick={onToggleOnlyPinned}
            className={`px-2.5 py-1 rounded-pill text-[11px] font-semibold border flex items-center gap-1 ${
              onlyPinned
                ? 'bg-black text-white border-black'
                : 'bg-white text-black/70 border-hairline'
            }`}
          >
            <Pin className="w-3 h-3" />
            <span>Pinned</span>
          </button>
          <button
            type="button"
            onClick={onToggleOnlyBookmarked}
            className={`px-2.5 py-1 rounded-pill text-[11px] font-semibold border flex items-center gap-1 ${
              onlyBookmarked
                ? 'bg-black text-white border-black'
                : 'bg-white text-black/70 border-hairline'
            }`}
          >
            <Bookmark className="w-3 h-3" />
            <span>Saved</span>
          </button>
          {(searchQuery || onlyPinned || onlyBookmarked) && (
            <button
              type="button"
              onClick={() => {
                onSearchChange('');
                if (onlyPinned) onToggleOnlyPinned();
                if (onlyBookmarked) onToggleOnlyBookmarked();
              }}
              className="text-xs font-semibold text-black/60 hover:text-black"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Pinned Banner */}
      {pinnedList.length > 0 && !onlyPinned && !threadRootId && (
        <button
          type="button"
          onClick={() => scrollToMessage(pinnedList[pinnedList.length - 1].message_id)}
          className="px-4 py-1.5 bg-white border-b border-hairline flex items-center justify-between text-left hover:bg-surface-soft shrink-0"
        >
          <div className="flex items-center gap-2 min-w-0 text-xs">
            <Pin className="w-3.5 h-3.5 text-black/60 shrink-0" />
            <span className="font-semibold text-black shrink-0">Pinned:</span>
            <span className="text-black/70 truncate">
              {pinnedList[pinnedList.length - 1].body}
            </span>
          </div>
          <span className="text-[11px] text-black/50 shrink-0 ml-2">
            {pinnedList.length} total
          </span>
        </button>
      )}

      {/* Thread Filter Banner */}
      {threadRootId && (
        <div className="px-4 py-2 bg-block-lime/50 border-b border-hairline flex items-center justify-between text-xs shrink-0">
          <span className="font-semibold text-black">Viewing reply thread</span>
          <button
            type="button"
            onClick={() => onSetThreadRootId(null)}
            className="inline-flex items-center gap-1 font-semibold text-black hover:underline"
          >
            <X className="w-3.5 h-3.5" />
            <span>Back to chat</span>
          </button>
        </div>
      )}

      {/* Message Stream */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-4 space-y-2.5">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-xs text-black/55 px-6">
            <p>Start the discussion below, or type <strong>@copilot</strong> to propose a task.</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isAgent = msg.sender_type === 'AGENT' || msg.is_agent;
            const isMine = !isAgent && Number(msg.sender_id) === Number(currentUserId);
            const dateLabel = formatDateHeading(msg.created_at);
            const showDate = dateLabel && dateLabel !== lastDateLabel;
            if (dateLabel) lastDateLabel = dateLabel;

            const stats = msg.delivery_stats || {};
            const isRead = Number(stats.read_count || 0) > 0;
            const isDelivered = Number(stats.delivered_count || 0) > 0;
            const readTooltip =
              Array.isArray(stats.read_by) && stats.read_by.length > 0
                ? `Read by ${stats.read_by.map((r) => r.full_name).join(', ')}`
                : isDelivered
                ? 'Delivered'
                : 'Sent';

            const bubbleClasses = isAgent
              ? 'bg-block-lime/50 border border-hairline text-black'
              : isMine
              ? 'bg-block-cream border border-[#e3dabf] text-black'
              : 'bg-white border border-hairline text-black';

            return (
              <React.Fragment key={msg.message_id}>
                {showDate && (
                  <div className="flex justify-center my-2">
                    <span className="px-3 py-0.5 rounded-pill bg-white border border-hairline text-[11px] font-medium text-black/55">
                      {dateLabel}
                    </span>
                  </div>
                )}

                <div
                  id={`msg-${msg.message_id}`}
                  className={`flex ${isMine ? 'justify-end' : 'justify-start'} group rounded-xl transition-all`}
                >
                  <div
                    className={`max-w-[85%] sm:max-w-[72%] rounded-2xl px-3.5 py-2.5 shadow-xs ${bubbleClasses}`}
                  >
                    {(!isMine || isAgent) && (
                      <div className="flex items-center gap-1.5 mb-1">
                        {isAgent && <Bot className="w-3.5 h-3.5 text-black" />}
                        <span className="text-xs font-bold text-black">{msg.sender_name}</span>
                        {msg.is_pinned && <Pin className="w-3 h-3 text-black/60" title="Pinned" />}
                      </div>
                    )}

                    {msg.forwarded_from_message_id && (
                      <div className="text-[10px] italic mb-1 text-black/50">
                        Forwarded
                      </div>
                    )}

                    {msg.reply_preview && (
                      <button
                        type="button"
                        onClick={() => scrollToMessage(msg.reply_preview.message_id)}
                        className="w-full text-left mb-1.5 px-2.5 py-1 rounded-lg border-l-2 border-black/40 bg-white/75 text-black/85 text-xs"
                      >
                        <p className="font-semibold text-[11px]">{msg.reply_preview.sender_name}</p>
                        <p className="truncate text-[11px] opacity-80">{msg.reply_preview.body}</p>
                      </button>
                    )}

                    {editingId === msg.message_id ? (
                      <div className="space-y-1.5">
                        <textarea
                          rows={2}
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs bg-white text-black border border-hairline rounded-lg focus:outline-none"
                        />
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="px-2.5 py-0.5 text-[11px] font-medium rounded-pill border border-hairline bg-white text-black/75 hover:text-black"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => submitEdit(msg.message_id)}
                            className="px-2.5 py-0.5 text-[11px] font-semibold rounded-pill bg-black text-white"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p
                        className={`text-sm whitespace-pre-wrap break-words leading-relaxed ${
                          msg.is_deleted ? 'italic opacity-65' : ''
                        }`}
                      >
                        {msg.body}
                      </p>
                    )}

                    {Array.isArray(msg.attachments_json) &&
                      msg.attachments_json.length > 0 &&
                      !msg.is_deleted && (
                        <div className="mt-2 space-y-1.5">
                          {msg.attachments_json.map((att, idx) => {
                            const url = chatApi.getAttachmentUrl(att.attachment_id);
                            const isImg = (att.content_type || '').startsWith('image/');
                            return isImg ? (
                              <a
                                key={`${att.attachment_id}-${idx}`}
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="block overflow-hidden rounded-xl border border-hairline"
                              >
                                <img
                                  src={url}
                                  alt={att.file_name}
                                  className="max-h-52 w-auto object-cover"
                                />
                              </a>
                            ) : (
                              <a
                                key={`${att.attachment_id}-${idx}`}
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-hairline bg-white text-black text-xs hover:bg-surface-soft"
                              >
                                <span className="truncate font-medium">{att.file_name}</span>
                                <Download className="w-3.5 h-3.5 shrink-0" />
                              </a>
                            );
                          })}
                        </div>
                      )}

                    {Array.isArray(msg.linked_tasks) && msg.linked_tasks.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {msg.linked_tasks.map((lt) => (
                          <button
                            key={lt.task_id}
                            type="button"
                            onClick={() => onFocusTask?.(lt.task_id)}
                            className="w-full text-left px-2.5 py-1.5 rounded-lg border border-hairline bg-white text-black hover:bg-surface-soft text-xs flex items-center justify-between gap-2"
                          >
                            <span className="font-semibold truncate">Task: {lt.title}</span>
                            <span className="px-1.5 py-0.5 rounded bg-surface-soft border border-hairline text-[10px] font-bold shrink-0">
                              {lt.status}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="mt-1.5 flex items-center justify-between gap-3 text-[10px] text-black/50">
                      <div className="flex items-center gap-1.5">
                        {Number(msg.thread_reply_count || 0) > 0 && (
                          <button
                            type="button"
                            onClick={() => onSetThreadRootId(msg.message_id)}
                            className="font-semibold text-black hover:underline"
                          >
                            {msg.thread_reply_count} replies
                          </button>
                        )}
                        {!msg.is_deleted && (
                          <div className="sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setReplyTo(msg)}
                              title="Reply"
                              className="p-0.5 hover:text-black"
                            >
                              <Reply className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onForwardMessage(msg)}
                              title="Forward"
                              className="p-0.5 hover:text-black"
                            >
                              <Forward className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onToggleBookmark(msg.message_id)}
                              title="Save"
                              className={`p-0.5 hover:text-black ${msg.is_bookmarked ? 'text-amber-600' : ''}`}
                            >
                              <Bookmark className="w-3 h-3" />
                            </button>
                            {canModerate && (
                              <button
                                type="button"
                                onClick={() => onTogglePin(msg.message_id, !msg.is_pinned)}
                                title={msg.is_pinned ? 'Unpin' : 'Pin'}
                                className="p-0.5 hover:text-black"
                              >
                                <Pin className="w-3 h-3" />
                              </button>
                            )}
                            {isMine && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingId(msg.message_id);
                                  setEditDraft(msg.body);
                                }}
                                title="Edit"
                                className="p-0.5 hover:text-black"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                            )}
                            {(isMine || canModerate) && (
                              <button
                                type="button"
                                onClick={() => onDeleteMessage(msg.message_id)}
                                title="Delete"
                                className="p-0.5 hover:text-red-600"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {msg.is_pinned && <Pin className="w-2.5 h-2.5 text-black/60" title="Pinned" />}
                        {msg.is_bookmarked && <Bookmark className="w-2.5 h-2.5 text-amber-600" title="Saved" />}
                        {msg.is_edited && !msg.is_deleted && <span>edited</span>}
                        <span>{formatClock(msg.created_at)}</span>
                        {isMine && (
                          <span title={readTooltip}>
                            {isRead ? (
                              <CheckCheck className="w-3.5 h-3.5 text-semantic-success" />
                            ) : isDelivered ? (
                              <CheckCheck className="w-3.5 h-3.5 text-black/45" />
                            ) : (
                              <Check className="w-3.5 h-3.5 text-black/45" />
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </React.Fragment>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      <ChatComposer
        conversationId={conversation.conversation_id}
        members={members}
        canSend={myMembership?.can_send !== false}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
        onSendMessage={onSendMessage}
        onTypingChange={onTypingChange}
      />
    </div>
  );
}
