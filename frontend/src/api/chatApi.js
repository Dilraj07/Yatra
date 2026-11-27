/**
 * Real-time Chat, Group RBAC, Operational Task, and Notification API client.
 * Zero mock fallback: HTTP errors (401/403/404/409) propagate directly to the UI.
 */

export function getChatAuthToken() {
  const tok = localStorage.getItem('yatra_token');
  if (!tok || tok === 'demo_token') return null;
  return tok;
}

export function getActiveChatUser() {
  try {
    const raw = localStorage.getItem('yatra_user');
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore malformed storage
  }
  return null;
}

function extractErrorMessage(data, fallback) {
  if (!data) return fallback;
  if (typeof data.detail === 'string') return data.detail;
  if (data.detail && typeof data.detail === 'object' && !Array.isArray(data.detail)) {
    return data.detail.message || data.detail.error_code || fallback;
  }
  if (Array.isArray(data.detail) && data.detail.length > 0) {
    return data.detail.map((d) => d.msg || String(d)).join('; ');
  }
  if (typeof data.message === 'string') return data.message;
  return fallback;
}

async function chatFetch(path, options = {}) {
  const token = getChatAuthToken();
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(path, {
    ...options,
    headers,
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { detail: text };
    }
  }

  if (!res.ok) {
    const err = new Error(extractErrorMessage(data, `Request failed (${res.status})`));
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

function buildQuery(params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '' && v !== false) {
      qs.set(k, String(v));
    }
  });
  const str = qs.toString();
  return str ? `?${str}` : '';
}

export const chatApi = {
  // Conversations & Groups
  listConversations: () => chatFetch('/api/chat/conversations'),
  createConversation: (payload) =>
    chatFetch('/api/chat/conversations', { method: 'POST', body: JSON.stringify(payload) }),
  getConversation: (conversationId) => chatFetch(`/api/chat/conversations/${conversationId}`),
  updateConversation: (conversationId, payload) =>
    chatFetch(`/api/chat/conversations/${conversationId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  configureAgent: (conversationId, payload) =>
    chatFetch(`/api/chat/conversations/${conversationId}/agent`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  // Members & Roles
  listMembers: (conversationId) => chatFetch(`/api/chat/conversations/${conversationId}/members`),
  addMember: (conversationId, payload) =>
    chatFetch(`/api/chat/conversations/${conversationId}/members`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateMemberRole: (conversationId, targetUserId, payload) =>
    chatFetch(`/api/chat/conversations/${conversationId}/members/${targetUserId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  removeMember: (conversationId, targetUserId) =>
    chatFetch(`/api/chat/conversations/${conversationId}/members/${targetUserId}`, {
      method: 'DELETE',
    }),
  listMembershipHistory: (conversationId) =>
    chatFetch(`/api/chat/conversations/${conversationId}/history`),

  // Invitations & Codes
  listGroupInvitations: (conversationId) =>
    chatFetch(`/api/chat/conversations/${conversationId}/invitations`),
  createInvitation: (conversationId, payload) =>
    chatFetch(`/api/chat/conversations/${conversationId}/invitations`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  revokeInvitation: (conversationId, invitationId) =>
    chatFetch(`/api/chat/conversations/${conversationId}/invitations/${invitationId}`, {
      method: 'DELETE',
    }),
  listMyInvitations: () => chatFetch('/api/chat/invitations'),
  respondInvitation: (invitationId, action) =>
    chatFetch(`/api/chat/invitations/${invitationId}/respond`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
  joinByInviteCode: (inviteCode) =>
    chatFetch(`/api/chat/invitations/code/${encodeURIComponent(inviteCode)}/join`, {
      method: 'POST',
    }),

  // Messages, Threading, Receipts, Pins, Bookmarks
  listMessages: (conversationId, params = {}) =>
    chatFetch(`/api/chat/conversations/${conversationId}/messages${buildQuery(params)}`),
  sendMessage: (conversationId, payload) =>
    chatFetch(`/api/chat/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  editMessage: (messageId, body) =>
    chatFetch(`/api/chat/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ body }),
    }),
  deleteMessage: (messageId) =>
    chatFetch(`/api/chat/messages/${messageId}`, { method: 'DELETE' }),
  markRead: (conversationId, upToMessageId) =>
    chatFetch(`/api/chat/conversations/${conversationId}/read`, {
      method: 'POST',
      body: JSON.stringify({ up_to_message_id: upToMessageId }),
    }),
  setPin: (messageId, pin) =>
    chatFetch(`/api/chat/messages/${messageId}/pin`, {
      method: 'POST',
      body: JSON.stringify({ pin }),
    }),
  toggleBookmark: (messageId) =>
    chatFetch(`/api/chat/messages/${messageId}/bookmark`, { method: 'POST' }),

  // Attachments
  uploadAttachment: (conversationId, file) => {
    const form = new FormData();
    form.append('file', file);
    return chatFetch(`/api/chat/conversations/${conversationId}/attachments`, {
      method: 'POST',
      body: form,
    });
  },
  getAttachmentUrl: (attachmentId) => {
    const token = getChatAuthToken();
    const qs = token ? `?token=${encodeURIComponent(token)}` : '';
    return `/api/chat/attachments/${attachmentId}${qs}`;
  },

  // Agent Operations
  summarizeConversation: (conversationId, customInstruction = null) =>
    chatFetch(`/api/chat/conversations/${conversationId}/agent/summarize`, {
      method: 'POST',
      body: JSON.stringify({ custom_instruction: customInstruction }),
    }),
  listAgentAudit: (conversationId) =>
    chatFetch(`/api/chat/conversations/${conversationId}/agent/audit`),

  // Tasks & Itinerary Integration
  listTasks: (conversationId, statusFilter = null) =>
    chatFetch(`/api/chat/conversations/${conversationId}/tasks${buildQuery({ status: statusFilter })}`),
  createTask: (conversationId, payload) =>
    chatFetch(`/api/chat/conversations/${conversationId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateTask: (taskId, payload) =>
    chatFetch(`/api/chat/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  authorizeTask: (taskId, payload) =>
    chatFetch(`/api/chat/tasks/${taskId}/authorize`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Notifications
  listNotifications: () => chatFetch('/api/chat/notifications'),
  markNotificationRead: (notificationId) =>
    chatFetch(`/api/chat/notifications/${notificationId}/read`, { method: 'POST' }),
  markAllNotificationsRead: () =>
    chatFetch('/api/chat/notifications/read-all', { method: 'POST' }),

  // Users & Trip Itineraries
  listPlatformUsers: () => chatFetch('/api/auth/users'),
  listTripItineraries: (tripId) => chatFetch(`/api/itineraries/trip/${tripId}`),
};
