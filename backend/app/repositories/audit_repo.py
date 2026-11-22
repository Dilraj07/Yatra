from typing import Any
from app.core.db import get_mongo_db, get_pg_conn


def list_audit_log(limit: int = 40) -> list[dict[str, Any]]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT audit_id, table_name, operation, row_pk, before_img, after_img, changed_at, "
                "tableoid::regclass::text AS partition_name "
                "FROM audit_log ORDER BY changed_at DESC, audit_id DESC LIMIT %s",
                (limit,),
            )
            return cur.fetchall()


def list_nosql_documents(limit: int = 20) -> dict[str, list[dict[str, Any]]]:
    mongo = get_mongo_db()

    def _serialize(cursor):
        docs = []
        for d in cursor:
            d["_id"] = str(d["_id"])
            docs.append(d)
        return docs

    return {
        "llm_conversations": _serialize(mongo["llm_conversations"].find().sort("created_at", -1).limit(limit)),
        "supplier_snapshots": _serialize(mongo["supplier_snapshots"].find().sort("captured_at", -1).limit(limit)),
        "itinerary_drafts": _serialize(mongo["itinerary_drafts"].find().sort("created_at", -1).limit(limit)),
    }


def get_system_status() -> dict[str, Any]:
    pg_ok = False
    mongo_ok = False
    counts: dict[str, Any] = {}
    try:
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT "
                    "(SELECT COUNT(*) FROM trip) AS trips, "
                    "(SELECT COUNT(*) FROM capacity_slot) AS capacity_slots, "
                    "(SELECT COUNT(*) FROM booking_saga) AS sagas, "
                    "(SELECT COUNT(*) FROM audit_log) AS audit_rows"
                )
                counts = cur.fetchone()
        pg_ok = True
    except Exception:
        pg_ok = False

    try:
        mongo = get_mongo_db()
        mongo.command("ping")
        counts["mongo_snapshots"] = mongo["supplier_snapshots"].count_documents({})
        counts["mongo_llm_logs"] = mongo["llm_conversations"].count_documents({})
        mongo_ok = True
    except Exception:
        mongo_ok = False

    return {"postgresql": pg_ok, "mongodb": mongo_ok, "metrics": counts}
