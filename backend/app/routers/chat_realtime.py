import asyncio
import json
import logging
from typing import Any, Optional

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.core.security import decode_access_token
from app.repositories import chat_repo
from app.services.realtime_manager import realtime_manager

logger = logging.getLogger("yatra.chat_realtime")

router = APIRouter(prefix="/api/chat", tags=["chat-realtime"])


async def _get_peer_user_ids(user_id: int) -> list[int]:
    convs = await asyncio.to_thread(chat_repo.list_user_conversations, user_id)
    peers: set[int] = set()
    for c in convs:
        mids = await asyncio.to_thread(chat_repo.get_member_user_ids, int(c["conversation_id"]))
        peers.update(int(uid) for uid in mids)
    peers.discard(int(user_id))
    return sorted(peers)


@router.websocket("/live")
async def chat_live_channel(socket: WebSocket, token: Optional[str] = Query(default=None)):
    raw_token = token
    if not raw_token:
        auth_header = socket.headers.get("authorization") or ""
        if auth_header.lower().startswith("bearer "):
            raw_token = auth_header.split(" ", 1)[1].strip()

    try:
        user: dict[str, Any] = decode_access_token(raw_token or "")
        user_id = int(user.get("user_id") or user.get("sub"))
        full_name = user.get("full_name") or user.get("name") or "Traveler"
    except Exception:
        await socket.close(code=4001, reason="Invalid or missing authentication token")
        return

    await realtime_manager.connect(user_id, socket)
    await asyncio.to_thread(chat_repo.update_user_last_seen, user_id)

    await realtime_manager.send_to_user(
        user_id,
        "connected",
        {
            "user_id": user_id,
            "online_user_ids": realtime_manager.get_online_user_ids(),
        },
    )

    peers = await _get_peer_user_ids(user_id)
    if peers:
        await realtime_manager.broadcast_to_users(
            peers,
            "presence_updated",
            {"user_id": user_id, "online": True, "online_user_ids": realtime_manager.get_online_user_ids()},
        )

    try:
        while True:
            raw_text = await socket.receive_text()
            try:
                frame = json.loads(raw_text)
            except Exception:
                continue

            evt = frame.get("event")
            if evt == "ping":
                await socket.send_text(json.dumps({"event": "pong", "data": {}}))
                continue

            if evt == "typing":
                conv_id = frame.get("conversation_id")
                if not conv_id:
                    continue
                conv_id = int(conv_id)
                member = await asyncio.to_thread(chat_repo.get_member, conv_id, user_id)
                if not member or not member.get("can_send", True):
                    continue
                mids = await asyncio.to_thread(chat_repo.get_member_user_ids, conv_id)
                recipients = [int(uid) for uid in mids if int(uid) != user_id]
                await realtime_manager.broadcast_to_users(
                    recipients,
                    "typing",
                    {
                        "conversation_id": conv_id,
                        "user_id": user_id,
                        "full_name": full_name,
                        "is_typing": bool(frame.get("is_typing", True)),
                    },
                )
                continue

            if evt == "read":
                conv_id = frame.get("conversation_id")
                up_to_id = frame.get("up_to_message_id")
                if not conv_id or not up_to_id:
                    continue
                conv_id = int(conv_id)
                up_to_id = int(up_to_id)
                member = await asyncio.to_thread(chat_repo.get_member, conv_id, user_id)
                if not member:
                    continue
                updated_ids = await asyncio.to_thread(chat_repo.mark_read_up_to, conv_id, user_id, up_to_id)
                mids = await asyncio.to_thread(chat_repo.get_member_user_ids, conv_id)
                await realtime_manager.broadcast_to_users(
                    mids,
                    "receipt_updated",
                    {
                        "conversation_id": conv_id,
                        "user_id": user_id,
                        "full_name": full_name,
                        "up_to_message_id": up_to_id,
                        "message_ids": updated_ids,
                    },
                )
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.debug("Realtime loop terminated for user=%s: %s", user_id, exc)
    finally:
        realtime_manager.disconnect(user_id, socket)
        try:
            await asyncio.to_thread(chat_repo.update_user_last_seen, user_id)
            peers = await _get_peer_user_ids(user_id)
            if peers:
                await realtime_manager.broadcast_to_users(
                    peers,
                    "presence_updated",
                    {"user_id": user_id, "online": False, "online_user_ids": realtime_manager.get_online_user_ids()},
                )
        except Exception:
            pass
