from contextlib import contextmanager
from typing import Any, Generator

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from pymongo import MongoClient

from app.core.config import settings

pg_pool: ConnectionPool | None = None
mongo_client: MongoClient | None = None


def init_db() -> None:
    global pg_pool, mongo_client
    pg_pool = ConnectionPool(
        conninfo=settings.database_url,
        min_size=2,
        max_size=15,
        kwargs={"row_factory": dict_row},
        open=True,
    )
    mongo_client = MongoClient(settings.mongo_url, serverSelectionTimeoutMS=4000)


def close_db() -> None:
    global pg_pool, mongo_client
    if pg_pool is not None:
        pg_pool.close()
        pg_pool = None
    if mongo_client is not None:
        mongo_client.close()
        mongo_client = None


@contextmanager
def get_pg_conn() -> Generator[psycopg.Connection[Any], None, None]:
    if pg_pool is None:
        raise RuntimeError("PostgreSQL connection pool is not initialized")
    with pg_pool.connection(timeout=0.6) as conn:
        yield conn


def get_mongo_db():
    if mongo_client is None:
        raise RuntimeError("MongoDB client is not initialized")
    return mongo_client[settings.mongo_db]
