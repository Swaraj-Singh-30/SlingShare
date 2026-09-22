const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");
const messages = document.getElementById("messages");

const sessionId = "ABC123";

const socket = new WebSocket(
    `ws://${window.location.host}/ws`
);

let peerId = null;
let remotePeerId = null;

let peerConnection = null;
let dataChannel = null;


// -----------------------------
// WebSocket signalling
// -----------------------------

socket.addEventListener("open", () => {
    addMessage("Connected to SlingShare server");

    socket.send(JSON.stringify({
        type: "join",
        sessionId: sessionId
    }));
});

socket.addEventListener("message", async (event) => {
    const message = JSON.parse(event.data);

    switch (message.type) {
        case "joined":
            peerId = message.peerId;

            addMessage(`Joined session: ${message.sessionId}`);
            addMessage(`Your peer ID: ${peerId}`);
            break;

        case "peer-joined":
            remotePeerId = message.peerId;

            addMessage(`Peer joined: ${remotePeerId}`);

            // The existing peer creates the WebRTC offer.
            if (!peerConnection) {
                await createPeerConnection(true);
            }

            break;

        case "peer-left":
            addMessage(`Peer left: ${message.peerId}`);

            if (message.peerId === remotePeerId) {
                closePeerConnection();
            }

            break;

        case "offer":
            remotePeerId = message.peerId;

            addMessage("Received WebRTC offer");

            await createPeerConnection(false);

            await peerConnection.setRemoteDescription(
                new RTCSessionDescription(message.data)
            );

            const answer = await peerConnection.createAnswer();

            await peerConnection.setLocalDescription(answer);

            sendSignal("answer", remotePeerId, answer);

            break;

        case "answer":
            addMessage("Received WebRTC answer");

            await peerConnection.setRemoteDescription(
                new RTCSessionDescription(message.data)
            );

            break;

        case "ice-candidate":
            if (message.data) {
                try {
                    await peerConnection.addIceCandidate(
                        new RTCIceCandidate(message.data)
                    );
                } catch (error) {
                    console.error("Failed to add ICE candidate:", error);
                }
            }

            break;

        case "message":
            addMessage(`Peer ${message.peerId}: ${message.data}`);
            break;

        default:
            console.log("Unknown message:", message);
    }
});

socket.addEventListener("close", () => {
    addMessage("Disconnected from SlingShare server");
});

socket.addEventListener("error", (error) => {
    console.error("WebSocket error:", error);
    addMessage("WebSocket error");
});


// -----------------------------
// WebRTC
// -----------------------------

async function createPeerConnection(isOfferer) {
    peerConnection = new RTCPeerConnection({
        iceServers: [
            {
                urls: "stun:stun.l.google.com:19302"
            }
        ]
    });

    peerConnection.addEventListener("icecandidate", (event) => {
        if (!event.candidate || !remotePeerId) {
            return;
        }

        sendSignal(
            "ice-candidate",
            remotePeerId,
            event.candidate
        );
    });

    peerConnection.addEventListener("connectionstatechange", () => {
        console.log(
            "WebRTC connection state:",
            peerConnection.connectionState
        );

        addMessage(
            `WebRTC: ${peerConnection.connectionState}`
        );
    });

    peerConnection.addEventListener("datachannel", (event) => {
        setupDataChannel(event.channel);
    });

    if (isOfferer) {
        dataChannel = peerConnection.createDataChannel("slingshare");

        setupDataChannel(dataChannel);

        const offer = await peerConnection.createOffer();

        await peerConnection.setLocalDescription(offer);

        sendSignal(
            "offer",
            remotePeerId,
            peerConnection.localDescription
        );
    }
}


// -----------------------------
// DataChannel
// -----------------------------

function setupDataChannel(channel) {
    dataChannel = channel;

    dataChannel.addEventListener("open", () => {
        addMessage("P2P connection established");

        console.log("DataChannel opened");
    });

    dataChannel.addEventListener("message", (event) => {
        addMessage(`Peer: ${event.data}`);
    });

    dataChannel.addEventListener("close", () => {
        addMessage("P2P connection closed");
    });

    dataChannel.addEventListener("error", (error) => {
        console.error("DataChannel error:", error);
    });
}


// -----------------------------
// Send signalling message
// -----------------------------

function sendSignal(type, targetId, data) {
    socket.send(JSON.stringify({
        type: type,
        targetId: targetId,
        data: data
    }));
}


// -----------------------------
// Send message
// -----------------------------

sendButton.addEventListener("click", () => {
    const message = messageInput.value.trim();

    if (!message) {
        return;
    }

    // Once WebRTC is connected, send directly to the peer.
    if (dataChannel && dataChannel.readyState === "open") {
        dataChannel.send(message);

        addMessage(`You → P2P: ${message}`);
    } else {
        addMessage("P2P connection is not ready yet");
    }

    messageInput.value = "";
});


// -----------------------------
// Cleanup
// -----------------------------

function closePeerConnection() {
    if (dataChannel) {
        dataChannel.close();
        dataChannel = null;
    }

    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    remotePeerId = null;
}


// -----------------------------
// UI helper
// -----------------------------

function addMessage(message) {
    messages.textContent += `${message}\n`;
}