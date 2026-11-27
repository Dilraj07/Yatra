import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, Lock, Plus, RefreshCw, Sparkles } from 'lucide-react';
import { chatApi, getActiveChatUser, getChatAuthToken } from '../api/chatApi';
import { ChatRealtimeClient } from '../api/chatRealtime';
import ChatWindow from './chat/ChatWindow';
import ContextDrawer from './chat/ContextDrawer';
import ConversationSidebar from './chat/ConversationSidebar';
import {
  ForwardMessageModal,
  InvitationsModal,
  NewConversationModal,
} from './chat/GroupModals';

export default function TripChatHub({
  activeTripId,
  setActiveTripId,
  tripId: tripIdProp,
  trips = [],
  tripDetail,
  itineraries = [],
  allUsers = [],
  currentUser,
  onOpenAuth,
  onNavigateTab,
  onRefresh,
  onItinerarySynced,
  externalNavTarget,
  onNotificationStateChange,
}) {
  const tripId = activeTripId ?? tripIdProp;
  const token = getChatAuthToken();
  const activeUser = currentUser?.user_id ? currentUser : getActiveChatUser();
  const currentUserId = activeUser?.user_id || activeUser?.sub || null;

  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [mobileShowChat, setMobileShowChat] = useState(false);

  const [convDetail, setConvDetail] = useState(null);
  const [members, setMembers] = useState([]);
  const [myMembership, setMyMembership] = useState(null);
  const [messages, setMessages] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [groupInvitations, setGroupInvitations] = useState([]);
  const [myInvitations, setMyInvitations] = useState([]);
  const [platformUsers, setPlatformUsers] = useState(allUsers);
  const [onlineUserIds, setOnlineUserIds] = useState([]);

  const [typingMap, setTypingMap] = useState({});
  const typingTimersRef = useRef({});

  const [searchQuery, setSearchQuery] = useState('');
  const [onlyPinned, setOnlyPinned] = useState(false);
  const [onlyBookmarked, setOnlyBookmarked] = useState(false);
  const [threadRootId, setThreadRootId] = useState(null);

  const [drawerTab, setDrawerTab] = useState(null);
  const [newTaskTrigger, setNewTaskTrigger] = useState(0);
  const [focusedTaskId, setFocusedTaskId] = useState(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [showInvitesModal, setShowInvitesModal] = useState(false);
  const [forwardMsg, setForwardMsg] = useState(null);

  const [realtimeStatus, setRealtimeStatus] = useState('disconnected');
  const [summarizingTop, setSummarizingTop] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [noticeMsg, setNoticeMsg] = useState('');

  // Refs keep live callback identity stable so realtime socket never loops/reconnects
  const liveClientRef = useRef(null);
  const activeConvIdRef = useRef(null);
  const lastMsgIdRef = useRef(0);
  const lastSyncedTripIdRef = useRef(null);
  const onNotifChangeRef = useRef(onNotificationStateChange);
  const onItinerarySyncedRef = useRef(onItinerarySynced);
  const onRefreshRef = useRef(onRefresh);

  onNotifChangeRef.current = onNotificationStateChange;
  onItinerarySyncedRef.current = onItinerarySynced;
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    if (Array.isArray(allUsers) && allUsers.length > 0) {
      setPlatformUsers((prev) => (prev.length > 0 ? prev : allUsers));
    }
  }, [allUsers]);

  useEffect(() => {
    activeConvIdRef.current = activeConvId;
  }, [activeConvId]);

  useEffect(() => {
    lastMsgIdRef.current = messages.length > 0 ? messages[messages.length - 1].message_id : 0;
  }, [messages]);

  function showError(msg) {
    setErrorMsg(msg || 'Action could not be completed.');
  }

  function showNotice(msg) {
    setNoticeMsg(msg);
    setTimeout(() => setNoticeMsg(''), 2800);
  }

  const loadBootstrap = useCallback(async (preferredConvId = null) => {
    if (!getChatAuthToken()) return;
    try {
      const [convRes, invRes, usersRes] = await Promise.all([
        chatApi.listConversations(),
        chatApi.listMyInvitations().catch(() => ({ invitations: [] })),
        chatApi.listPlatformUsers().catch(() => []),
      ]);
      const list = convRes.conversations || [];
      setConversations(list);
      setOnlineUserIds(convRes.online_user_ids || []);
      setMyInvitations(invRes.invitations || []);
      setPlatformUsers(Array.isArray(usersRes) ? usersRes : usersRes.users || []);

      setActiveConvId((prev) => {
        if (preferredConvId && list.some((c) => Number(c.conversation_id) === Number(preferredConvId))) {
          return Number(preferredConvId);
        }
        if (prev && list.some((c) => Number(c.conversation_id) === Number(prev))) {
          return prev;
        }
        const tripMatch = list.find((c) => Number(c.trip_id) === Number(tripId));
        return tripMatch?.conversation_id || list[0]?.conversation_id || null;
      });
    } catch (err) {
      if (err.status !== 401) showError(err.message);
    }
  }, [tripId]);

  const loadNotifications = useCallback(async () => {
    if (!getChatAuthToken()) return;
    try {
      const res = await chatApi.listNotifications();
      onNotifChangeRef.current?.(res.notifications || [], res.unread_count || 0);
    } catch {
      // ignore silently if unauthorized
    }
  }, []);

  const loadBootstrapRef = useRef(loadBootstrap);
  const loadNotificationsRef = useRef(loadNotifications);
  loadBootstrapRef.current = loadBootstrap;
  loadNotificationsRef.current = loadNotifications;

  const loadConversationData = useCallback(async (convId) => {
    if (!convId || !getChatAuthToken()) return;
    try {
      const [detailRes, msgRes, taskRes] = await Promise.all([
        chatApi.getConversation(convId),
        chatApi.listMessages(convId, {
          search: searchQuery || undefined,
          only_pinned: onlyPinned || undefined,
          only_bookmarked: onlyBookmarked || undefined,
          thread_root_id: threadRootId || undefined,
          limit: 100,
        }),
        chatApi.listTasks(convId),
      ]);
      setConvDetail(detailRes.conversation);
      setMyMembership(detailRes.my_membership);
      setMembers(detailRes.members || []);
      if (detailRes.online_user_ids) setOnlineUserIds(detailRes.online_user_ids);

      const loadedMsgs = msgRes.messages || [];
      setMessages(loadedMsgs);
      setTasks(taskRes.tasks || []);

      if (loadedMsgs.length > 0 && !searchQuery && !onlyPinned && !onlyBookmarked) {
        const latestId = loadedMsgs[loadedMsgs.length - 1].message_id;
        chatApi
          .markRead(convId, latestId)
          .then(() => {
            setConversations((prev) =>
              prev.map((c) =>
                Number(c.conversation_id) === Number(convId) ? { ...c, unread_count: 0 } : c
              )
            );
          })
          .catch(() => {});
      }
    } catch (err) {
      showError(err.message);
    }
  }, [searchQuery, onlyPinned, onlyBookmarked, threadRootId]);

  const loadDrawerExtras = useCallback(async (convId, tab, membership) => {
    if (!convId || !getChatAuthToken()) return;
    if (tab === 'INFO') {
      const roleRank = { MEMBER: 1, MODERATOR: 2, ADMIN: 3, OWNER: 4 };
      const canManage =
        (roleRank[membership?.role || 'MEMBER'] || 1) >= 3 ||
        Boolean(membership?.can_manage_members);
      if (canManage) {
        chatApi.listGroupInvitations(convId).then((r) => setGroupInvitations(r.invitations || [])).catch(() => {});
      } else {
        setGroupInvitations([]);
      }
    }
  }, []);

  useEffect(() => {
    if (!tripId || conversations.length === 0) return;
    if (Number(lastSyncedTripIdRef.current) === Number(tripId)) return;
    const matched = conversations.find((c) => Number(c.trip_id) === Number(tripId));
    if (matched) {
      lastSyncedTripIdRef.current = Number(tripId);
      if (Number(matched.conversation_id) !== Number(activeConvIdRef.current)) {
        setActiveConvId(matched.conversation_id);
      }
    }
  }, [tripId, conversations]);

  useEffect(() => {
    if (!externalNavTarget?.conversationId) return;
    setActiveConvId(Number(externalNavTarget.conversationId));
    setMobileShowChat(true);
    if (externalNavTarget.taskId) {
      setDrawerTab('TASKS');
      setFocusedTaskId(externalNavTarget.taskId);
    }
  }, [externalNavTarget]);

  // Persistent single realtime connection per signed-in user session
  useEffect(() => {
    if (!token || !currentUserId) return;
    loadBootstrapRef.current();
    loadNotificationsRef.current();

    const client = new ChatRealtimeClient({
      onStatusChange: (status) => {
        setRealtimeStatus(status);
        if (status === 'connected' && activeConvIdRef.current) {
          chatApi.listConversations().then((r) => setConversations(r.conversations || [])).catch(() => {});
          if (lastMsgIdRef.current > 0) {
            chatApi
              .listMessages(activeConvIdRef.current, { after_id: lastMsgIdRef.current })
              .then((r) => {
                const missed = r.messages || [];
                if (missed.length > 0) {
                  setMessages((prev) => {
                    const existingIds = new Set(prev.map((m) => m.message_id));
                    return [...prev, ...missed.filter((m) => !existingIds.has(m.message_id))];
                  });
                }
              })
              .catch(() => {});
          }
        }
      },
      onEvent: (event, data) => {
        const cid = Number(data.conversation_id || 0);
        const isCurrent = cid > 0 && cid === Number(activeConvIdRef.current);

        if (event === 'connected' || event === 'presence_updated') {
          if (Array.isArray(data.online_user_ids)) setOnlineUserIds(data.online_user_ids);
          return;
        }

        if (event === 'typing' && cid) {
          const key = `${cid}:${data.user_id}`;
          clearTimeout(typingTimersRef.current[key]);
          setTypingMap((prev) => {
            const group = { ...(prev[cid] || {}) };
            if (data.is_typing) {
              group[data.user_id] = data.full_name || 'Someone';
            } else {
              delete group[data.user_id];
            }
            return { ...prev, [cid]: group };
          });
          if (data.is_typing) {
            typingTimersRef.current[key] = setTimeout(() => {
              setTypingMap((prev) => {
                const group = { ...(prev[cid] || {}) };
                delete group[data.user_id];
                return { ...prev, [cid]: group };
              });
            }, 3200);
          }
          return;
        }

        if (event === 'message_new' && data.message) {
          const msg = data.message;
          if (isCurrent) {
            setMessages((prev) => {
              if (prev.some((m) => m.message_id === msg.message_id)) return prev;
              return [...prev, msg];
            });
            if (Number(msg.sender_id) !== Number(currentUserId)) {
              client.sendRead(cid, msg.message_id);
            }
          }
          chatApi.listConversations().then((r) => setConversations(r.conversations || [])).catch(() => {});
          return;
        }

        if (
          (event === 'message_updated' || event === 'message_deleted' || event === 'message_pinned') &&
          data.message
        ) {
          if (isCurrent) {
            setMessages((prev) =>
              prev.map((m) => (m.message_id === data.message.message_id ? data.message : m))
            );
          }
          return;
        }

        if (event === 'receipt_updated' && isCurrent) {
          const readIds = new Set((data.message_ids || []).map(Number));
          setMessages((prev) =>
            prev.map((m) => {
              if (!readIds.has(Number(m.message_id))) return m;
              const stats = m.delivery_stats || {
                recipient_count: 1,
                delivered_count: 1,
                read_count: 0,
                read_by: [],
              };
              const readBy = Array.isArray(stats.read_by) ? [...stats.read_by] : [];
              if (!readBy.some((r) => Number(r.user_id) === Number(data.user_id))) {
                readBy.push({
                  user_id: data.user_id,
                  full_name: data.full_name,
                  read_at: new Date().toISOString(),
                });
              }
              return {
                ...m,
                delivery_stats: {
                  ...stats,
                  read_count: Math.max(Number(stats.read_count || 0), readBy.length),
                  read_by: readBy,
                },
              };
            })
          );
          return;
        }

        if ((event === 'task_new' || event === 'task_updated') && isCurrent) {
          chatApi.listTasks(cid).then((r) => setTasks(r.tasks || [])).catch(() => {});
          return;
        }

        if (
          event === 'conversation_updated' ||
          event === 'membership_updated' ||
          event === 'agent_config_updated'
        ) {
          chatApi.listConversations().then((r) => setConversations(r.conversations || [])).catch(() => {});
          if (isCurrent) {
            chatApi
              .getConversation(cid)
              .then((d) => {
                setConvDetail(d.conversation);
                setMyMembership(d.my_membership);
                setMembers(d.members || []);
              })
              .catch(() => {});
          }
          return;
        }

        if (event === 'invitation_new') {
          chatApi.listMyInvitations().then((r) => setMyInvitations(r.invitations || [])).catch(() => {});
          loadNotificationsRef.current();
          return;
        }

        if (event === 'notification_new' || event === 'notification_refresh') {
          loadNotificationsRef.current();
          return;
        }

        if (event === 'itinerary_updated' && data.trip_id) {
          onItinerarySyncedRef.current?.(data.trip_id, data.leg);
          onRefreshRef.current?.(data.trip_id);
        }
      },
    });

    liveClientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
      liveClientRef.current = null;
    };
  }, [token, currentUserId]);

  useEffect(() => {
    if (activeConvId && token) {
      loadConversationData(activeConvId);
    }
  }, [activeConvId, token, loadConversationData]);

  useEffect(() => {
    if (activeConvId && drawerTab && token) {
      loadDrawerExtras(activeConvId, drawerTab, myMembership);
    }
  }, [activeConvId, drawerTab, myMembership, token, loadDrawerExtras]);

  const activeTypingNames = useMemo(() => {
    if (!activeConvId) return [];
    const entries = Object.entries(typingMap[activeConvId] || {});
    return entries
      .filter(([uid]) => Number(uid) !== Number(currentUserId))
      .map(([, name]) => name);
  }, [typingMap, activeConvId, currentUserId]);

  const openTaskCount = useMemo(
    () => tasks.filter((t) => !['DONE', 'REJECTED'].includes(t.status)).length,
    [tasks]
  );

  const proposedTaskCount = useMemo(
    () => tasks.filter((t) => t.status === 'PROPOSED').length,
    [tasks]
  );

  const linkedTrip = useMemo(() => {
    if (!convDetail?.trip_id) return null;
    const found = trips.find((t) => Number(t.trip_id) === Number(convDetail.trip_id));
    if (found) return found;
    const td = tripDetail?.trip || tripDetail;
    return td && Number(td.trip_id) === Number(convDetail.trip_id) ? td : null;
  }, [convDetail, trips, tripDetail]);

  const scheduledLegsCount = useMemo(() => {
    if (!linkedTrip) return 0;
    const activeItin =
      itineraries.find((i) => Number(i.trip_id) === Number(linkedTrip.trip_id)) ||
      itineraries[0];
    return Array.isArray(activeItin?.legs) ? activeItin.legs.length : 0;
  }, [linkedTrip, itineraries]);

  if (!token) {
    return (
      <div className="bg-white border border-hairline rounded-2xl p-10 text-center space-y-3">
        <div className="w-11 h-11 rounded-full bg-surface-soft border border-hairline mx-auto flex items-center justify-center">
          <Lock className="w-5 h-5 text-black" />
        </div>
        <h3 className="text-base font-bold text-black">Sign in to open Trip Chat</h3>
        <p className="text-xs text-black/60 max-w-sm mx-auto">
          Discuss trip plans, assign group tasks, and sync itinerary changes in real time.
        </p>
        <button
          type="button"
          onClick={onOpenAuth}
          className="px-5 py-2 rounded-pill bg-black text-white text-xs font-semibold hover:bg-black/85"
        >
          Sign In
        </button>
      </div>
    );
  }

  async function handleSendMessage(payload) {
    if (!activeConvId) return;
    const res = await chatApi.sendMessage(activeConvId, payload);
    setMessages((prev) => {
      const next = [...prev];
      if (res.message && !next.some((m) => m.message_id === res.message.message_id)) {
        next.push(res.message);
      }
      if (res.agent_message && !next.some((m) => m.message_id === res.agent_message.message_id)) {
        next.push(res.agent_message);
      }
      return next;
    });
    if (res.proposed_task) {
      chatApi.listTasks(activeConvId).then((r) => setTasks(r.tasks || [])).catch(() => {});
    }
    chatApi.listConversations().then((r) => setConversations(r.conversations || [])).catch(() => {});
  }

  async function handleEditMessage(messageId, newBody) {
    try {
      const res = await chatApi.editMessage(messageId, newBody);
      if (res.message) {
        setMessages((prev) => prev.map((m) => (m.message_id === messageId ? res.message : m)));
      }
    } catch (err) {
      showError(err.message);
    }
  }

  async function handleDeleteMessage(messageId) {
    try {
      const res = await chatApi.deleteMessage(messageId);
      if (res.message) {
        setMessages((prev) => prev.map((m) => (m.message_id === messageId ? res.message : m)));
      }
    } catch (err) {
      showError(err.message);
    }
  }

  async function handleTogglePin(messageId, pin) {
    try {
      const res = await chatApi.setPin(messageId, pin);
      if (res.message) {
        setMessages((prev) => prev.map((m) => (m.message_id === messageId ? res.message : m)));
      }
    } catch (err) {
      showError(err.message);
    }
  }

  async function handleToggleBookmark(messageId) {
    try {
      const res = await chatApi.toggleBookmark(messageId);
      setMessages((prev) =>
        prev.map((m) =>
          m.message_id === messageId ? { ...m, is_bookmarked: res.is_bookmarked } : m
        )
      );
    } catch (err) {
      showError(err.message);
    }
  }

  async function handleQuickSummarize() {
    if (!activeConvId || summarizingTop) return;
    setSummarizingTop(true);
    try {
      await chatApi.summarizeConversation(activeConvId);
      showNotice('Summary posted.');
    } catch (err) {
      showError(err.message);
    } finally {
      setSummarizingTop(false);
    }
  }

  function handleSelectConversation(convId) {
    setSearchQuery('');
    setOnlyPinned(false);
    setOnlyBookmarked(false);
    setThreadRootId(null);
    setFocusedTaskId(null);
    setActiveConvId(convId);
    setMobileShowChat(true);
    const chosen = conversations.find((c) => Number(c.conversation_id) === Number(convId));
    if (chosen?.trip_id && setActiveTripId && Number(chosen.trip_id) !== Number(tripId)) {
      lastSyncedTripIdRef.current = Number(chosen.trip_id);
      setActiveTripId(Number(chosen.trip_id));
    }
  }

  return (
    <div className="space-y-3">
      {/* Contextual Action Bar aligned to the active conversation */}
      {convDetail && (
        <div className="px-4 py-2 bg-block-lime border border-hairline rounded-2xl flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 min-w-0 text-xs text-black">
            {linkedTrip ? (
              <>
                <span className="font-bold truncate max-w-[260px]">{linkedTrip.title}</span>
                {linkedTrip.travel_window && (
                  <span className="px-2 py-0.5 rounded-pill bg-white/80 border border-hairline font-medium">
                    {linkedTrip.travel_window.replace(',', ' to ')}
                  </span>
                )}
                <span className="text-black/70 font-medium">
                  {scheduledLegsCount} stops · {openTaskCount} open task{openTaskCount === 1 ? '' : 's'}
                </span>
              </>
            ) : (
              <>
                <span className="font-bold truncate">{convDetail.display_title || convDetail.title}</span>
                <span className="text-black/70 font-medium">
                  {members.length} member{members.length === 1 ? '' : 's'} · {openTaskCount} open task
                  {openTaskCount === 1 ? '' : 's'}
                </span>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <button
              type="button"
              disabled={summarizingTop}
              onClick={handleQuickSummarize}
              className="px-3 py-1 rounded-pill bg-white hover:bg-surface-soft border border-hairline text-xs font-semibold text-black flex items-center gap-1 disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{summarizingTop ? 'Summarizing...' : 'Summarize'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setDrawerTab('TASKS');
                setNewTaskTrigger((n) => n + 1);
              }}
              className="px-3 py-1 rounded-pill bg-white hover:bg-surface-soft border border-hairline text-xs font-semibold text-black flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>
                {proposedTaskCount > 0 ? `Review Tasks (${proposedTaskCount})` : 'Add Task'}
              </span>
            </button>

            {convDetail.trip_id && onNavigateTab && (
              <button
                type="button"
                onClick={() => onNavigateTab('itinerary', convDetail.trip_id)}
                className="px-3 py-1 rounded-pill bg-black text-white hover:bg-black/85 text-xs font-semibold flex items-center gap-1"
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Open Plan</span>
              </button>
            )}
          </div>
        </div>
      )}

      {(errorMsg || noticeMsg || realtimeStatus === 'reconnecting') && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {errorMsg && (
            <div className="flex-1 px-3 py-2 text-xs font-medium bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-center justify-between">
              <span>{errorMsg}</span>
              <button
                type="button"
                onClick={() => setErrorMsg('')}
                className="ml-3 font-bold underline"
              >
                Dismiss
              </button>
            </div>
          )}
          {noticeMsg && !errorMsg && (
            <div className="px-3 py-1.5 text-xs font-semibold bg-block-lime border border-hairline text-black rounded-xl">
              {noticeMsg}
            </div>
          )}
          {realtimeStatus === 'reconnecting' && (
            <div className="px-3 py-1.5 text-xs bg-surface-soft border border-hairline text-black/70 rounded-xl flex items-center gap-1.5">
              <RefreshCw className="w-3 h-3 animate-spin" />
              <span>Reconnecting live sync...</span>
            </div>
          )}
        </div>
      )}

      <div className="bg-white border border-hairline rounded-2xl overflow-hidden flex h-[calc(100vh-230px)] min-h-[540px] max-h-[820px]">
        {/* Left: Conversation List */}
        <div className={`${mobileShowChat ? 'hidden md:flex' : 'flex'} w-full md:w-auto h-full`}>
          <ConversationSidebar
            conversations={conversations}
            activeConversationId={activeConvId}
            onSelectConversation={handleSelectConversation}
            onOpenNewModal={() => setShowNewModal(true)}
            onOpenInvitesModal={() => setShowInvitesModal(true)}
            pendingInviteCount={myInvitations.length}
          />
        </div>

        {/* Center: Main Group Discussion */}
        <div className={`${mobileShowChat ? 'flex' : 'hidden md:flex'} flex-1 min-w-0 h-full`}>
          <ChatWindow
            conversation={convDetail}
            members={members}
            messages={messages}
            openTaskCount={openTaskCount}
            currentUserId={currentUserId}
            onlineUserIds={onlineUserIds}
            typingUsers={activeTypingNames}
            myMembership={myMembership}
            searchQuery={searchQuery}
            onlyPinned={onlyPinned}
            onlyBookmarked={onlyBookmarked}
            threadRootId={threadRootId}
            activeDrawerTab={drawerTab}
            onBackMobile={() => setMobileShowChat(false)}
            onSearchChange={setSearchQuery}
            onToggleOnlyPinned={() => setOnlyPinned((v) => !v)}
            onToggleOnlyBookmarked={() => setOnlyBookmarked((v) => !v)}
            onSetThreadRootId={setThreadRootId}
            onOpenDrawerTab={(tab) => setDrawerTab((prev) => (prev === tab ? null : tab))}
            onSendMessage={handleSendMessage}
            onEditMessage={handleEditMessage}
            onDeleteMessage={handleDeleteMessage}
            onTogglePin={handleTogglePin}
            onToggleBookmark={handleToggleBookmark}
            onForwardMessage={(msg) => setForwardMsg(msg)}
            onTypingChange={(isTyping) => {
              if (activeConvId) liveClientRef.current?.sendTyping(activeConvId, isTyping);
            }}
            onFocusTask={(taskId) => {
              setFocusedTaskId(taskId);
              setDrawerTab('TASKS');
            }}
          />
        </div>

        {/* Right: Tasks or Group Panel (opens on demand) */}
        {drawerTab && convDetail && (
          <div className="hidden lg:flex h-full">
            <ContextDrawer
              activeTab={drawerTab}
              newTaskTrigger={newTaskTrigger}
              conversation={convDetail}
              members={members}
              myMembership={myMembership}
              tasks={tasks}
              groupInvitations={groupInvitations}
              platformUsers={platformUsers}
              onlineUserIds={onlineUserIds}
              focusedTaskId={focusedTaskId}
              onClose={() => setDrawerTab(null)}
              onTabChange={setDrawerTab}
              onJumpToMessage={(msgId) => {
                const el = document.getElementById(`msg-${msgId}`);
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  el.classList.add('ring-2', 'ring-black');
                  setTimeout(() => el.classList.remove('ring-2', 'ring-black'), 1400);
                }
              }}
              onRefreshConversation={() => {
                loadConversationData(activeConvId);
                loadBootstrap(activeConvId);
              }}
              onRefreshTasks={() =>
                chatApi.listTasks(activeConvId).then((r) => setTasks(r.tasks || []))
              }
              onRefreshInvitations={() =>
                chatApi
                  .listGroupInvitations(activeConvId)
                  .then((r) => setGroupInvitations(r.invitations || []))
              }
              onError={showError}
              onSuccessNotice={showNotice}
              onItinerarySynced={(tid, leg) => {
                onItinerarySynced?.(tid, leg);
                onRefresh?.(tid);
              }}
            />
          </div>
        )}
      </div>

      {/* Tablet / Mobile Slide-Over Drawer */}
      {drawerTab && convDetail && (
        <div className="lg:hidden fixed inset-0 z-40 flex justify-end bg-black/40">
          <div className="w-full max-w-sm h-full bg-white shadow-2xl">
            <ContextDrawer
              activeTab={drawerTab}
              newTaskTrigger={newTaskTrigger}
              conversation={convDetail}
              members={members}
              myMembership={myMembership}
              tasks={tasks}
              groupInvitations={groupInvitations}
              platformUsers={platformUsers}
              onlineUserIds={onlineUserIds}
              focusedTaskId={focusedTaskId}
              onClose={() => setDrawerTab(null)}
              onTabChange={setDrawerTab}
              onJumpToMessage={(msgId) => {
                setDrawerTab(null);
                setTimeout(() => {
                  const el = document.getElementById(`msg-${msgId}`);
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.classList.add('ring-2', 'ring-black');
                    setTimeout(() => el.classList.remove('ring-2', 'ring-black'), 1400);
                  }
                }, 80);
              }}
              onRefreshConversation={() => {
                loadConversationData(activeConvId);
                loadBootstrap(activeConvId);
              }}
              onRefreshTasks={() =>
                chatApi.listTasks(activeConvId).then((r) => setTasks(r.tasks || []))
              }
              onRefreshInvitations={() =>
                chatApi
                  .listGroupInvitations(activeConvId)
                  .then((r) => setGroupInvitations(r.invitations || []))
              }
              onError={showError}
              onSuccessNotice={showNotice}
              onItinerarySynced={(tid, leg) => {
                onItinerarySynced?.(tid, leg);
                onRefresh?.(tid);
              }}
            />
          </div>
        </div>
      )}

      {/* Modals */}
      <NewConversationModal
        open={showNewModal}
        onClose={() => setShowNewModal(false)}
        currentUserId={currentUserId}
        platformUsers={platformUsers}
        trips={trips}
        onCreated={(conv) => {
          loadBootstrap(conv?.conversation_id);
          setMobileShowChat(true);
        }}
      />

      <InvitationsModal
        open={showInvitesModal}
        onClose={() => setShowInvitesModal(false)}
        invitations={myInvitations}
        onUpdated={(joinedConvId) => {
          loadBootstrap(joinedConvId || activeConvId);
          if (joinedConvId) setMobileShowChat(true);
        }}
      />

      <ForwardMessageModal
        open={Boolean(forwardMsg)}
        message={forwardMsg}
        conversations={conversations}
        onClose={() => setForwardMsg(null)}
        onForwarded={(targetConvId) => {
          showNotice('Message forwarded.');
          if (targetConvId !== activeConvId) {
            setActiveConvId(targetConvId);
          }
        }}
      />
    </div>
  );
}
