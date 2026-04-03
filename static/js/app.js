document.addEventListener("DOMContentLoaded", () => {
    // ── Config ───────────────────────────────────────────────────
    const CHUNK_SIZE = 64 * 1024;          // 64 KB per chunk
    const BUFFER_THRESHOLD = 2 * 1024 * 1024; // 2 MB — pause when buffer exceeds this
    const SPEED_INTERVAL = 500;            // Update speed display every 500ms

    // ── State ────────────────────────────────────────────────────
    const peerId = "peer-" + Math.random().toString(36).substring(2, 8);
    let selectedFile = null;
    let selectedPeer = null;
    let otherPeers = [];
    let peerConnection = null;
    let dataChannel = null;
    let isTransferring = false;

    // Receiver state
    let receiveBuffer = [];
    let receivedSize = 0;
    let incomingFileInfo = null;

    // Speed tracking
    let speedBytes = 0;
    let speedTimer = null;
    let transferStartTime = 0;

    // ── DOM refs ─────────────────────────────────────────────────
    const dropzone = document.getElementById("dropzone");
    const dropDefault = document.getElementById("dropzone-default");
    const dropReady = document.getElementById("dropzone-ready");
    const fileInput = document.getElementById("file-input");
    const fileNameEl = document.getElementById("file-name");
    const fileSizeEl = document.getElementById("file-size");
    const btnSend = document.getElementById("btn-send");
    const btnClear = document.getElementById("btn-clear");
    const peerListSection = document.getElementById("peer-list");
    const peersUl = document.getElementById("peers");
    const statusEl = document.getElementById("status");
    const incomingEl = document.getElementById("incoming");
    const incomingSender = document.getElementById("incoming-sender");
    const incomingName = document.getElementById("incoming-name");
    const incomingSize = document.getElementById("incoming-size");
    const btnAccept = document.getElementById("btn-accept");
    const btnReject = document.getElementById("btn-reject");
    const transferEl = document.getElementById("transfer");
    const transferLabel = document.getElementById("transfer-label");
    const transferFile = document.getElementById("transfer-file");
    const progressFill = document.getElementById("progress-fill");
    const transferStats = document.getElementById("transfer-stats");
    const transferSpeed = document.getElementById("transfer-speed");

    // ── Helpers ──────────────────────────────────────────────────
    function formatSize(bytes) {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
        if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
        return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
    }

    function setStatus(text) {
        statusEl.innerHTML = `<p>${text}</p>`;
    }

    function showTransfer(label, name) {
        transferLabel.textContent = label;
        transferFile.textContent = name;
        progressFill.style.width = "0%";
        progressFill.classList.remove("done", "error");
        transferStats.textContent = "0%";
        transferSpeed.textContent = "";
        transferEl.classList.remove("hidden");
        dropzone.classList.add("disabled");
        isTransferring = true;
        transferStartTime = Date.now();
        startSpeedTracker();
    }

    function updateProgress(sent, total) {
        const pct = Math.round((sent / total) * 100);
        progressFill.style.width = pct + "%";
        transferStats.textContent = `${pct}% — ${formatSize(sent)} / ${formatSize(total)}`;
        speedBytes = sent;
    }

    function finishTransfer(label) {
        progressFill.style.width = "100%";
        progressFill.classList.add("done");
        transferLabel.textContent = label;
        const elapsed = (Date.now() - transferStartTime) / 1000;
        const avgSpeed = speedBytes / elapsed;
        transferStats.textContent = "Complete!";
        transferSpeed.textContent = `${formatSize(avgSpeed)}/s avg — ${elapsed.toFixed(1)}s`;
        stopSpeedTracker();
        isTransferring = false;
        dropzone.classList.remove("disabled");
    }

    function showTransferError(message) {
        progressFill.classList.add("error");
        transferLabel.textContent = "Transfer failed";
        transferStats.textContent = message;
        transferSpeed.textContent = "";
        stopSpeedTracker();
        isTransferring = false;
        dropzone.classList.remove("disabled");
    }

    function hideTransfer() {
        transferEl.classList.add("hidden");
    }

    // Speed tracker
    let lastSpeedBytes = 0;
    function startSpeedTracker() {
        lastSpeedBytes = 0;
        speedTimer = setInterval(() => {
            const delta = speedBytes - lastSpeedBytes;
            const rate = delta / (SPEED_INTERVAL / 1000);
            transferSpeed.textContent = `${formatSize(rate)}/s`;
            lastSpeedBytes = speedBytes;
        }, SPEED_INTERVAL);
    }

    function stopSpeedTracker() {
        if (speedTimer) {
            clearInterval(speedTimer);
            speedTimer = null;
        }
    }

    function resetAfterTransfer() {
        setTimeout(() => {
            hideTransfer();
            clearFile();
            cleanupPeerConnection();
        }, 4000);
    }

    // ── File selection ───────────────────────────────────────────
    function handleFile(file) {
        selectedFile = file;
        fileNameEl.textContent = file.name;
        fileSizeEl.textContent = formatSize(file.size);
        dropDefault.classList.add("hidden");
        dropReady.classList.remove("hidden");
        updateSendButton();
        console.log("[FileShare] File selected:", file.name, formatSize(file.size));
    }

    function clearFile() {
        selectedFile = null;
        fileInput.value = "";
        dropReady.classList.add("hidden");
        dropDefault.classList.remove("hidden");
        updateSendButton();
    }

    function updateSendButton() {
        if (selectedFile && selectedPeer) {
            btnSend.disabled = false;
            btnSend.textContent = `Send to ${selectedPeer}`;
        } else if (selectedFile && !selectedPeer) {
            btnSend.disabled = true;
            btnSend.textContent = "Select a peer to send";
        }
    }

    // ── Drag & Drop ──────────────────────────────────────────────
    let dragCounter = 0;

    dropzone.addEventListener("dragenter", (e) => {
        e.preventDefault();
        if (isTransferring) return;
        dragCounter++;
        dropzone.classList.add("drag-over");
    });

    dropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
    });

    dropzone.addEventListener("dragleave", (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter === 0) dropzone.classList.remove("drag-over");
    });

    dropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        dragCounter = 0;
        dropzone.classList.remove("drag-over");
        if (isTransferring) return;
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    });

    dropzone.addEventListener("click", () => {
        if (!selectedFile && !isTransferring) fileInput.click();
    });

    fileInput.addEventListener("change", () => {
        if (fileInput.files[0]) handleFile(fileInput.files[0]);
    });

    btnClear.addEventListener("click", (e) => {
        e.stopPropagation();
        clearFile();
    });

    document.addEventListener("dragover", (e) => e.preventDefault());
    document.addEventListener("drop", (e) => e.preventDefault());

    // ── Peer list rendering ──────────────────────────────────────
    function renderPeers() {
        peersUl.innerHTML = "";
        if (otherPeers.length === 0) {
            peerListSection.classList.add("hidden");
            setStatus("Waiting for another device to connect&hellip;");
            return;
        }

        peerListSection.classList.remove("hidden");
        setStatus(`You are <strong>${peerId}</strong>`);

        otherPeers.forEach((id) => {
            const li = document.createElement("li");
            li.innerHTML = `<span class="dot"></span><span class="peer-id">${id}</span>`;
            if (id === selectedPeer) li.classList.add("selected");
            li.addEventListener("click", () => {
                if (isTransferring) return;
                selectedPeer = id;
                renderPeers();
                updateSendButton();
            });
            peersUl.appendChild(li);
        });
    }

    // ── WebRTC ───────────────────────────────────────────────────
    const rtcConfig = {
        iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
        ]
    };

    function cleanupPeerConnection() {
        if (dataChannel) {
            try { dataChannel.close(); } catch (_) {}
            dataChannel = null;
        }
        if (peerConnection) {
            try { peerConnection.close(); } catch (_) {}
            peerConnection = null;
        }
    }

    function createPeerConnection(remotePeerId) {
        cleanupPeerConnection();
        const pc = new RTCPeerConnection(rtcConfig);
        peerConnection = pc;

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                ws.send(JSON.stringify({
                    type: "ice-candidate",
                    target: remotePeerId,
                    data: e.candidate,
                }));
            }
        };

        pc.oniceconnectionstatechange = () => {
            console.log("[WebRTC] ICE state:", pc.iceConnectionState);
            if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") {
                if (isTransferring) {
                    showTransferError("Connection lost.");
                    resetAfterTransfer();
                }
            }
        };

        return pc;
    }

    // ── Sender ───────────────────────────────────────────────────
    async function startSending(remotePeerId) {
        const pc = createPeerConnection(remotePeerId);

        dataChannel = pc.createDataChannel("fileTransfer", { ordered: true });
        dataChannel.binaryType = "arraybuffer";

        dataChannel.onopen = () => {
            console.log("[WebRTC] Data channel open — sending metadata");
            dataChannel.send(JSON.stringify({
                type: "file-meta",
                name: selectedFile.name,
                size: selectedFile.size,
                mimeType: selectedFile.type,
            }));
            // Don't send chunks yet — wait for receiver "ready" signal
        };

        dataChannel.onmessage = (e) => {
            if (typeof e.data === "string") {
                let msg;
                try { msg = JSON.parse(e.data); } catch { return; }
                if (msg.type === "ready") {
                    console.log("[WebRTC] Receiver ready — starting chunk transfer");
                    sendFileChunks();
                }
            }
        };

        dataChannel.onerror = (e) => {
            console.error("[WebRTC] Data channel error:", e);
            showTransferError("Data channel error.");
            resetAfterTransfer();
        };

        dataChannel.onclose = () => {
            console.log("[WebRTC] Data channel closed (sender)");
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        ws.send(JSON.stringify({
            type: "rtc-offer",
            target: remotePeerId,
            data: offer,
        }));
        console.log("[WebRTC] Sent offer to", remotePeerId);
    }

    function sendFileChunks() {
        const file = selectedFile;
        let offset = 0;
        const total = file.size;

        showTransfer("Sending...", file.name);

        const reader = new FileReader();

        reader.onerror = () => {
            console.error("[FileShare] FileReader error:", reader.error);
            showTransferError("Failed to read file.");
            resetAfterTransfer();
        };

        reader.onload = (e) => {
            if (!dataChannel || dataChannel.readyState !== "open") {
                showTransferError("Connection closed during transfer.");
                resetAfterTransfer();
                return;
            }

            try {
                dataChannel.send(e.target.result);
            } catch (err) {
                console.error("[FileShare] Send error:", err);
                showTransferError("Send failed.");
                resetAfterTransfer();
                return;
            }

            offset += e.target.result.byteLength;
            updateProgress(offset, total);

            if (offset < total) {
                if (dataChannel.bufferedAmount > BUFFER_THRESHOLD) {
                    waitForBuffer(readNextChunk);
                } else {
                    readNextChunk();
                }
            } else {
                // All chunks sent — send end signal
                dataChannel.send(JSON.stringify({ type: "file-end" }));
                finishTransfer("Sent!");
                console.log("[FileShare] File sent:", file.name);
                resetAfterTransfer();
            }
        };

        function readNextChunk() {
            const slice = file.slice(offset, offset + CHUNK_SIZE);
            reader.readAsArrayBuffer(slice);
        }

        function waitForBuffer(callback) {
            const check = () => {
                if (!dataChannel || dataChannel.readyState !== "open") return;
                if (dataChannel.bufferedAmount <= BUFFER_THRESHOLD) {
                    callback();
                } else {
                    setTimeout(check, 30);
                }
            };
            check();
        }

        readNextChunk();
    }

    // ── Receiver ─────────────────────────────────────────────────
    async function handleRtcOffer(sender, offer) {
        const pc = createPeerConnection(sender);

        pc.ondatachannel = (e) => {
            console.log("[WebRTC] Received data channel");
            dataChannel = e.channel;
            dataChannel.binaryType = "arraybuffer";
            setupReceiverChannel();
        };

        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({
            type: "rtc-answer",
            target: sender,
            data: answer,
        }));
        console.log("[WebRTC] Sent answer to", sender);
    }

    function setupReceiverChannel() {
        receiveBuffer = [];
        receivedSize = 0;
        incomingFileInfo = null;

        dataChannel.onmessage = (e) => {
            if (typeof e.data === "string") {
                let msg;
                try { msg = JSON.parse(e.data); } catch { return; }

                if (msg.type === "file-meta") {
                    incomingFileInfo = msg;
                    showTransfer("Receiving...", msg.name);
                    console.log("[FileShare] Receiving:", msg.name, formatSize(msg.size));
                    // Tell sender we're ready to receive chunks
                    dataChannel.send(JSON.stringify({ type: "ready" }));
                } else if (msg.type === "file-end") {
                    assembleAndDownload();
                }
                return;
            }

            // Binary chunk
            receiveBuffer.push(e.data);
            receivedSize += e.data.byteLength;
            if (incomingFileInfo) {
                updateProgress(receivedSize, incomingFileInfo.size);
            }
        };

        dataChannel.onerror = (e) => {
            console.error("[WebRTC] Receiver data channel error:", e);
            showTransferError("Data channel error.");
            resetAfterTransfer();
        };

        dataChannel.onclose = () => {
            console.log("[WebRTC] Data channel closed (receiver)");
            // If we haven't finished receiving, it's an error
            if (isTransferring && incomingFileInfo && receivedSize < incomingFileInfo.size) {
                showTransferError("Connection closed before transfer completed.");
                resetAfterTransfer();
            }
        };
    }

    function assembleAndDownload() {
        if (!incomingFileInfo) return;

        const blob = new Blob(receiveBuffer, {
            type: incomingFileInfo.mimeType || "application/octet-stream",
        });

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = incomingFileInfo.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Revoke after a short delay to ensure download starts
        setTimeout(() => URL.revokeObjectURL(url), 5000);

        finishTransfer("Received!");
        console.log("[FileShare] File received:", incomingFileInfo.name, formatSize(receivedSize));

        receiveBuffer = [];
        receivedSize = 0;
        incomingFileInfo = null;
        resetAfterTransfer();
    }

    // ── Send button ──────────────────────────────────────────────
    btnSend.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!selectedFile || !selectedPeer || isTransferring) return;

        ws.send(JSON.stringify({
            type: "file-offer",
            target: selectedPeer,
            data: {
                name: selectedFile.name,
                size: selectedFile.size,
                mimeType: selectedFile.type,
            },
        }));
        btnSend.disabled = true;
        btnSend.textContent = "Waiting for acceptance...";
        console.log(`[FileShare] Sent file-offer to ${selectedPeer}`);
    });

    // ── Incoming file offer UI ───────────────────────────────────
    let pendingOffer = null;

    function showIncoming(sender, fileData) {
        pendingOffer = { sender, ...fileData };
        incomingSender.textContent = sender;
        incomingName.textContent = fileData.name;
        incomingSize.textContent = formatSize(fileData.size);
        incomingEl.classList.remove("hidden");
    }

    function hideIncoming() {
        pendingOffer = null;
        incomingEl.classList.add("hidden");
    }

    btnAccept.addEventListener("click", () => {
        if (!pendingOffer) return;
        ws.send(JSON.stringify({
            type: "file-accept",
            target: pendingOffer.sender,
            data: {},
        }));
        console.log(`[FileShare] Accepted file from ${pendingOffer.sender}`);
        hideIncoming();
    });

    btnReject.addEventListener("click", () => {
        if (!pendingOffer) return;
        ws.send(JSON.stringify({
            type: "file-reject",
            target: pendingOffer.sender,
            data: {},
        }));
        console.log(`[FileShare] Rejected file from ${pendingOffer.sender}`);
        hideIncoming();
    });

    // ── WebSocket (Signaling) ────────────────────────────────────
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/ws/${peerId}`);

    ws.onopen = () => {
        console.log(`[FileShare] Connected as ${peerId}`);
        setStatus(`You are <strong>${peerId}</strong> — waiting for peers&hellip;`);
    };

    ws.onmessage = async (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }

        switch (msg.type) {
            case "peers":
                otherPeers = msg.data.filter((id) => id !== peerId);
                if (selectedPeer && !otherPeers.includes(selectedPeer)) {
                    selectedPeer = null;
                    updateSendButton();
                }
                if (otherPeers.length === 1) selectedPeer = otherPeers[0];
                renderPeers();
                updateSendButton();
                break;

            case "file-offer":
                if (isTransferring) {
                    // Busy — auto-reject
                    ws.send(JSON.stringify({
                        type: "file-reject",
                        target: msg.sender,
                        data: {},
                    }));
                    break;
                }
                showIncoming(msg.sender, msg.data);
                break;

            case "file-accept":
                console.log(`[FileShare] ${msg.sender} accepted — starting WebRTC`);
                btnSend.textContent = "Connecting...";
                try {
                    await startSending(msg.sender);
                } catch (err) {
                    console.error("[WebRTC] Failed to start:", err);
                    showTransferError("Failed to establish connection.");
                    resetAfterTransfer();
                }
                break;

            case "file-reject":
                console.log(`[FileShare] ${msg.sender} rejected the file.`);
                btnSend.disabled = false;
                btnSend.textContent = `Send to ${selectedPeer}`;
                break;

            case "rtc-offer":
                console.log(`[WebRTC] Received offer from ${msg.sender}`);
                try {
                    await handleRtcOffer(msg.sender, msg.data);
                } catch (err) {
                    console.error("[WebRTC] Failed to handle offer:", err);
                }
                break;

            case "rtc-answer":
                if (peerConnection) {
                    await peerConnection.setRemoteDescription(
                        new RTCSessionDescription(msg.data)
                    );
                }
                break;

            case "ice-candidate":
                if (peerConnection) {
                    try {
                        await peerConnection.addIceCandidate(new RTCIceCandidate(msg.data));
                    } catch (err) {
                        console.warn("[WebRTC] ICE candidate error:", err);
                    }
                }
                break;

            case "error":
                console.warn("[Signal] Server error:", msg.data);
                break;
        }
    };

    ws.onclose = () => {
        console.log("[FileShare] WebSocket closed.");
        setStatus(`<span style="color:var(--red)">Disconnected from server. Refresh to reconnect.</span>`);
    };

    ws.onerror = () => {
        console.error("[FileShare] WebSocket error.");
    };

    // Expose for debugging
    window._ws = ws;
    window._peerId = peerId;
});
