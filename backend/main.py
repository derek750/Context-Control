from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, Request, WebSocket

import conversation_state
import forwarder
import gating
import interceptor
import ws_manager
from models import (
    Approve,
    ApproveModified,
    Cancel,
    CommitEditsNow,
    InboundMessage,
    ModeChange,
    PauseToggle,
    ResetCanonical,
    Snapshot,
)

load_dotenv()

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("autonomy")

ANTHROPIC_UPSTREAM_URL = os.getenv("ANTHROPIC_UPSTREAM_URL", "https://api.anthropic.com")


def _build_snapshot() -> Snapshot:
    """Authoritative state replay sent to every WS client on connect. Without
    this, opening the panel after a request was already held leaves the proxy
    waiting forever — the user never sees the Send button."""
    held_list = interceptor.held_requests()
    latest = interceptor.latest_request()
    gating_state = gating.state()
    return Snapshot(
        mode=gating_state["mode"],
        paused=gating_state["paused"],
        pendingRequest=held_list[0] if held_list else None,
        pendingRequests=held_list,
        latestRequest=latest,
        recentRequests=interceptor.recent_history(),
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    forwarder.configure(ANTHROPIC_UPSTREAM_URL)
    ws_manager.register_snapshot_builder(_build_snapshot)
    await forwarder.startup()
    logger.info("autonomy proxy ready (upstream=%s)", ANTHROPIC_UPSTREAM_URL)
    try:
        yield
    finally:
        await forwarder.shutdown()


app = FastAPI(lifespan=lifespan)


async def _dispatch(msg: InboundMessage) -> None:
    if isinstance(msg, Approve):
        gating.resolve(msg.requestId, "approve")
    elif isinstance(msg, ApproveModified):
        gating.resolve(msg.requestId, "approve_modified", msg.removedIndices, msg.editedSections)
    elif isinstance(msg, Cancel):
        gating.resolve(msg.requestId, "cancel")
    elif isinstance(msg, ModeChange):
        gating.set_mode(msg.mode)
    elif isinstance(msg, PauseToggle):
        gating.set_pause(msg.paused)
    elif isinstance(msg, ResetCanonical):
        await conversation_state.reset_edits()
        await interceptor.broadcast_canonical_snapshot()
    elif isinstance(msg, CommitEditsNow):
        await conversation_state.commit_edits(msg.removedIndices, msg.editedSections)
        await interceptor.broadcast_canonical_snapshot()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await ws_manager.connect(websocket)
    await ws_manager.receive_loop(websocket, _dispatch)


@app.post("/v1/messages")
async def messages_endpoint(request: Request):
    return await interceptor.handle(request)


@app.api_route(
    "/{full_path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
)
async def catchall(request: Request, full_path: str):
    return await forwarder.passthrough(request, full_path)
