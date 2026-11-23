import logging
import time
from contextlib import asynccontextmanager

import psycopg
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.core.db import close_db, init_db
from app.core.exceptions import DomainError, domain_error_handler, psycopg_error_handler
from app.routers import audit, auth, chat, expenses, inventory, itineraries, radar, saga, trips, voting

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
logger = logging.getLogger("yatra.api")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    logger.info("Yatra backend initialized (PostgreSQL pool + MongoDB client).")
    yield
    close_db()
    logger.info("Yatra backend connections closed.")


app = FastAPI(
    title="Yatra — Smart Group Tourism Management System",
    description="Layered FastAPI + PostgreSQL 16 + MongoDB 7 engine with database-enforced invariants.",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - start) * 1000
    logger.info("%s %s -> %s (%.1fms)", request.method, request.url.path, response.status_code, elapsed_ms)
    return response


app.add_exception_handler(DomainError, domain_error_handler)
app.add_exception_handler(psycopg.Error, psycopg_error_handler)

app.include_router(auth.router)
app.include_router(chat.router)
app.include_router(trips.router)
app.include_router(inventory.router)
app.include_router(itineraries.router)
app.include_router(voting.router)
app.include_router(saga.router)
app.include_router(radar.router)
app.include_router(expenses.router)
app.include_router(audit.router)


from app.core.config import settings


@app.get("/api/health", tags=["Health"])
def health():
    return {
        "status": "ok",
        "service": "yatra-backend",
        "version": "2.0.0",
        "openai_configured": bool(settings.openai_api_key),
        "openai_model": settings.openai_model if settings.openai_api_key else None,
        "ai_engine": f"openai_{settings.openai_model}" if settings.openai_api_key else ("gemini" if settings.gemini_api_key else "local"),
    }
