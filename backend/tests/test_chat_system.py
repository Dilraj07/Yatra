from concurrent.futures import ThreadPoolExecutor
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


def _login(client: TestClient, email: str, password: str = "yatra123") -> dict:
    res = client.post("/api/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, f"Login failed for {email}: {res.text}"
    data = res.json()
    return {"token": data["access_token"], "user": data["user"]}


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _cleanup_conversations(conv_ids: list[int], leg_ids: list[int] | None = None) -> None:
    if conv_ids or leg_ids:
        with psycopg.connect(settings.database_url) as conn:
            with conn.cursor() as cur:
                if leg_ids:
                    cur.execute("DELETE FROM itinerary_leg WHERE leg_id = ANY(%s)", (leg_ids,))
                if conv_ids:
                    cur.execute("DELETE FROM chat_conversation WHERE conversation_id = ANY(%s)", (conv_ids,))
                conn.commit()
    upload_root = Path(__file__).resolve().parents[1] / "uploads" / "chat"
    for cid in conv_ids:
        target = upload_root / str(cid)
        if target.exists():
            shutil.rmtree(target, ignore_errors=True)


def test_chat_persistence_receipts_search_pin_bookmark_forward():
    created_convs: list[int] = []
    try:
        with TestClient(app) as client:
            # Unauthenticated access rejected
            unauth = client.get("/api/chat/conversations")
            assert unauth.status_code == 401

            u1 = _login(client, "dilraj@yatra.local")
            u2 = _login(client, "arya@yatra.local")
            u3 = _login(client, "aarush@yatra.local")

            h1 = _auth_headers(u1["token"])
            h2 = _auth_headers(u2["token"])
            h3 = _auth_headers(u3["token"])

            # Create group with Dilraj (OWNER) + Arya (MEMBER)
            grp = client.post(
                "/api/chat/conversations",
                headers=h1,
                json={
                    "kind": "GROUP",
                    "title": "Pytest Ops Chat",
                    "description": "End-to-end persistence verification",
                    "member_ids": [u2["user"]["user_id"]],
                    "agent_mode": "OBSERVE",
                },
            )
            assert grp.status_code == 201, grp.text
            conv_id = grp.json()["conversation"]["conversation_id"]
            created_convs.append(conv_id)

            # Non-member Aarush cannot access
            denied = client.get(f"/api/chat/conversations/{conv_id}/messages", headers=h3)
            assert denied.status_code == 403

            # User 1 sends parent message mentioning User 2
            m1_res = client.post(
                f"/api/chat/conversations/{conv_id}/messages",
                headers=h1,
                json={"body": "Meet at Goa airport gate 2", "mentions": [u2["user"]["user_id"]]},
            )
            assert m1_res.status_code == 201, m1_res.text
            m1 = m1_res.json()["message"]
            m1_id = m1["message_id"]

            # Mention notification created for User 2
            notes_u2 = client.get("/api/chat/notifications", headers=h2).json()
            assert any(n["message_id"] == m1_id and n["kind"] == "MENTION" for n in notes_u2["notifications"])

            # User 1 edits own message
            edit_res = client.patch(
                f"/api/chat/messages/{m1_id}",
                headers=h1,
                json={"body": "Meet at Goa airport gate 4"},
            )
            assert edit_res.status_code == 200
            assert edit_res.json()["message"]["is_edited"] is True
            assert "gate 4" in edit_res.json()["message"]["body"]

            # User 2 replies to m1 & bookmarks it
            rep_res = client.post(
                f"/api/chat/conversations/{conv_id}/messages",
                headers=h2,
                json={"body": "Confirmed for gate 4", "reply_to_message_id": m1_id},
            )
            assert rep_res.status_code == 201
            assert rep_res.json()["message"]["reply_preview"]["message_id"] == m1_id

            # User 2 cannot edit Dilraj's message (403)
            forbidden_edit = client.patch(
                f"/api/chat/messages/{m1_id}",
                headers=h2,
                json={"body": "Tampered"},
            )
            assert forbidden_edit.status_code == 403

            # User 2 marks m1 read -> delivery/read receipt updates
            rr = client.post(
                f"/api/chat/conversations/{conv_id}/read",
                headers=h2,
                json={"up_to_message_id": m1_id},
            )
            assert rr.status_code == 200
            assert m1_id in rr.json()["updated_message_ids"]

            # Pin (Owner) + Bookmark (User 2) + Search across sessions
            pin_res = client.post(f"/api/chat/messages/{m1_id}/pin", headers=h1, json={"pin": True})
            assert pin_res.status_code == 200
            assert pin_res.json()["is_pinned"] is True

            bm_res = client.post(f"/api/chat/messages/{m1_id}/bookmark", headers=h2)
            assert bm_res.status_code == 200
            assert bm_res.json()["is_bookmarked"] is True

            # Simulate new session client fetching persisted history + filters
            with TestClient(app) as fresh_client:
                hist = fresh_client.get(
                    f"/api/chat/conversations/{conv_id}/messages",
                    headers=h1,
                    params={"search": "gate 4"},
                )
                assert hist.status_code == 200
                msgs = hist.json()["messages"]
                assert any(m["message_id"] == m1_id and m["delivery_stats"]["read_count"] >= 1 for m in msgs)
                assert any(m["message_id"] == m1_id and m["thread_reply_count"] >= 1 for m in msgs)

                # Forward to Direct Chat between User 1 & User 2
                dm_res = fresh_client.post(
                    "/api/chat/conversations",
                    headers=h1,
                    json={"kind": "DIRECT", "target_user_id": u2["user"]["user_id"]},
                )
                assert dm_res.status_code == 201
                dm_id = dm_res.json()["conversation"]["conversation_id"]
                if dm_id not in created_convs:
                    created_convs.append(dm_id)

                fwd = fresh_client.post(
                    f"/api/chat/conversations/{dm_id}/messages",
                    headers=h1,
                    json={"body": "Meet at Goa airport gate 4", "forwarded_from_message_id": m1_id},
                )
                assert fwd.status_code == 201
                assert fwd.json()["message"]["forwarded_from_message_id"] == m1_id
    finally:
        _cleanup_conversations(created_convs)


def test_group_rbac_invitations_and_invite_code_join():
    created_convs: list[int] = []
    try:
        with TestClient(app) as client:
            u1 = _login(client, "dilraj@yatra.local")
            u2 = _login(client, "arya@yatra.local")
            u3 = _login(client, "aarush@yatra.local")
            h1 = _auth_headers(u1["token"])
            h2 = _auth_headers(u2["token"])
            h3 = _auth_headers(u3["token"])

            grp = client.post(
                "/api/chat/conversations",
                headers=h1,
                json={"kind": "GROUP", "title": "RBAC Invite Group", "member_ids": [u2["user"]["user_id"]]},
            )
            assert grp.status_code == 201
            conv_id = grp.json()["conversation"]["conversation_id"]
            created_convs.append(conv_id)

            # Plain MEMBER (u2) cannot edit group info, invite, or configure AI agent
            assert client.patch(f"/api/chat/conversations/{conv_id}", headers=h2, json={"title": "Hacked"}).status_code == 403
            assert client.patch(f"/api/chat/conversations/{conv_id}/agent", headers=h2, json={"agent_enabled": False, "agent_mode": "OFF"}).status_code == 403
            assert client.post(f"/api/chat/conversations/{conv_id}/invitations", headers=h2, json={"role": "MEMBER"}).status_code == 403

            # Owner creates targeted invite for Aarush (u3)
            inv_res = client.post(
                f"/api/chat/conversations/{conv_id}/invitations",
                headers=h1,
                json={"invited_user_id": u3["user"]["user_id"], "role": "MODERATOR"},
            )
            assert inv_res.status_code == 201
            inv = inv_res.json()["invitation"]

            # Aarush sees invitation and accepts it via invite code
            my_invs = client.get("/api/chat/invitations", headers=h3).json()["invitations"]
            assert any(i["invitation_id"] == inv["invitation_id"] for i in my_invs)

            join_res = client.post(f"/api/chat/invitations/code/{inv['invite_code']}/join", headers=h3)
            assert join_res.status_code == 200
            assert join_res.json()["status"] == "ACCEPTED"

            # Owner mutes u2 (can_send=False) -> u2 gets 403 trying to post
            mute_res = client.patch(
                f"/api/chat/conversations/{conv_id}/members/{u2['user']['user_id']}",
                headers=h1,
                json={"can_send": False},
            )
            assert mute_res.status_code == 200
            assert client.post(f"/api/chat/conversations/{conv_id}/messages", headers=h2, json={"body": "Blocked"}).status_code == 403

            # Owner cannot be removed
            assert client.delete(
                f"/api/chat/conversations/{conv_id}/members/{u1['user']['user_id']}",
                headers=h3,
            ).status_code == 403

            # Membership history contains GROUP_CREATED, INVITE_CREATED, INVITE_ACCEPTED, ROLE_CHANGED
            hist = client.get(f"/api/chat/conversations/{conv_id}/history", headers=h1).json()["events"]
            ev_types = {e["event_type"] for e in hist}
            assert {"GROUP_CREATED", "INVITE_CREATED", "INVITE_ACCEPTED", "ROLE_CHANGED"}.issubset(ev_types)
    finally:
        _cleanup_conversations(created_convs)


def test_ai_agent_modes_task_proposal_authorization_and_itinerary_sync():
    created_convs: list[int] = []
    created_legs: list[int] = []
    try:
        with TestClient(app) as client:
            u1 = _login(client, "dilraj@yatra.local")
            u2 = _login(client, "arya@yatra.local")
            u3 = _login(client, "aarush@yatra.local")
            h1 = _auth_headers(u1["token"])
            h2 = _auth_headers(u2["token"])
            h3 = _auth_headers(u3["token"])

            grp = client.post(
                "/api/chat/conversations",
                headers=h1,
                json={
                    "kind": "GROUP",
                    "title": "Copilot Task Trip 1",
                    "trip_id": 1,
                    "member_ids": [u2["user"]["user_id"], u3["user"]["user_id"]],
                    "agent_enabled": True,
                    "agent_mode": "ACTIVE",
                },
            )
            assert grp.status_code == 201
            conv_id = grp.json()["conversation"]["conversation_id"]
            created_convs.append(conv_id)

            # Natural language task assignment triggers PROPOSED task linked to message
            msg_res = client.post(
                f"/api/chat/conversations/{conv_id}/messages",
                headers=h1,
                json={"body": "Assign airport shuttle booking to Arya before Friday"},
            )
            assert msg_res.status_code == 201, msg_res.text
            data = msg_res.json()
            assert data["proposed_task"] is not None
            task = data["proposed_task"]
            assert task["status"] == "PROPOSED"
            assert task["assigned_to_user_id"] == u2["user"]["user_id"]
            assert task["source_message_id"] == data["message"]["message_id"]
            assert task["due_at"] is not None
            assert data["agent_message"] is not None

            # Unrelated MEMBER (Aarush) cannot authorize Arya's task (403)
            unauth_authz = client.post(
                f"/api/chat/tasks/{task['task_id']}/authorize",
                headers=h3,
                json={"action": "CONFIRM", "schedule_into_itinerary": False},
            )
            assert unauth_authz.status_code == 403

            # Owner confirms & schedules into Trip 1 itinerary (far future non-overlapping window)
            s_start = datetime(2027, 4, 10, 9, 0, tzinfo=timezone.utc)
            s_end = s_start + timedelta(hours=2)
            ok_authz = client.post(
                f"/api/chat/tasks/{task['task_id']}/authorize",
                headers=h1,
                json={
                    "action": "CONFIRM",
                    "schedule_into_itinerary": True,
                    "schedule_start": s_start.isoformat(),
                    "schedule_end": s_end.isoformat(),
                    "leg_kind": "TRANSFER",
                    "est_cost_inr": 1500,
                },
            )
            assert ok_authz.status_code == 200, ok_authz.text
            res_body = ok_authz.json()
            assert res_body["task"]["status"] == "TODO"
            assert res_body["task"]["linked_leg_id"] is not None
            leg_id = res_body["created_leg"]["leg_id"]
            created_legs.append(leg_id)

            # Verify GiST Exclusion (23P01 -> 409) rejects overlapping task schedule for Arya
            msg_overlap = client.post(
                f"/api/chat/conversations/{conv_id}/messages",
                headers=h1,
                json={"body": "Arya, please take care of overlapping museum tour tomorrow"},
            )
            assert msg_overlap.status_code == 201
            overlap_task = msg_overlap.json()["proposed_task"]
            assert overlap_task is not None
            conflict = client.post(
                f"/api/chat/tasks/{overlap_task['task_id']}/authorize",
                headers=h1,
                json={
                    "action": "CONFIRM",
                    "schedule_into_itinerary": True,
                    "schedule_start": (s_start + timedelta(minutes=30)).isoformat(),
                    "schedule_end": (s_end + timedelta(minutes=30)).isoformat(),
                    "leg_kind": "ACTIVITY",
                },
            )
            assert conflict.status_code == 409

            # Test OBSERVE mode: silent unless @copilot is mentioned
            assert (
                client.patch(
                    f"/api/chat/conversations/{conv_id}/agent",
                    headers=h1,
                    json={"agent_enabled": True, "agent_mode": "OBSERVE"},
                ).status_code
                == 200
            )
            silent_res = client.post(
                f"/api/chat/conversations/{conv_id}/messages",
                headers=h2,
                json={"body": "Should we pack umbrellas for the beach?"},
            ).json()
            assert silent_res["agent_message"] is None

            invoked_res = client.post(
                f"/api/chat/conversations/{conv_id}/messages",
                headers=h2,
                json={"body": "@copilot what tasks are pending right now?"},
            ).json()
            assert invoked_res["agent_message"] is not None

            # Test OFF mode: neither tasks nor agent replies produced
            assert (
                client.patch(
                    f"/api/chat/conversations/{conv_id}/agent",
                    headers=h1,
                    json={"agent_enabled": False, "agent_mode": "OFF"},
                ).status_code
                == 200
            )
            off_res = client.post(
                f"/api/chat/conversations/{conv_id}/messages",
                headers=h1,
                json={"body": "@copilot Assign taxi booking to Arya tomorrow"},
            ).json()
            assert off_res["agent_message"] is None
            assert off_res["proposed_task"] is None

            # Audit log captures agent activity
            audits = client.get(f"/api/chat/conversations/{conv_id}/agent/audit", headers=h1).json()["audit"]
            assert len(audits) >= 3
    finally:
        _cleanup_conversations(created_convs, created_legs)


def test_realtime_live_messaging_and_attachments():
    created_convs: list[int] = []
    try:
        with TestClient(app) as client:
            u1 = _login(client, "dilraj@yatra.local")
            u2 = _login(client, "arya@yatra.local")
            u4 = _login(client, "operator@asi.gov.in")
            h1 = _auth_headers(u1["token"])
            h2 = _auth_headers(u2["token"])
            h4 = _auth_headers(u4["token"])

            grp = client.post(
                "/api/chat/conversations",
                headers=h1,
                json={
                    "kind": "GROUP",
                    "title": "Live & Upload Group",
                    "member_ids": [u2["user"]["user_id"]],
                    "agent_enabled": False,
                    "agent_mode": "OFF",
                },
            )
            assert grp.status_code == 201
            conv_id = grp.json()["conversation"]["conversation_id"]
            created_convs.append(conv_id)

            # Upload attachment & verify authorized vs unauthorized access
            up_res = client.post(
                f"/api/chat/conversations/{conv_id}/attachments",
                headers=h1,
                files={"file": ("itinerary_notes.txt", b"Flight ticket confirmation XYZ", "text/plain")},
            )
            assert up_res.status_code == 201, up_res.text
            att = up_res.json()["attachment"]
            assert client.get(att["url"], headers=h2).status_code == 200
            assert client.get(att["url"], headers=h4).status_code == 403

            # Connect two live realtime clients for User 1 & User 2
            with client.websocket_connect(f"/api/chat/live?token={u1['token']}") as sock1:
                init1 = sock1.receive_json()
                assert init1["event"] == "connected"
                with client.websocket_connect(f"/api/chat/live?token={u2['token']}") as sock2:
                    init2 = sock2.receive_json()
                    assert init2["event"] == "connected"
                    assert u1["user"]["user_id"] in init2["data"]["online_user_ids"]
                    assert u2["user"]["user_id"] in init2["data"]["online_user_ids"]

                    # Typing indicator broadcast from u1 -> u2
                    sock1.send_json({"event": "typing", "conversation_id": conv_id, "is_typing": True})
                    evt = sock2.receive_json()
                    while evt["event"] == "presence_updated":
                        evt = sock2.receive_json()
                    assert evt["event"] == "typing"
                    assert evt["data"]["user_id"] == u1["user"]["user_id"]

                    # HTTP send message broadcasts live to sock2
                    posted = client.post(
                        f"/api/chat/conversations/{conv_id}/messages",
                        headers=h1,
                        json={"body": "Real-time check", "attachments": [att]},
                    )
                    assert posted.status_code == 201
                    msg_id = posted.json()["message"]["message_id"]

                    sock2_msg = sock2.receive_json()
                    while sock2_msg["event"] != "message_new":
                        sock2_msg = sock2.receive_json()
                    assert sock2_msg["data"]["message"]["message_id"] == msg_id

                    # sock2 sends read receipt -> sock1 receives receipt_updated
                    sock2.send_json({"event": "read", "conversation_id": conv_id, "up_to_message_id": msg_id})
                    sock1_ack = sock1.receive_json()
                    while sock1_ack["event"] != "receipt_updated":
                        sock1_ack = sock1.receive_json()
                    assert msg_id in sock1_ack["data"]["message_ids"]
    finally:
        _cleanup_conversations(created_convs)


def test_concurrent_messaging_atomic_invite_and_task_claim():
    created_convs: list[int] = []
    created_legs: list[int] = []
    try:
        with TestClient(app) as client:
            u1 = _login(client, "dilraj@yatra.local")
            u2 = _login(client, "arya@yatra.local")
            u3 = _login(client, "aarush@yatra.local")
            h1 = _auth_headers(u1["token"])
            h2 = _auth_headers(u2["token"])
            h3 = _auth_headers(u3["token"])

            # Create group with Dilraj (OWNER) + Arya (ADMIN so both can authorize)
            grp = client.post(
                "/api/chat/conversations",
                headers=h1,
                json={
                    "kind": "GROUP",
                    "title": "Concurrency Stress Group",
                    "trip_id": 1,
                    "member_ids": [u2["user"]["user_id"]],
                    "agent_enabled": False,
                    "agent_mode": "OFF",
                },
            )
            assert grp.status_code == 201
            conv_id = grp.json()["conversation"]["conversation_id"]
            created_convs.append(conv_id)

            client.patch(
                f"/api/chat/conversations/{conv_id}/members/{u2['user']['user_id']}",
                headers=h1,
                json={"role": "ADMIN"},
            )

            # 1) Concurrent burst of 10 messages from 2 users
            def post_msg(idx: int):
                headers = h1 if idx % 2 == 0 else h2
                return client.post(
                    f"/api/chat/conversations/{conv_id}/messages",
                    headers=headers,
                    json={"body": f"Concurrent message #{idx}"},
                )

            with ThreadPoolExecutor(max_workers=6) as pool:
                responses = list(pool.map(post_msg, range(10)))

            assert all(r.status_code == 201 for r in responses), [r.text for r in responses if r.status_code != 201]
            msg_ids = [r.json()["message"]["message_id"] for r in responses]
            assert len(set(msg_ids)) == 10

            hist = client.get(f"/api/chat/conversations/{conv_id}/messages", headers=h1).json()["messages"]
            stored_ids = [m["message_id"] for m in hist if m["body"].startswith("Concurrent message #")]
            assert len(stored_ids) == 10
            assert stored_ids == sorted(stored_ids)

            # 2) Concurrent race on a single-use open invite code (max_uses=1)
            inv_res = client.post(
                f"/api/chat/conversations/{conv_id}/invitations",
                headers=h1,
                json={"role": "MEMBER", "max_uses": 1},
            )
            assert inv_res.status_code == 201
            code = inv_res.json()["invitation"]["invite_code"]
            u4 = _login(client, "operator@asi.gov.in")
            h4 = _auth_headers(u4["token"])

            def race_join(headers):
                return client.post(f"/api/chat/invitations/code/{code}/join", headers=headers)

            with ThreadPoolExecutor(max_workers=2) as pool:
                join_results = list(pool.map(race_join, [h3, h4]))

            codes = sorted(r.status_code for r in join_results)
            assert codes == [200, 400], f"Expected strict single-use winner, got {codes}"

            # 3) Concurrent race confirming the same PROPOSED task -> strict atomic claim
            client.patch(
                f"/api/chat/conversations/{conv_id}/agent",
                headers=h1,
                json={"agent_enabled": True, "agent_mode": "ACTIVE"},
            )
            p_msg = client.post(
                f"/api/chat/conversations/{conv_id}/messages",
                headers=h1,
                json={"body": "Assign bus pickup to Arya tomorrow"},
            )
            assert p_msg.status_code == 201
            task_id = p_msg.json()["proposed_task"]["task_id"]

            s_start = datetime(2027, 5, 1, 9, 0, tzinfo=timezone.utc)
            s_end = s_start + timedelta(hours=2)

            def race_confirm(headers):
                return client.post(
                    f"/api/chat/tasks/{task_id}/authorize",
                    headers=headers,
                    json={
                        "action": "CONFIRM",
                        "schedule_into_itinerary": True,
                        "schedule_start": s_start.isoformat(),
                        "schedule_end": s_end.isoformat(),
                        "leg_kind": "TRANSFER",
                    },
                )

            with ThreadPoolExecutor(max_workers=2) as pool:
                auth_results = list(pool.map(race_confirm, [h1, h2]))

            auth_codes = sorted(r.status_code for r in auth_results)
            assert auth_codes == [200, 409], f"Expected atomic task claim, got {auth_codes}"
            winner = next(r.json() for r in auth_results if r.status_code == 200)
            if winner.get("created_leg"):
                created_legs.append(winner["created_leg"]["leg_id"])
    finally:
        _cleanup_conversations(created_convs, created_legs)
