import asyncio
import json
import logging
import threading
from typing import Any
from fastapi import WebSocket

logger = logging.getLogger("yatra.realtime")


class ChatRealtimeManager:
    """Thread-safe tracker of multi-device live connections per user and event broadcaster."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._user_sockets: dict[int, set[WebSocket]] = {}
        self._loop: asyncio.AbstractEventLoop | None = None

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    async def connect(self, user_id: int, socket: WebSocket) -> None:
        await socket.accept()
        self._loop = asyncio.get_running_loop()
        uid = int(user_id)
        with self._lock:
            sockets = self._user_sockets.setdefault(uid, set())
            sockets.add(socket)
            total = len(sockets)
        logger.debug("Realtime client connected user=%s total_sockets=%s", uid, total)

    def disconnect(self, user_id: int, socket: WebSocket) -> None:
        uid = int(user_id)
        with self._lock:
            sockets = self._user_sockets.get(uid)
            if not sockets:
                return
            sockets.discard(socket)
            if not sockets:
                self._user_sockets.pop(uid, None)

    def get_online_user_ids(self) -> list[int]:
        with self._lock:
            return sorted(uid for uid, socks in self._user_sockets.items() if socks)

    def is_user_online(self, user_id: int) -> bool:
        with self._lock:
            return bool(self._user_sockets.get(int(user_id)))

    async def send_to_user(self, user_id: int, event_type: str, payload: dict[str, Any]) -> None:
        uid = int(user_id)
        with self._lock:
            sockets = list(self._user_sockets.get(uid, ()))
        if not sockets:
            return
        msg = json.dumps({"event": event_type, "data": payload}, default=str)
        dead: list[WebSocket] = []
        for sock in sockets:
            try:
                await sock.send_text(msg)
            except Exception:
                dead.append(sock)
        for sock in dead:
            self.disconnect(uid, sock)

    async def broadcast_to_users(self, user_ids: list[int], event_type: str, payload: dict[str, Any]) -> None:
        unique_ids = set(int(u) for u in user_ids if u)
        for uid in unique_ids:
            await self.send_to_user(uid, event_type, payload)

    def broadcast_to_users_sync(self, user_ids: list[int], event_type: str, payload: dict[str, Any]) -> None:
        """Safe bridge for synchronous endpoints to push live event updates."""
        if not self._loop or self._loop.is_closed():
            return
        try:
            running = asyncio.get_running_loop()
            if running is self._loop:
                asyncio.create_task(self.broadcast_to_users(user_ids, event_type, payload))
                return
        except RuntimeError:
            pass
        try:
            asyncio.run_coroutine_threadsafe(
                self.broadcast_to_users(user_ids, event_type, payload),
                self._loop,
            )
        except Exception as exc:
            logger.debug("Realtime sync broadcast skipped: %s", exc)


realtime_manager = ChatRealtimeManager()
