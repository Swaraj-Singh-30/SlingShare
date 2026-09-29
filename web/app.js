const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");
const messages = document.getElementById("messages");

const fileInput = document.getElementById("fileInput");
const sendFileButton = document.getElementById("sendFileButton");
const fileStatus = document.getElementById("fileStatus");
const fileProgress = document.getElementById("fileProgress");
const downloads = document.getElementById("downloads");

const sessionId = "ABC123";

const CHUNK_SIZE = 16 * 1024;

const socket = new WebSocket(
    `ws://${window.location.host}/ws`
);

let peerId = null;
let remotePeerId = null;

let peerConnection = null;
let dataChannel = null;

let incomingFile = null;


// ========================================
// WebSocket signalling
// ========================================

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

            sendSignal(
                "answer",
                remotePeerId,
                answer
            );

            break;


        case "answer":
            addMessage("Received WebRTC answer");

            await peerConnection.setRemoteDescription(
                new RTCSessionDescription(message.data)
            );

            break;


        case "ice-candidate":
            if (message.data && peerConnection) {
                try {
                    await peerConnection.addIceCandidate(
                        new RTCIceCandidate(message.data)
                    );
                } catch (error) {
                    console.error(
                        "Failed to add ICE candidate:",
                        error
                    );
                }
            }

            break;


        default:
            console.log(
                "Unknown signalling message:",
                message
            );
    }
});


socket.addEventListener("close", () => {
    addMessage("Disconnected from SlingShare server");
});


socket.addEventListener("error", (error) => {
    console.error("WebSocket error:", error);

    addMessage("WebSocket error");
});


// ========================================
// WebRTC
// ========================================

async function createPeerConnection(isOfferer) {

    peerConnection = new RTCPeerConnection({
        iceServers: [
            {
                urls: "stun:stun.l.google.com:19302"
            }
        ]
    });


    peerConnection.addEventListener(
        "icecandidate",
        (event) => {

            if (!event.candidate || !remotePeerId) {
                return;
            }

            sendSignal(
                "ice-candidate",
                remotePeerId,
                event.candidate
            );
        }
    );


    peerConnection.addEventListener(
        "connectionstatechange",
        () => {

            const state =
                peerConnection.connectionState;

            console.log(
                "WebRTC connection state:",
                state
            );

            addMessage(
                `WebRTC: ${state}`
            );
        }
    );


    peerConnection.addEventListener(
        "datachannel",
        (event) => {

            setupDataChannel(
                event.channel
            );
        }
    );


    if (isOfferer) {

        dataChannel =
            peerConnection.createDataChannel(
                "slingshare"
            );

        setupDataChannel(dataChannel);


        const offer =
            await peerConnection.createOffer();


        await peerConnection.setLocalDescription(
            offer
        );


        sendSignal(
            "offer",
            remotePeerId,
            peerConnection.localDescription
        );
    }
}


// ========================================
// DataChannel
// ========================================

function setupDataChannel(channel) {

    dataChannel = channel;


    dataChannel.binaryType = "arraybuffer";


    dataChannel.addEventListener(
        "open",
        () => {

            addMessage(
                "P2P connection established"
            );

            console.log(
                "DataChannel opened"
            );
        }
    );


    dataChannel.addEventListener(
        "message",
        handleDataChannelMessage
    );


    dataChannel.addEventListener(
        "close",
        () => {

            addMessage(
                "P2P connection closed"
            );
        }
    );


    dataChannel.addEventListener(
        "error",
        (error) => {

            console.error(
                "DataChannel error:",
                error
            );
        }
    );
}


// ========================================
// Handle DataChannel messages
// ========================================

function handleDataChannelMessage(event) {

    // Text message / file metadata
    if (typeof event.data === "string") {

        const message =
            JSON.parse(event.data);


        // Normal text message
        if (message.type === "text") {

            addMessage(
                `Peer: ${message.data}`
            );

            return;
        }


        // File started
        if (message.type === "file-start") {

            incomingFile = {
                name: message.name,
                size: message.size,
                mimeType: message.mimeType,
                chunks: [],
                received: 0
            };


            fileProgress.value = 0;


            fileStatus.textContent =
                `Receiving ${message.name}: 0%`;


            return;
        }


        // File finished
        if (message.type === "file-end") {

            finishFileTransfer();

            return;
        }


        return;
    }


    // Binary file chunk
    if (event.data instanceof ArrayBuffer) {

        receiveFileChunk(
            event.data
        );

        return;
    }


    if (event.data instanceof Blob) {

        event.data
            .arrayBuffer()
            .then(receiveFileChunk);
    }
}


// ========================================
// Send text message
// ========================================

sendButton.addEventListener(
    "click",
    () => {

        const message =
            messageInput.value.trim();


        if (!message) {
            return;
        }


        if (
            !dataChannel ||
            dataChannel.readyState !== "open"
        ) {

            addMessage(
                "P2P connection is not ready"
            );

            return;
        }


        dataChannel.send(
            JSON.stringify({
                type: "text",
                data: message
            })
        );


        addMessage(
            `You → P2P: ${message}`
        );


        messageInput.value = "";
    }
);


// ========================================
// Send file
// ========================================

sendFileButton.addEventListener(
    "click",
    async () => {

        const file =
            fileInput.files[0];


        if (!file) {

            fileStatus.textContent =
                "Select a file first";

            return;
        }


        if (
            !dataChannel ||
            dataChannel.readyState !== "open"
        ) {

            fileStatus.textContent =
                "P2P connection is not ready";

            return;
        }


        // Send file metadata
        dataChannel.send(
            JSON.stringify({
                type: "file-start",
                name: file.name,
                size: file.size,
                mimeType: file.type
            })
        );


        let offset = 0;


        while (offset < file.size) {

            // Apply backpressure
            if (
                dataChannel.bufferedAmount >
                CHUNK_SIZE * 10
            ) {

                await waitForBuffer();
            }


            const chunk =
                await file
                    .slice(
                        offset,
                        offset + CHUNK_SIZE
                    )
                    .arrayBuffer();


            dataChannel.send(chunk);


            offset += chunk.byteLength;


            const progress =
                (offset / file.size) * 100;


            fileProgress.value =
                progress;


            fileStatus.textContent =
                `Sending ${file.name}: ${Math.round(progress)}%`;
        }


        // Tell receiver that transfer is complete
        dataChannel.send(
            JSON.stringify({
                type: "file-end"
            })
        );


        fileProgress.value = 100;


        fileStatus.textContent =
            `Sent ${file.name}`;
    }
);


// ========================================
// Wait for DataChannel buffer
// ========================================

function waitForBuffer() {

    return new Promise((resolve) => {

        const check = () => {

            if (
                dataChannel.bufferedAmount <=
                CHUNK_SIZE * 10
            ) {

                resolve();

            } else {

                setTimeout(
                    check,
                    10
                );
            }
        };


        check();
    });
}


// ========================================
// Receive file chunk
// ========================================

function receiveFileChunk(chunk) {

    if (!incomingFile) {
        return;
    }


    incomingFile.chunks.push(
        chunk
    );


    incomingFile.received +=
        chunk.byteLength;


    const progress =
        (
            incomingFile.received /
            incomingFile.size
        ) * 100;


    fileProgress.value =
        progress;


    fileStatus.textContent =
        `Receiving ${incomingFile.name}: ${Math.round(progress)}%`;
}


// ========================================
// Finish file transfer
// ========================================

function finishFileTransfer() {

    if (!incomingFile) {
        return;
    }


    const blob =
        new Blob(
            incomingFile.chunks,
            {
                type:
                    incomingFile.mimeType
            }
        );


    const url =
        URL.createObjectURL(blob);


    const link =
        document.createElement("a");


    link.href = url;


    link.download =
        incomingFile.name;


    link.textContent =
        `Download ${incomingFile.name}`;


    downloads.appendChild(link);


    downloads.appendChild(
        document.createElement("br")
    );


    fileStatus.textContent =
        `Received ${incomingFile.name}`;


    fileProgress.value = 100;


    incomingFile = null;
}


// ========================================
// Signalling helper
// ========================================

function sendSignal(
    type,
    targetId,
    data
) {

    socket.send(
        JSON.stringify({
            type: type,
            targetId: targetId,
            data: data
        })
    );
}


// ========================================
// Cleanup
// ========================================

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


// ========================================
// UI helper
// ========================================

function addMessage(message) {

    messages.textContent +=
        `${message}\n`;
}