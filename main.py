import json
import re
import socket
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from zeroconf import ServiceInfo
from zeroconf.asyncio import AsyncZeroconf

BASE_DIR = Path(__file__).resolve().parent
SERVICE_TYPE = "_http._tcp.local."
SERVICE_NAME = "FileShare._http._tcp.local."
PORT = 8000
PEER_ID_RE = re.compile(r"^peer-[a-z0-9]{4,12}$")
MAX_SIGNAL_MSG = 64 * 1024  # 64 KB max signaling message


def _get_local_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


# ── Security middleware ───────────────────────────────────────────
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        return response


@asynccontextmanager
async def lifespan(app: FastAPI):
    local_ip = _get_local_ip()
    info = ServiceInfo(
        SERVICE_TYPE,
        SERVICE_NAME,
        addresses=[socket.inet_aton(local_ip)],
        port=PORT,
        properties={"path": "/"},
        server="fileshare.local.",
    )
    azc = AsyncZeroconf()
    await azc.async_register_service(info)
    print(f"[FileShare] mDNS registered — http://fileshare.local:{PORT}")
    print(f"[FileShare] Also reachable at  — http://{local_ip}:{PORT}")
    yield
    await azc.async_unregister_service(info)
    await azc.async_close()
    print("[FileShare] mDNS service unregistered.")


app = FastAPI(title="FileShare", docs_url=None, redoc_url=None, lifespan=lifespan)
app.add_middleware(SecurityHeadersMiddleware)

# ── Signaling state ──────────────────────────────────────────────
peers: dict[str, WebSocket] = {}


@app.websocket("/ws/{peer_id}")
async def signaling(ws: WebSocket, peer_id: str):
    # Validate peer ID format
    if not PEER_ID_RE.match(peer_id):
        await ws.close(code=1008, reason="Invalid peer ID")
        return

    # Reject duplicate peer IDs
    if peer_id in peers:
        await ws.close(code=1008, reason="Peer ID already connected")
        return

    await ws.accept()
    peers[peer_id] = ws
    print(f"[Signal] {peer_id} connected  (peers: {list(peers.keys())})")
    await _broadcast_peer_list()

    try:
        while True:
            raw = await ws.receive_text()

            # Guard against oversized messages
            if len(raw) > MAX_SIGNAL_MSG:
                await ws.send_text(json.dumps({
                    "type": "error", "data": "Message too large",
                }))
                continue

            msg = json.loads(raw)
            target = msg.get("target")

            if target and target in peers:
                await peers[target].send_text(json.dumps({
                    "type": msg["type"],
                    "data": msg.get("data"),
                    "sender": peer_id,
                }))
            else:
                await ws.send_text(json.dumps({
                    "type": "error",
                    "data": f"Unknown target: {target}",
                }))
    except WebSocketDisconnect:
        pass
    except json.JSONDecodeError:
        pass
    finally:
        peers.pop(peer_id, None)
        print(f"[Signal] {peer_id} disconnected  (peers: {list(peers.keys())})")
        await _broadcast_peer_list()


async def _broadcast_peer_list():
    msg = json.dumps({"type": "peers", "data": list(peers.keys())})
    for ws in list(peers.values()):
        try:
            await ws.send_text(msg)
        except Exception:
            pass


# ── Static files & pages ─────────────────────────────────────────
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


@app.get("/", response_class=HTMLResponse)
async def index():
    return (BASE_DIR / "templates" / "index.html").read_text(encoding="utf-8")
