from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, AsyncIterator, Optional, Union

import httpx
from fastapi import Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

import conversation_state
import gating

logger = logging.getLogger(__name__)

_client: Optional[httpx.AsyncClient] = None
_upstream: str = "https://api.anthropic.com"

_HOP_BY_HOP = {"host", "content-length", "connection", "keep-alive", "transfer-encoding"}

# Strong references to the fire-and-forget post-stream broadcast tasks. Without
# this, asyncio.create_task() returns a task that the event loop only weakly
# references — once `body_iter`'s finally returns and the local task variable
# falls out of scope, the task can be garbage-collected before it ever runs.
# That's the failure mode where the UI never sees the assistant turn until the
# user prompts again (because the next sync() is what re-discovers it). See
# https://docs.python.org/3/library/asyncio-task.html#asyncio.create_task.
_pending_broadcast_tasks: set[asyncio.Task[None]] = set()

AssistantContent = Union[str, list[dict[str, Any]]]


def configure(upstream_url: str) -> None:
    global _upstream
    _upstream = upstream_url.rstrip("/")


async def startup() -> None:
    global _client
    _client = httpx.AsyncClient(timeout=None)


async def shutdown() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def _filter_request_headers(headers: dict[str, str]) -> dict[str, str]:
    return {k: v for k, v in headers.items() if k.lower() not in _HOP_BY_HOP}


def _filter_response_headers(headers: httpx.Headers) -> dict[str, str]:
    return {k: v for k, v in headers.items() if k.lower() not in _HOP_BY_HOP}


def _client_or_raise() -> httpx.AsyncClient:
    if _client is None:
        raise RuntimeError("forwarder not initialized")
    return _client


class _AssistantStreamCapture:
    """Reconstruct Anthropic Messages API assistant `content` from SSE events."""

    def __init__(self) -> None:
        self._blocks: dict[int, dict[str, Any]] = {}

    def _ensure_block_for_delta(self, idx: int, dt: Optional[str]) -> dict[str, Any]:
        """Create a block when deltas arrive before content_block_start (chunking
        edge cases)."""
        existing = self._blocks.get(idx)
        if existing is not None:
            return existing
        if dt == "text_delta":
            self._blocks[idx] = {"type": "text", "text": ""}
        elif dt in ("thinking_delta", "signature_delta"):
            self._blocks[idx] = {"type": "thinking", "thinking": ""}
        elif dt == "input_json_delta":
            self._blocks[idx] = {
                "type": "tool_use",
                "id": "",
                "name": "",
                "input_json": "",
                "input_preset": None,
            }
        else:
            self._blocks[idx] = {"type": "unsupported", "start": {}}
        return self._blocks[idx]

    def consume_sse_line(self, line: str) -> None:
        line = line.strip()
        if not line.startswith("data:"):
            return
        payload = line.removeprefix("data:").strip()
        if not payload or payload == "[DONE]":
            return
        try:
            event = json.loads(payload)
        except json.JSONDecodeError:
            return

        et = event.get("type")
        if et == "content_block_start":
            try:
                idx = int(event["index"])
            except (KeyError, TypeError, ValueError):
                return
            cb = event.get("content_block")
            if not isinstance(cb, dict):
                cb = {}
            btype = cb.get("type")
            if btype == "text":
                self._blocks[idx] = {"type": "text", "text": ""}
            elif btype == "thinking":
                self._blocks[idx] = {"type": "thinking", "thinking": ""}
            elif btype == "redacted_thinking":
                data = cb.get("data")
                self._blocks[idx] = {
                    "type": "thinking",
                    "thinking": data if isinstance(data, str) else "",
                }
            elif btype == "tool_use":
                raw_input = cb.get("input")
                self._blocks[idx] = {
                    "type": "tool_use",
                    "id": cb.get("id") or "",
                    "name": cb.get("name") or "",
                    "input_json": "",
                    "input_preset": raw_input if isinstance(raw_input, dict) else None,
                }
            else:
                self._blocks[idx] = {"type": "unsupported", "start": cb}

        elif et == "content_block_delta":
            try:
                idx = int(event["index"])
            except (KeyError, TypeError, ValueError):
                return
            delta = event.get("delta")
            if not isinstance(delta, dict):
                return
            dt = delta.get("type")
            if isinstance(dt, str) and dt == "signature_delta":
                # Integrity signature for extended thinking; not message content.
                self._ensure_block_for_delta(idx, dt)
                return
            block = self._ensure_block_for_delta(
                idx, dt if isinstance(dt, str) else None
            )
            if dt == "text_delta":
                block["text"] = block.get("text", "") + (delta.get("text") or "")
            elif dt == "thinking_delta":
                block["thinking"] = block.get("thinking", "") + (
                    delta.get("thinking") or ""
                )
            elif dt == "input_json_delta":
                block["input_json"] = block.get("input_json", "") + (
                    delta.get("partial_json") or ""
                )

        elif et == "content_block_stop":
            try:
                idx = int(event["index"])
            except (KeyError, TypeError, ValueError):
                return
            block = self._blocks.get(idx)
            if not block or block.get("type") != "tool_use":
                return
            raw = block.get("input_json") or ""
            preset = block.get("input_preset")
            if raw.strip():
                try:
                    block["input"] = json.loads(raw)
                except json.JSONDecodeError:
                    block["input"] = {}
            elif isinstance(preset, dict):
                block["input"] = preset
            else:
                block["input"] = {}
            block.pop("input_json", None)
            block.pop("input_preset", None)

    def build_assistant_content(self) -> Optional[AssistantContent]:
        if not self._blocks:
            return None
        out: list[dict[str, Any]] = []
        for idx in sorted(self._blocks.keys()):
            block = self._blocks[idx]
            if block.get("type") == "tool_use" and "input" not in block:
                raw = block.get("input_json") or ""
                preset = block.get("input_preset")
                if raw.strip():
                    try:
                        block["input"] = json.loads(raw)
                    except json.JSONDecodeError:
                        block["input"] = {}
                elif isinstance(preset, dict):
                    block["input"] = preset
                else:
                    block["input"] = {}
                block.pop("input_json", None)
                block.pop("input_preset", None)
            bt = block.get("type")
            if bt == "text":
                text = block.get("text") or ""
                if text:
                    out.append({"type": "text", "text": text})
            elif bt == "thinking":
                thinking = block.get("thinking") or ""
                if thinking:
                    out.append({"type": "thinking", "thinking": thinking})
            elif bt == "tool_use":
                out.append(
                    {
                        "type": "tool_use",
                        "id": block.get("id") or "",
                        "name": block.get("name") or "",
                        "input": block.get("input", {}),
                    }
                )
        if not out:
            return None
        if len(out) == 1 and out[0].get("type") == "text":
            return out[0].get("text") or ""
        return out


def _assistant_content_nonempty(content: AssistantContent) -> bool:
    if isinstance(content, str):
        return bool(content.strip())
    return len(content) > 0


def _log_canonical_task(task: asyncio.Task) -> None:
    """Surface failures from fire-and-forget canonical updates."""
    try:
        exc = task.exception()
    except asyncio.CancelledError:
        return
    if exc is not None:
        logger.error("forwarder: add_response task failed", exc_info=exc)


async def forward_messages(body: dict[str, Any], headers: dict[str, str]) -> Response:
    url = f"{_upstream}/v1/messages"
    # Defensive net: even on paths that didn't go through apply_edits (aux
    # calls, canonical/incoming drift across sessions) we must not ship a
    # tool_result whose tool_use_id has no match in the prior assistant turn —
    # Anthropic rejects the request with HTTP 400 and the conversation aborts.
    body = gating.prune_orphan_tool_pairs(body)
    payload = json.dumps(body).encode("utf-8")
    fwd_headers = _filter_request_headers(headers)
    # Force an uncompressed response from Anthropic so the SSE parser below
    # actually sees text. Claude Code (and most HTTP libraries) send
    # `accept-encoding: gzip, br` by default — without this override, httpx's
    # `aiter_raw()` yields gzip/brotli bytes, our SSE capture extracts nothing,
    # and the post-stream broadcast that updates the chart with the assistant
    # turn never fires.
    fwd_headers["accept-encoding"] = "identity"
    fwd_headers["content-type"] = "application/json"

    client = _client_or_raise()
    try:
        req = client.build_request("POST", url, content=payload, headers=fwd_headers)
        upstream = await client.send(req, stream=True)
    except (httpx.ConnectError, httpx.TransportError) as exc:
        logger.warning("forwarder: upstream connection error: %s", exc)
        return JSONResponse(
            status_code=502,
            content={"error": {"type": "proxy_upstream_error", "message": str(exc)}},
        )

    async def body_iter() -> AsyncIterator[bytes]:
        gating.stream_in_flight += 1
        decremented = False
        capture = _AssistantStreamCapture()
        line_carry = ""

        def _release() -> None:
            nonlocal decremented
            if not decremented:
                gating.stream_in_flight = max(0, gating.stream_in_flight - 1)
                decremented = True

        try:
            async for chunk in upstream.aiter_raw():
                try:
                    chunk_str = line_carry + chunk.decode("utf-8", errors="ignore")
                    parts = chunk_str.split("\n")
                    line_carry = parts.pop()
                    for line in parts:
                        capture.consume_sse_line(line)
                except UnicodeDecodeError:
                    pass

                yield chunk
        except (httpx.ReadError, httpx.RemoteProtocolError) as exc:
            logger.warning("forwarder: upstream stream broke: %s", exc)
        finally:
            _release()
            if line_carry.strip():
                capture.consume_sse_line(line_carry)
            try:
                await upstream.aclose()
            except Exception:
                pass

            merged = capture.build_assistant_content()
            if merged is None or not _assistant_content_nonempty(merged):
                logger.info(
                    "forwarder: stream finished with no assistant content "
                    "to broadcast (status=%d)",
                    upstream.status_code,
                )
            else:
                try:
                    t = asyncio.create_task(
                        _add_response_to_canonical_and_broadcast(merged),
                    )
                    # Hold a strong ref so the GC doesn't reap the task before
                    # it runs (asyncio only keeps weak refs to tasks).
                    _pending_broadcast_tasks.add(t)
                    t.add_done_callback(_pending_broadcast_tasks.discard)
                    t.add_done_callback(_log_canonical_task)
                except Exception as exc:
                    logger.warning(
                        "forwarder: failed to add response to canonical: %s",
                        exc,
                    )

    return StreamingResponse(
        body_iter(),
        status_code=upstream.status_code,
        headers=_filter_response_headers(upstream.headers),
        media_type=upstream.headers.get("content-type"),
    )


async def _add_response_to_canonical_and_broadcast(content: AssistantContent) -> None:
    """Add the assistant response to the canonical conversation and broadcast
    the updated chart to the UI."""
    try:
        canonical = await conversation_state.get_canonical()
        if not canonical or "messages" not in canonical:
            logger.warning("forwarder: canonical empty or invalid, skipping response")
            return

        messages = canonical.get("messages", [])
        if not isinstance(messages, list):
            return

        assistant_msg: dict[str, Any] = {"role": "assistant", "content": content}
        messages.append(assistant_msg)

        await conversation_state.update_canonical(canonical)
        await conversation_state.ack_streamed_messages_appended(1)

        from interceptor import broadcast_canonical_snapshot

        await broadcast_canonical_snapshot(kind="tool_chain")

        if isinstance(content, str):
            log_detail = f"text_len={len(content)}"
        else:
            log_detail = f"blocks={len(content)}"
        logger.info(
            "forwarder: added assistant response to canonical and broadcast (%s)",
            log_detail,
        )
    except Exception as exc:
        logger.exception("forwarder: failed to add response to canonical: %s", exc)


async def passthrough(request: Request, full_path: str) -> Response:
    # Forensic trail for "what reached Anthropic that the user couldn't see":
    # the catch-all covers /v1/files, /v1/messages/batches, model-listing,
    # token-counting, and anything else Claude Code (or another client) calls
    # outside /v1/messages. We don't gate these — schemas vary too much — but
    # we surface them in the proxy log so the user has a record. WARNING level
    # so they stand out in the Context Control output channel.
    logger.warning(
        "forwarder: passthrough %s /%s — forwarded transparently, not gated",
        request.method,
        full_path,
    )
    url = f"{_upstream}/{full_path}"
    if request.url.query:
        url = f"{url}?{request.url.query}"
    body = await request.body()
    fwd_headers = _filter_request_headers(dict(request.headers))

    client = _client_or_raise()
    try:
        req = client.build_request(request.method, url, content=body, headers=fwd_headers)
        upstream = await client.send(req, stream=True)
    except (httpx.ConnectError, httpx.TransportError) as exc:
        logger.warning("forwarder: passthrough upstream error: %s", exc)
        return JSONResponse(
            status_code=502,
            content={"error": {"type": "proxy_upstream_error", "message": str(exc)}},
        )

    async def body_iter() -> AsyncIterator[bytes]:
        try:
            async for chunk in upstream.aiter_raw():
                yield chunk
        finally:
            await upstream.aclose()

    return StreamingResponse(
        body_iter(),
        status_code=upstream.status_code,
        headers=_filter_response_headers(upstream.headers),
        media_type=upstream.headers.get("content-type"),
    )
