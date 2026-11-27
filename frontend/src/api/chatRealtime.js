import { getChatAuthToken } from './chatApi';

/**
 * Reconnecting live event client for Yatra Chat, Presence, Typing, Receipts, and Notifications.
 */
export class ChatRealtimeClient {
  constructor({ onEvent, onStatusChange }) {
    this.onEvent = onEvent;
    this.onStatusChange = onStatusChange;
    this.socket = null;
    this.closedIntentionally = false;
    this.retryCount = 0;
    this.retryTimer = null;
    this.pingTimer = null;
  }

  connect() {
    this.closedIntentionally = false;
    const token = getChatAuthToken();
    if (!token) {
      this.onStatusChange?.('unauthenticated');
      return;
    }

    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.onStatusChange?.('connecting');
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/api/chat/live?token=${encodeURIComponent(token)}`;

    const socket = new WebSocket(url);
    this.socket = socket;

    socket.onopen = () => {
      this.retryCount = 0;
      this.onStatusChange?.('connected');
      this._startPing();
    };

    socket.onmessage = (evt) => {
      try {
        const parsed = JSON.parse(evt.data);
        if (parsed?.event && parsed.event !== 'pong') {
          this.onEvent?.(parsed.event, parsed.data || {});
        }
      } catch {
        // ignore non-JSON frame
      }
    };

    socket.onerror = () => {
      // onclose handles reconnect
    };

    socket.onclose = (evt) => {
      this._stopPing();
      this.socket = null;
      if (this.closedIntentionally) {
        this.onStatusChange?.('disconnected');
        return;
      }
      if (evt?.code === 4001) {
        this.onStatusChange?.('unauthenticated');
        return;
      }
      this.onStatusChange?.('reconnecting');
      const delay = Math.min(10000, 800 * Math.pow(1.6, this.retryCount));
      this.retryCount += 1;
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => this.connect(), delay);
    };
  }

  send(event, payload = {}) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ event, ...payload }));
      return true;
    }
    return false;
  }

  sendTyping(conversationId, isTyping = true) {
    return this.send('typing', { conversation_id: conversationId, is_typing: isTyping });
  }

  sendRead(conversationId, upToMessageId) {
    return this.send('read', { conversation_id: conversationId, up_to_message_id: upToMessageId });
  }

  _startPing() {
    this._stopPing();
    this.pingTimer = setInterval(() => {
      this.send('ping');
    }, 25000);
  }

  _stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  disconnect() {
    this.closedIntentionally = true;
    clearTimeout(this.retryTimer);
    this._stopPing();
    if (this.socket) {
      try {
        this.socket.close(1000, 'Client disconnect');
      } catch {
        // ignore
      }
      this.socket = null;
    }
  }
}
