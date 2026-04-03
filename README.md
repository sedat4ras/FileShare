# FileShare — Secure Local P2P File Transfer

FileShare is a **peer-to-peer file transfer tool** that works entirely on your local network. Open a browser on any device, drag and drop a file, and send it directly to another device — no cloud, no account, no internet required.

All file data flows **directly between browsers** over an encrypted WebRTC connection. The server never sees or touches your files.

---

## Why FileShare?

Transferring files between your own devices shouldn't require uploading to a cloud service, plugging in cables, or installing heavy apps. Existing solutions either:

- **Route your data through external servers** (WeTransfer, Google Drive, AirDrop alternatives) — slow and a privacy concern.
- **Require software installation on every device** (Syncthing, Resilio) — heavy setup for a simple task.
- **Only work within one ecosystem** (AirDrop is Apple-only, Nearby Share is Android/Windows-only).

FileShare solves this: **one device runs the server, every other device just opens a browser.** It works across Windows, macOS, Linux, iOS, and Android — anything with a modern browser.

---

## How It Works

```
┌──────────┐                          ┌──────────┐
│ Device A │◄── WebRTC Data Channel ──►│ Device B │
│ (Browser)│    (Direct P2P, DTLS)     │ (Browser)│
└────┬─────┘                          └────┬─────┘
     │           ┌──────────┐              │
     └──────────►│  Server  │◄─────────────┘
                 │(Signaling│
                 │  only)   │
                 └──────────┘
```

1. **Device A** selects a file and clicks "Send"
2. The server relays a small signaling message (connection metadata only)
3. A **direct WebRTC connection** is established between the two browsers
4. The file is split into 64KB chunks and transferred directly — **the server transfers zero bytes of file data**
5. Device B automatically downloads the reassembled file

Both devices can send and receive — the connection is fully bidirectional.

---

## Tech Stack

### Backend

| Technology | Purpose |
|---|---|
| **[Python](https://www.python.org/)** | Backend runtime. Chosen for its simplicity and rich ecosystem. |
| **[FastAPI](https://fastapi.tiangolo.com/)** | Web framework serving the UI and WebSocket signaling. FastAPI is async-native, making it ideal for handling concurrent WebSocket connections with minimal overhead. |
| **[Uvicorn](https://www.uvicorn.org/)** | ASGI server that runs the FastAPI app. Lightning-fast, production-grade, and supports WebSockets natively. |
| **[Zeroconf (mDNS)](https://github.com/python-zeroconf/python-zeroconf)** | Local network discovery. Broadcasts the service so devices can reach the server via `http://fileshare.local:8000` instead of typing IP addresses. Uses the same protocol as Apple Bonjour. |

### Frontend

| Technology | Purpose |
|---|---|
| **HTML5 / CSS3 / Vanilla JS** | No frameworks, no build tools, no dependencies. The entire frontend is ~300 lines of JS. This keeps the project lightweight, fast to load, and easy to understand or modify. |
| **[WebRTC Data Channels](https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel)** | The core of the file transfer. WebRTC creates a direct peer-to-peer connection between browsers with built-in **DTLS encryption**. Data never passes through the server. |
| **[Drag and Drop API](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API)** | Native browser API for intuitive file selection. |

### Why These Choices?

- **WebRTC over WebSocket transfer:** WebSocket would route all data through the server, creating a bottleneck. WebRTC sends data directly between devices at LAN speeds (typically 50-100+ MB/s).
- **FastAPI over Flask/Express:** Async-first design handles many simultaneous WebSocket connections without thread-pool limitations.
- **Vanilla JS over React/Vue:** For a single-page app with ~10 UI elements, a framework would add unnecessary complexity and load time. The entire frontend loads in under 50KB.
- **Zeroconf over manual IP:** Typing `192.168.x.x` is error-prone, especially on mobile. mDNS lets users simply type `fileshare.local`.

---

## Security

- **End-to-end encrypted transfer:** WebRTC Data Channels use DTLS (Datagram Transport Layer Security). File data is encrypted in transit between browsers.
- **Zero server exposure:** The server only relays small JSON signaling messages (~1KB). It never receives, stores, or has access to file contents.
- **No internet required:** Everything runs on your local network. No data leaves your LAN.
- **Input validation:** Peer IDs are validated via regex. Signaling messages are size-limited (64KB max). Duplicate connections are rejected.
- **Security headers:** `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy` are set on all HTTP responses.

---

## Installation

### Prerequisites

- **Python 3.10+** installed on the host machine
- A local network (Wi-Fi or Ethernet) connecting your devices

### Setup

```bash
# Clone the repository
git clone https://github.com/sedat4ras/FileShare.git
cd FileShare

# Install dependencies
pip install -r requirements.txt
```

> **Note:** On some systems you may need to use `py -m pip` or `pip3` instead of `pip`.

### Run

**Windows:**
```bash
# Double-click start.bat, or run:
py -m uvicorn main:app --host 0.0.0.0 --port 8000
```

**macOS / Linux:**
```bash
# Make the script executable (one-time):
chmod +x start.sh

# Then run:
./start.sh

# Or directly:
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000
```

### Access

Once the server starts, you'll see:

```
[FileShare] mDNS registered — http://fileshare.local:8000
[FileShare] Also reachable at  — http://192.168.1.6:8000
```

- **On the host machine:** Open `http://localhost:8000`
- **On other devices:** Open `http://fileshare.local:8000` or use the IP address shown in the terminal
- **On mobile:** Simply type the address in your phone's browser — no app install needed

> **Windows Firewall:** If other devices can't connect, allow port 8000:
> ```
> netsh advfirewall firewall add rule name="FileShare" dir=in action=allow protocol=TCP localport=8000
> ```

---

## Usage

1. Open the web interface on **two devices**
2. Both devices will see each other in the peer list
3. On the sending device: **drag & drop a file** (or click to select)
4. Click **"Send to peer-xxxxx"**
5. On the receiving device: click **"Accept"**
6. Watch the progress bar — the file downloads automatically when complete

Both devices can send and receive files in either direction.

> **Folders:** WebRTC Data Channels transfer single files. To send a folder, **compress it into a ZIP first** (right-click → Compress on macOS, or Send to → Compressed folder on Windows), then drag and drop the ZIP file.

---

## Project Structure

```
FileShare/
├── main.py              # FastAPI server (signaling + mDNS + static hosting)
├── requirements.txt     # Python dependencies
├── start.bat            # Windows launcher
├── start.sh             # macOS/Linux launcher
├── templates/
│   └── index.html       # Main page
└── static/
    ├── css/style.css    # Dark theme UI
    └── js/app.js        # WebRTC + signaling + drag-and-drop logic
```

---

## License

This project is licensed under the [MIT License](LICENSE).
