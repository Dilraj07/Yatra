import React, { useEffect, useState } from 'react';
import {
  Bot,
  CalendarPlus,
  Check,
  Copy,
  KeyRound,
  LogOut,
  Plus,
  Sparkles,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { chatApi } from '../../api/chatApi';

const STATUS_STYLES = {
  PROPOSED: 'bg-block-lime text-black border-hairline',
  TODO: 'bg-white text-black border-hairline',
  IN_PROGRESS: 'bg-surface-soft text-black border-black',
  BLOCKED: 'bg-red-50 text-red-700 border-red-200',
  DONE: 'bg-black text-white border-black',
  REJECTED: 'bg-surface-soft text-black/45 border-hairline line-through',
};

function formatDateTimeShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ContextDrawer({
  activeTab, // 'TASKS' | 'INFO' | null
  newTaskTrigger = 0,
  conversation,
  members = [],
  myMembership,
  tasks = [],
  groupInvitations = [],
  platformUsers = [],
  onlineUserIds = [],
  focusedTaskId,
  onClose,
  onTabChange,
  onJumpToMessage,
  onRefreshConversation,
  onRefreshTasks,
  onRefreshInvitations,
  onError,
  onSuccessNotice,
  onItinerarySynced,
}) {
  const [showNewTask, setShowNewTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskAssignee, setNewTaskAssignee] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState('MEDIUM');
  const [newTaskDue, setNewTaskDue] = useState('');
  const [scheduleTaskId, setScheduleTaskId] = useState(null);
  const [schedStart, setSchedStart] = useState('');
  const [schedEnd, setSchedEnd] = useState('');
  const [schedKind, setSchedKind] = useState('ACTIVITY');
  const [schedCost, setSchedCost] = useState('0');
  const [busyTaskAction, setBusyTaskAction] = useState(null);

  // Group edit & invite state
  const [editingGroup, setEditingGroup] = useState(false);
  const [groupTitle, setGroupTitle] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [addUserId, setAddUserId] = useState('');
  const [copiedCode, setCopiedCode] = useState('');
  const [summarizing, setSummarizing] = useState(false);

  useEffect(() => {
    if (conversation) {
      setGroupTitle(conversation.title || '');
      setGroupDesc(conversation.description || '');
    }
    setEditingGroup(false);
    setScheduleTaskId(null);
  }, [conversation?.conversation_id]);

  useEffect(() => {
    if (newTaskTrigger > 0) {
      setShowNewTask(true);
    }
  }, [newTaskTrigger]);

  if (!activeTab || !conversation) return null;

  const normalizedTab = activeTab === 'COPILOT' ? 'INFO' : activeTab;

  const roleRank = { MEMBER: 1, MODERATOR: 2, ADMIN: 3, OWNER: 4 };
  const myRank = roleRank[myMembership?.role || 'MEMBER'] || 1;
  const canManageMembers = myRank >= 3 || Boolean(myMembership?.can_manage_members);
  const canConfigureAgent = myRank >= 3 || Boolean(myMembership?.can_configure_agent);
  const memberIdsSet = new Set(members.map((m) => Number(m.user_id)));
  const nonMembers = platformUsers.filter((u) => !memberIdsSet.has(Number(u.user_id)));
  const onlineSet = new Set(onlineUserIds.map(Number));

  const visibleTasks = tasks.filter((t) => t.status !== 'REJECTED');
  const openTasksCount = visibleTasks.filter((t) => t.status !== 'DONE').length;

  async function handleCreateTask(e) {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    try {
      await chatApi.createTask(conversation.conversation_id, {
        title: newTaskTitle.trim(),
        assigned_to_user_id: newTaskAssignee ? Number(newTaskAssignee) : null,
        priority: newTaskPriority,
        due_at: newTaskDue ? new Date(newTaskDue).toISOString() : null,
      });
      setNewTaskTitle('');
      setNewTaskAssignee('');
      setNewTaskDue('');
      setShowNewTask(false);
      await onRefreshTasks();
      onSuccessNotice?.('Task added.');
    } catch (err) {
      onError?.(err.message);
    }
  }

  async function handleAuthorize(taskId, action, scheduleIntoItinerary = false) {
    setBusyTaskAction(taskId);
    try {
      const payload = {
        action,
        schedule_into_itinerary: scheduleIntoItinerary,
      };
      if (scheduleIntoItinerary && scheduleTaskId === taskId) {
        if (schedStart) payload.schedule_start = new Date(schedStart).toISOString();
        if (schedEnd) payload.schedule_end = new Date(schedEnd).toISOString();
        payload.leg_kind = schedKind;
        payload.est_cost_inr = Number(schedCost || 0);
      }
      const res = await chatApi.authorizeTask(taskId, payload);
      setScheduleTaskId(null);
      await onRefreshTasks();
      if (res?.created_leg) {
        onItinerarySynced?.(conversation.trip_id, res.created_leg);
        onSuccessNotice?.('Added to trip itinerary.');
      } else {
        onSuccessNotice?.(action === 'CONFIRM' ? 'Task approved.' : 'Task dismissed.');
      }
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBusyTaskAction(null);
    }
  }

  async function handleUpdateTaskStatus(taskId, status) {
    try {
      await chatApi.updateTask(taskId, { status });
      await onRefreshTasks();
    } catch (err) {
      onError?.(err.message);
    }
  }

  async function handleAgentModeChange(mode) {
    try {
      await chatApi.configureAgent(conversation.conversation_id, {
        agent_enabled: mode !== 'OFF',
        agent_mode: mode,
      });
      await onRefreshConversation();
      onSuccessNotice?.(`AI Copilot set to ${mode === 'ACTIVE' ? 'Auto' : mode === 'OBSERVE' ? '@copilot only' : 'Off'}.`);
    } catch (err) {
      onError?.(err.message);
    }
  }

  async function handleSummarize() {
    setSummarizing(true);
    try {
      await chatApi.summarizeConversation(conversation.conversation_id);
      onSuccessNotice?.('Summary posted to chat.');
    } catch (err) {
      onError?.(err.message);
    } finally {
      setSummarizing(false);
    }
  }

  async function handleSaveGroupSettings(e) {
    e.preventDefault();
    try {
      await chatApi.updateConversation(conversation.conversation_id, {
        title: groupTitle.trim(),
        description: groupDesc.trim(),
      });
      setEditingGroup(false);
      await onRefreshConversation();
      onSuccessNotice?.('Group updated.');
    } catch (err) {
      onError?.(err.message);
    }
  }

  async function handleAddMember(e) {
    e.preventDefault();
    if (!addUserId) return;
    try {
      await chatApi.addMember(conversation.conversation_id, {
        user_id: Number(addUserId),
        role: 'MEMBER',
      });
      setAddUserId('');
      await onRefreshConversation();
      onSuccessNotice?.('Person added to group.');
    } catch (err) {
      onError?.(err.message);
    }
  }

  async function handleRoleChange(targetUserId, role) {
    try {
      await chatApi.updateMemberRole(conversation.conversation_id, targetUserId, { role });
      await onRefreshConversation();
    } catch (err) {
      onError?.(err.message);
    }
  }

  async function handleRemoveMember(targetUserId) {
    try {
      await chatApi.removeMember(conversation.conversation_id, targetUserId);
      await onRefreshConversation();
    } catch (err) {
      onError?.(err.message);
    }
  }

  async function handleGenerateInviteCode() {
    try {
      const res = await chatApi.createInvitation(conversation.conversation_id, {
        role: 'MEMBER',
        max_uses: 10,
      });
      const code = res?.invitation?.invite_code;
      if (code) {
        navigator.clipboard?.writeText(code);
        setCopiedCode(code);
        setTimeout(() => setCopiedCode(''), 2000);
      }
      await onRefreshInvitations();
      onSuccessNotice?.('Invite code copied.');
    } catch (err) {
      onError?.(err.message);
    }
  }

  async function handleRevokeInvite(invitationId) {
    try {
      await chatApi.revokeInvitation(conversation.conversation_id, invitationId);
      await onRefreshInvitations();
    } catch (err) {
      onError?.(err.message);
    }
  }

  function openScheduleEditor(task) {
    setScheduleTaskId(task.task_id);
    const defaultStart = task.schedule_start
      ? new Date(task.schedule_start)
      : new Date(Date.now() + 86400000);
    const defaultEnd = task.schedule_end
      ? new Date(task.schedule_end)
      : new Date(defaultStart.getTime() + 7200000);
    setSchedStart(defaultStart.toISOString().slice(0, 16));
    setSchedEnd(defaultEnd.toISOString().slice(0, 16));
    setSchedKind(task.leg_kind || 'ACTIVITY');
    setSchedCost(String(task.est_cost_inr || 0));
  }

  return (
    <aside className="w-full lg:w-88 border-l border-hairline bg-white flex flex-col h-full shrink-0 overflow-hidden">
      {/* Drawer Header Tabs */}
      <div className="px-3 py-2.5 border-b border-hairline flex items-center justify-between bg-surface-soft/50 shrink-0">
        <div className="flex items-center gap-1">
          {[
            { id: 'TASKS', label: openTasksCount > 0 ? `Tasks (${openTasksCount})` : 'Tasks' },
            { id: 'INFO', label: 'Group' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`px-3 py-1.5 rounded-pill text-xs font-semibold transition-colors ${
                normalizedTab === tab.id
                  ? 'bg-black text-white'
                  : 'text-black/65 hover:text-black hover:bg-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-full hover:bg-white text-black/60 hover:text-black"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Drawer Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {normalizedTab === 'TASKS' && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-black">Action Items</span>
              <button
                type="button"
                onClick={() => setShowNewTask((s) => !s)}
                className="px-3 py-1 rounded-pill bg-block-lime text-black text-xs font-semibold border border-hairline flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Task</span>
              </button>
            </div>

            {showNewTask && (
              <form
                onSubmit={handleCreateTask}
                className="p-3 bg-surface-soft border border-hairline rounded-xl space-y-2.5"
              >
                <input
                  type="text"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  placeholder="What needs to be done?"
                  className="w-full px-3 py-1.5 text-xs bg-white border border-hairline rounded-lg focus:outline-none focus:border-black"
                  required
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={newTaskAssignee}
                    onChange={(e) => setNewTaskAssignee(e.target.value)}
                    className="px-2 py-1.5 text-xs bg-white border border-hairline rounded-lg"
                  >
                    <option value="">Anyone</option>
                    {members.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.full_name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={newTaskPriority}
                    onChange={(e) => setNewTaskPriority(e.target.value)}
                    className="px-2 py-1.5 text-xs bg-white border border-hairline rounded-lg"
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="URGENT">Urgent</option>
                  </select>
                </div>
                <input
                  type="datetime-local"
                  value={newTaskDue}
                  onChange={(e) => setNewTaskDue(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-hairline rounded-lg"
                />
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowNewTask(false)}
                    className="px-3 py-1 text-xs rounded-pill border border-hairline bg-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-3 py-1 text-xs font-semibold rounded-pill bg-black text-white"
                  >
                    Save
                  </button>
                </div>
              </form>
            )}

            <div className="space-y-2.5">
              {visibleTasks.length === 0 ? (
                <p className="py-8 text-center text-xs text-black/50">
                  No tasks yet. Type an assignment in chat or click <strong>Add Task</strong>.
                </p>
              ) : (
                visibleTasks.map((t) => {
                  const highlighted = Number(focusedTaskId) === Number(t.task_id);
                  return (
                    <div
                      key={t.task_id}
                      className={`p-3 rounded-xl border bg-white space-y-2 ${
                        highlighted ? 'border-black ring-1 ring-black' : 'border-hairline'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-xs font-bold text-black leading-snug">{t.title}</h4>
                        <span
                          className={`px-2 py-0.5 rounded-pill border text-[10px] font-bold shrink-0 ${
                            STATUS_STYLES[t.status] || STATUS_STYLES.TODO
                          }`}
                        >
                          {t.status}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-black/60">
                        <span>{t.assignee_name || 'Unassigned'}</span>
                        {t.due_at && <span>Due {formatDateTimeShort(t.due_at)}</span>}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {t.source_message_id && (
                          <button
                            type="button"
                            onClick={() => onJumpToMessage(t.source_message_id)}
                            className="text-[11px] font-semibold text-black underline"
                          >
                            View in chat
                          </button>
                        )}
                        {t.linked_leg_id && (
                          <span className="px-2 py-0.5 rounded-pill bg-block-lime/60 border border-hairline text-[10px] font-semibold text-black">
                            In Itinerary
                          </span>
                        )}
                      </div>

                      {t.status === 'PROPOSED' ? (
                        <div className="pt-2 border-t border-hairline space-y-2">
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              disabled={busyTaskAction === t.task_id}
                              onClick={() => handleAuthorize(t.task_id, 'CONFIRM', false)}
                              className="px-3 py-1 rounded-pill bg-black text-white text-[11px] font-semibold hover:bg-black/85"
                            >
                              Approve
                            </button>
                            {conversation.trip_id && (
                              <button
                                type="button"
                                onClick={() =>
                                  scheduleTaskId === t.task_id
                                    ? setScheduleTaskId(null)
                                    : openScheduleEditor(t)
                                }
                                className="px-3 py-1 rounded-pill bg-block-lime text-black border border-hairline text-[11px] font-semibold flex items-center gap-1"
                              >
                                <CalendarPlus className="w-3 h-3" />
                                <span>Add to Plan</span>
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={busyTaskAction === t.task_id}
                              onClick={() => handleAuthorize(t.task_id, 'REJECT', false)}
                              className="px-2.5 py-1 rounded-pill border border-hairline text-[11px] text-black/65 hover:text-black"
                            >
                              Dismiss
                            </button>
                          </div>

                          {scheduleTaskId === t.task_id && (
                            <div className="p-2.5 bg-surface-soft border border-hairline rounded-lg space-y-2">
                              <div className="grid grid-cols-2 gap-1.5">
                                <select
                                  value={schedKind}
                                  onChange={(e) => setSchedKind(e.target.value)}
                                  className="px-2 py-1 text-[11px] bg-white border border-hairline rounded"
                                >
                                  <option value="ACTIVITY">Activity</option>
                                  <option value="FLIGHT">Flight</option>
                                  <option value="HOTEL">Hotel</option>
                                  <option value="TRANSFER">Transfer</option>
                                  <option value="ATTRACTION">Attraction</option>
                                </select>
                                <input
                                  type="number"
                                  min="0"
                                  value={schedCost}
                                  onChange={(e) => setSchedCost(e.target.value)}
                                  placeholder="Cost INR"
                                  className="px-2 py-1 text-[11px] bg-white border border-hairline rounded"
                                />
                              </div>
                              <input
                                type="datetime-local"
                                value={schedStart}
                                onChange={(e) => setSchedStart(e.target.value)}
                                className="w-full px-2 py-1 text-[11px] bg-white border border-hairline rounded"
                              />
                              <input
                                type="datetime-local"
                                value={schedEnd}
                                onChange={(e) => setSchedEnd(e.target.value)}
                                className="w-full px-2 py-1 text-[11px] bg-white border border-hairline rounded"
                              />
                              <button
                                type="button"
                                disabled={busyTaskAction === t.task_id}
                                onClick={() => handleAuthorize(t.task_id, 'CONFIRM', true)}
                                className="w-full py-1.5 rounded-pill bg-black text-white text-[11px] font-semibold"
                              >
                                {busyTaskAction === t.task_id ? 'Saving...' : 'Confirm & Schedule'}
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="pt-1.5 border-t border-hairline flex items-center justify-between">
                          <span className="text-[11px] text-black/50">Progress</span>
                          <select
                            value={t.status}
                            onChange={(e) => handleUpdateTaskStatus(t.task_id, e.target.value)}
                            className="px-2 py-1 text-[11px] font-semibold bg-surface-soft border border-hairline rounded-lg"
                          >
                            <option value="TODO">To Do</option>
                            <option value="IN_PROGRESS">In Progress</option>
                            <option value="BLOCKED">Blocked</option>
                            <option value="DONE">Done</option>
                          </select>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        {normalizedTab === 'INFO' && (
          <>
            {/* Group Name & Description */}
            <div className="p-3.5 bg-surface-soft border border-hairline rounded-xl space-y-2">
              {editingGroup ? (
                <form onSubmit={handleSaveGroupSettings} className="space-y-2">
                  <input
                    type="text"
                    value={groupTitle}
                    onChange={(e) => setGroupTitle(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-hairline rounded-lg"
                    required
                  />
                  <input
                    type="text"
                    value={groupDesc}
                    onChange={(e) => setGroupDesc(e.target.value)}
                    placeholder="Group topic"
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-hairline rounded-lg"
                  />
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditingGroup(false)}
                      className="px-3 py-1 text-xs rounded-pill border border-hairline bg-white"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-3 py-1 text-xs font-semibold rounded-pill bg-black text-white"
                    >
                      Save
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-black break-words">
                      {conversation.display_title || conversation.title}
                    </h3>
                    {conversation.description && (
                      <p className="text-xs text-black/60 mt-0.5 break-words">
                        {conversation.description}
                      </p>
                    )}
                  </div>
                  {canManageMembers && conversation.kind === 'GROUP' && (
                    <button
                      type="button"
                      onClick={() => setEditingGroup(true)}
                      className="px-2.5 py-1 text-[11px] font-semibold rounded-pill border border-hairline bg-white shrink-0"
                    >
                      Edit
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Clean AI Assistant Control */}
            <div className="p-3.5 bg-surface-soft border border-hairline rounded-xl space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-black">
                  <Bot className="w-4 h-4" />
                  <span>AI Assistant</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-1 p-1 bg-white border border-hairline rounded-pill">
                {[
                  { id: 'ACTIVE', label: 'Auto' },
                  { id: 'OBSERVE', label: '@copilot' },
                  { id: 'OFF', label: 'Off' },
                ].map((m) => {
                  const selected =
                    (conversation.agent_enabled === false ? 'OFF' : conversation.agent_mode) ===
                    m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      disabled={!canConfigureAgent}
                      onClick={() => handleAgentModeChange(m.id)}
                      className={`py-1 text-[11px] font-semibold rounded-pill transition-colors ${
                        selected ? 'bg-black text-white' : 'text-black/65 hover:text-black'
                      } disabled:opacity-50`}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                disabled={summarizing}
                onClick={handleSummarize}
                className="w-full py-1.5 rounded-pill border border-hairline bg-white hover:bg-hairline text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{summarizing ? 'Summarizing...' : 'Summarize Chat'}</span>
              </button>
            </div>

            {/* Members List */}
            <div>
              <h4 className="text-xs font-bold text-black mb-2">Members ({members.length})</h4>
              <div className="border border-hairline rounded-xl divide-y divide-hairline">
                {members.map((m) => {
                  const online = onlineSet.has(Number(m.user_id));
                  const targetRank = roleRank[m.role || 'MEMBER'] || 1;
                  const canEditTarget =
                    canManageMembers &&
                    m.role !== 'OWNER' &&
                    (myMembership?.role === 'OWNER' || myRank > targetRank);
                  return (
                    <div key={m.user_id} className="px-3 py-2.5 flex items-center justify-between gap-2">
                      <div className="min-w-0 flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            online ? 'bg-emerald-600' : 'bg-black/20'
                          }`}
                          title={online ? 'Online' : 'Offline'}
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-black truncate">{m.full_name}</p>
                          <p className="text-[10px] text-black/50 truncate">{m.email}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {canEditTarget ? (
                          <select
                            value={m.role}
                            onChange={(e) => handleRoleChange(m.user_id, e.target.value)}
                            className="px-2 py-0.5 text-[10px] font-semibold bg-surface-soft border border-hairline rounded-lg"
                          >
                            <option value="ADMIN">Admin</option>
                            <option value="MODERATOR">Mod</option>
                            <option value="MEMBER">Member</option>
                          </select>
                        ) : (
                          <span className="px-2 py-0.5 rounded-pill bg-surface-soft border border-hairline text-[10px] font-semibold text-black/75">
                            {m.role === 'OWNER' ? 'Owner' : m.role === 'ADMIN' ? 'Admin' : 'Member'}
                          </span>
                        )}
                        {canEditTarget && (
                          <button
                            type="button"
                            onClick={() => handleRemoveMember(m.user_id)}
                            title="Remove"
                            className="p-1 text-black/45 hover:text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {conversation.kind === 'GROUP' && myMembership && myMembership.role !== 'OWNER' && (
                <button
                  type="button"
                  onClick={() => handleRemoveMember(myMembership.user_id)}
                  className="mt-2.5 w-full py-1.5 rounded-pill border border-hairline text-xs font-semibold text-red-600 hover:bg-red-50 flex items-center justify-center gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Leave Group</span>
                </button>
              )}
            </div>

            {/* Clean Add / Invite Controls (Zero Overflow) */}
            {conversation.kind === 'GROUP' && canManageMembers && (
              <div className="p-3.5 bg-surface-soft border border-hairline rounded-xl space-y-2.5">
                <div className="flex items-center gap-1.5 text-xs font-bold text-black">
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Invite People</span>
                </div>

                {nonMembers.length > 0 && (
                  <form onSubmit={handleAddMember} className="flex items-center gap-2">
                    <select
                      value={addUserId}
                      onChange={(e) => setAddUserId(e.target.value)}
                      className="flex-1 min-w-0 px-2.5 py-1.5 text-xs bg-white border border-hairline rounded-lg"
                    >
                      <option value="">Choose user...</option>
                      {nonMembers.map((u) => (
                        <option key={u.user_id} value={u.user_id}>
                          {u.full_name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      disabled={!addUserId}
                      className="px-3.5 py-1.5 rounded-pill bg-black text-white text-xs font-semibold disabled:opacity-40 shrink-0"
                    >
                      Add
                    </button>
                  </form>
                )}

                <button
                  type="button"
                  onClick={handleGenerateInviteCode}
                  className="w-full py-1.5 rounded-pill border border-hairline bg-white hover:bg-hairline text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  {copiedCode ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Copied Code: {copiedCode}</span>
                    </>
                  ) : (
                    <>
                      <KeyRound className="w-3.5 h-3.5" />
                      <span>Create & Copy Invite Code</span>
                    </>
                  )}
                </button>

                {groupInvitations.filter((i) => i.status === 'PENDING').length > 0 && (
                  <div className="space-y-1 pt-1">
                    {groupInvitations
                      .filter((i) => i.status === 'PENDING')
                      .slice(0, 3)
                      .map((inv) => (
                        <div
                          key={inv.invitation_id}
                          className="px-2.5 py-1.5 bg-white border border-hairline rounded-lg flex items-center justify-between text-[11px]"
                        >
                          <span className="font-mono font-bold text-black">{inv.invite_code}</span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard?.writeText(inv.invite_code);
                                setCopiedCode(inv.invite_code);
                                setTimeout(() => setCopiedCode(''), 1500);
                              }}
                              className="text-black/60 hover:text-black"
                              title="Copy"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRevokeInvite(inv.invitation_id)}
                              className="text-red-600 font-semibold"
                            >
                              Revoke
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
