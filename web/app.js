const messageInput =
    document.getElementById("messageInput");

const sendButton =
    document.getElementById("sendButton");

const messages =
    document.getElementById("messages");

const fileInput =
    document.getElementById("fileInput");

const browseButton =
    document.getElementById("browseButton");

const dropZone =
    document.getElementById("dropZone");

const selectedSection =
    document.getElementById("selectedSection");

const selectedFilesContainer =
    document.getElementById("selectedFiles");

const selectedCount =
    document.getElementById("selectedCount");

const clearFilesButton =
    document.getElementById("clearFilesButton");

const sendFilesButton =
    document.getElementById("sendFilesButton");

const transfersSection =
    document.getElementById("transfersSection");

const transfers =
    document.getElementById("transfers");

const connectionStatus =
    document.getElementById("connectionStatus");

const peerStatus =
    document.getElementById("peerStatus");

const sessionIdElement =
    document.getElementById("sessionId");

const copyRoomButton =
    document.getElementById("copyRoomButton");

const createRoomButton =
    document.getElementById("createRoomButton");

const joinRoomButton =
    document.getElementById("joinRoomButton");

const roomInput =
    document.getElementById("roomInput");


const CHUNK_SIZE = 16 * 1024;


const socket = new WebSocket(
    `ws://${window.location.host}/ws`
);


let peerId = null;
let remotePeerId = null;

let sessionId = null;

let peerConnection = null;
let dataChannel = null;

let incomingFile = null;

let selectedFiles = [];


// ========================================
// Session
// ========================================

function createSession() {

    if (socket.readyState !== WebSocket.OPEN) {
        addMessage("Server connection is not ready");
        return;
    }

    socket.send(
        JSON.stringify({
            type: "create-session"
        })
    );
}


function joinSession(roomCode) {

    if (socket.readyState !== WebSocket.OPEN) {
        addMessage("Server connection is not ready");
        return;
    }

    socket.send(
        JSON.stringify({
            type: "join-session",
            sessionId: roomCode
        })
    );
}


// ========================================
// WebSocket
// ========================================

socket.addEventListener("open", () => {

    connectionStatus.textContent =
        "Connected";

    addMessage(
        "Connected to SlingShare server"
    );
});


socket.addEventListener(
    "message",
    async (event) => {

        let message;

        try {
            message =
                JSON.parse(event.data);
        } catch (error) {
            console.error(
                "Invalid server message:",
                error
            );
            return;
        }


        switch (message.type) {

            case "session-created":

                sessionId =
                    message.sessionId;

                peerId =
                    message.peerId;

                sessionIdElement.textContent =
                    sessionId;

                copyRoomButton.disabled =
                    false;

                peerStatus.textContent =
                    "Waiting for peer";

                addMessage(
                    `Room created: ${sessionId}`
                );

                break;


            case "session-joined":

                sessionId =
                    message.sessionId;

                peerId =
                    message.peerId;

                sessionIdElement.textContent =
                    sessionId;

                copyRoomButton.disabled =
                    false;

                peerStatus.textContent =
                    "Connecting...";

                addMessage(
                    `Joined room: ${sessionId}`
                );

                break;


            case "peer-joined":

                remotePeerId =
                    message.peerId;

                peerStatus.textContent =
                    "Connecting...";

                addMessage(
                    "Peer joined the room"
                );


                if (!peerConnection) {

                    await createPeerConnection(
                        true
                    );
                }

                break;


            case "peer-left":

                remotePeerId = null;

                peerStatus.textContent =
                    "Waiting for peer";

                addMessage(
                    "Peer disconnected"
                );

                closePeerConnection();

                break;


            case "offer":

                remotePeerId =
                    message.peerId;

                await createPeerConnection(
                    false
                );


                await peerConnection.setRemoteDescription(
                    new RTCSessionDescription(
                        message.data
                    )
                );


                const answer =
                    await peerConnection.createAnswer();


                await peerConnection.setLocalDescription(
                    answer
                );


                sendSignal(
                    "answer",
                    remotePeerId,
                    answer
                );

                break;


            case "answer":

                if (peerConnection) {

                    await peerConnection.setRemoteDescription(
                        new RTCSessionDescription(
                            message.data
                        )
                    );
                }

                break;


            case "ice-candidate":

                if (
                    message.data &&
                    peerConnection
                ) {

                    try {

                        await peerConnection.addIceCandidate(
                            new RTCIceCandidate(
                                message.data
                            )
                        );

                    } catch (error) {

                        console.error(
                            "ICE error:",
                            error
                        );
                    }
                }

                break;


            case "error": {

                let errorMessage =
                    message.data;

                try {
                    errorMessage =
                        JSON.parse(message.data);
                } catch {
                    // Already a normal string.
                }

                addMessage(
                    `Error: ${errorMessage}`
                );

                break;
            }


            default:

                console.log(
                    "Unknown message:",
                    message
                );
        }
    }
);


socket.addEventListener(
    "close",
    () => {

        connectionStatus.textContent =
            "Disconnected";
    }
);


socket.addEventListener(
    "error",
    (error) => {

        console.error(
            "WebSocket error:",
            error
        );

        connectionStatus.textContent =
            "Connection error";
    }
);


// ========================================
// Create / Join Room
// ========================================

createRoomButton.addEventListener(
    "click",
    () => {

        if (sessionId) {

            addMessage(
                "You are already in a room"
            );

            return;
        }

        createSession();
    }
);


joinRoomButton.addEventListener(
    "click",
    () => {

        const roomCode =
            roomInput.value
                .trim()
                .toUpperCase();


        if (!roomCode) {

            addMessage(
                "Enter a room code"
            );

            roomInput.focus();

            return;
        }


        if (roomCode.length !== 6) {

            addMessage(
                "Room code must be 6 characters"
            );

            roomInput.focus();

            return;
        }


        if (sessionId) {

            addMessage(
                "You are already in a room"
            );

            return;
        }


        joinSession(roomCode);
    }
);


roomInput.addEventListener(
    "input",
    () => {

        roomInput.value =
            roomInput.value
                .toUpperCase()
                .replace(
                    /[^A-Z0-9]/g,
                    ""
                )
                .slice(0, 6);
    }
);


roomInput.addEventListener(
    "keydown",
    (event) => {

        if (event.key === "Enter") {

            joinRoomButton.click();
        }
    }
);


// ========================================
// WebRTC
// ========================================

async function createPeerConnection(
    isOfferer
) {

    peerConnection =
        new RTCPeerConnection({

            iceServers: [
                {
                    urls:
                        "stun:stun.l.google.com:19302"
                }
            ]
        });


    peerConnection.addEventListener(
        "icecandidate",
        (event) => {

            if (
                !event.candidate ||
                !remotePeerId
            ) {
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


            if (state === "connected") {

                peerStatus.textContent =
                    "P2P connected";

                addMessage(
                    "Direct P2P connection established"
                );
            }


            if (
                state === "failed" ||
                state === "disconnected"
            ) {

                peerStatus.textContent =
                    "Disconnected";
            }
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


        setupDataChannel(
            dataChannel
        );


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

    dataChannel =
        channel;

    dataChannel.binaryType =
        "arraybuffer";


    dataChannel.addEventListener(
        "open",
        () => {

            peerStatus.textContent =
                "P2P connected";

            addMessage(
                "P2P connection established"
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

            peerStatus.textContent =
                "Disconnected";
        }
    );
}


// ========================================
// DataChannel messages
// ========================================

function handleDataChannelMessage(
    event
) {

    if (
        typeof event.data ===
        "string"
    ) {

        let message;

        try {

            message =
                JSON.parse(event.data);

        } catch (error) {

            console.error(
                "Invalid P2P message:",
                error
            );

            return;
        }


        if (message.type === "text") {

            addMessage(
                `Peer: ${message.data}`
            );

            return;
        }


        if (
            message.type ===
            "file-start"
        ) {

            startIncomingFile(
                message
            );

            return;
        }


        if (
            message.type ===
            "file-end"
        ) {

            finishIncomingFile();

            return;
        }
    }


    if (
        event.data instanceof
        ArrayBuffer
    ) {

        receiveFileChunk(
            event.data
        );

        return;
    }


    if (
        event.data instanceof
        Blob
    ) {

        event.data
            .arrayBuffer()
            .then(receiveFileChunk);
    }
}


// ========================================
// Text
// ========================================

sendButton.addEventListener(
    "click",
    sendTextMessage
);


messageInput.addEventListener(
    "keydown",
    (event) => {

        if (event.key === "Enter") {

            sendTextMessage();
        }
    }
);


function sendTextMessage() {

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
        `You: ${message}`
    );


    messageInput.value = "";
}


// ========================================
// File selection
// ========================================

browseButton.addEventListener(
    "click",
    () => {

        fileInput.click();
    }
);


fileInput.addEventListener(
    "change",
    () => {

        addSelectedFiles(
            Array.from(
                fileInput.files
            )
        );

        fileInput.value = "";
    }
);


function addSelectedFiles(files) {

    selectedFiles.push(
        ...files
    );

    renderSelectedFiles();
}


function renderSelectedFiles() {

    selectedFilesContainer.innerHTML =
        "";


    selectedCount.textContent =
        `${selectedFiles.length} ${
            selectedFiles.length === 1
                ? "file"
                : "files"
        }`;


    if (selectedFiles.length === 0) {

        selectedSection.classList.add(
            "hidden"
        );

        return;
    }


    selectedSection.classList.remove(
        "hidden"
    );


    selectedFiles.forEach(
        (file, index) => {

            const item =
                document.createElement(
                    "div"
                );

            item.className =
                "file-item";


            const icon =
                document.createElement(
                    "div"
                );

            icon.className =
                "file-icon";

            icon.textContent =
                getFileIcon(file.name);


            const info =
                document.createElement(
                    "div"
                );

            info.className =
                "file-info";


            const name =
                document.createElement(
                    "div"
                );

            name.className =
                "file-name";

            name.textContent =
                file.name;


            const size =
                document.createElement(
                    "div"
                );

            size.className =
                "file-size";

            size.textContent =
                formatBytes(file.size);


            info.appendChild(name);
            info.appendChild(size);


            const remove =
                document.createElement(
                    "button"
                );

            remove.className =
                "remove-file";

            remove.textContent =
                "×";


            remove.addEventListener(
                "click",
                () => {

                    selectedFiles.splice(
                        index,
                        1
                    );

                    renderSelectedFiles();
                }
            );


            item.appendChild(icon);
            item.appendChild(info);
            item.appendChild(remove);


            selectedFilesContainer.appendChild(
                item
            );
        }
    );
}


// ========================================
// Clear
// ========================================

clearFilesButton.addEventListener(
    "click",
    () => {

        selectedFiles = [];

        renderSelectedFiles();
    }
);


// ========================================
// Send files
// ========================================

sendFilesButton.addEventListener(
    "click",
    async () => {

        if (!selectedFiles.length) {
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


        const files =
            [...selectedFiles];


        selectedFiles = [];

        renderSelectedFiles();


        for (const file of files) {

            await sendFile(file);
        }
    }
);


async function sendFile(file) {

    transfersSection.classList.remove(
        "hidden"
    );


    const transfer =
        createTransferCard(
            file.name,
            formatBytes(file.size)
        );


    dataChannel.send(
        JSON.stringify({
            type: "file-start",
            name: file.name,
            size: file.size,
            mimeType:
                file.type ||
                "application/octet-stream"
        })
    );


    let offset = 0;


    while (offset < file.size) {

        await waitForBuffer();


        const chunk =
            await file
                .slice(
                    offset,
                    offset + CHUNK_SIZE
                )
                .arrayBuffer();


        dataChannel.send(chunk);


        offset +=
            chunk.byteLength;


        const progress =
            file.size === 0
                ? 100
                : (
                    offset /
                    file.size
                ) * 100;


        updateTransferCard(
            transfer,
            progress,
            "Sending"
        );
    }


    dataChannel.send(
        JSON.stringify({
            type: "file-end"
        })
    );


    updateTransferCard(
        transfer,
        100,
        "Sent"
    );
}


// ========================================
// Backpressure
// ========================================

function waitForBuffer() {

    return new Promise(
        (resolve) => {

            const check = () => {

                if (
                    dataChannel.bufferedAmount <
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
        }
    );
}


// ========================================
// Receive file
// ========================================

function startIncomingFile(metadata) {

    transfersSection.classList.remove(
        "hidden"
    );


    const transfer =
        createTransferCard(
            metadata.name,
            formatBytes(metadata.size)
        );


    incomingFile = {

        name:
            metadata.name,

        size:
            metadata.size,

        mimeType:
            metadata.mimeType,

        chunks: [],

        received: 0,

        transfer
    };
}


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
        incomingFile.size === 0
            ? 100
            : (
                incomingFile.received /
                incomingFile.size
            ) * 100;


    updateTransferCard(
        incomingFile.transfer,
        progress,
        "Receiving"
    );
}


function finishIncomingFile() {

    if (!incomingFile) {
        return;
    }


    const fileName =
        incomingFile.name;

    const mimeType =
        incomingFile.mimeType;


    const blob =
        new Blob(
            incomingFile.chunks,
            {
                type: mimeType
            }
        );


    const url =
        URL.createObjectURL(blob);


    const downloadButton =
        document.createElement(
            "button"
        );


    downloadButton.className =
        "download-button";

    downloadButton.textContent =
        "Download";


    downloadButton.addEventListener(
        "click",
        () => {

            const link =
                document.createElement(
                    "a"
                );


            link.href =
                url;

            link.download =
                fileName;


            document.body.appendChild(
                link
            );

            link.click();

            link.remove();


            setTimeout(
                () => {

                    URL.revokeObjectURL(
                        url
                    );

                },
                1000
            );
        }
    );


    incomingFile.transfer.card.appendChild(
        downloadButton
    );


    updateTransferCard(
        incomingFile.transfer,
        100,
        "Received"
    );


    incomingFile = null;
}


// ========================================
// Transfer UI
// ========================================

function createTransferCard(
    name,
    size
) {

    const card =
        document.createElement(
            "div"
        );

    card.className =
        "transfer-item";


    const info =
        document.createElement(
            "div"
        );

    info.className =
        "transfer-info";


    const top =
        document.createElement(
            "div"
        );

    top.className =
        "transfer-top";


    const nameElement =
        document.createElement(
            "span"
        );

    nameElement.className =
        "transfer-name";

    nameElement.textContent =
        name;


    const status =
        document.createElement(
            "span"
        );

    status.className =
        "transfer-status";

    status.textContent =
        size;


    top.appendChild(
        nameElement
    );

    top.appendChild(
        status
    );


    const progress =
        document.createElement(
            "progress"
        );

    progress.className =
        "progress";

    progress.max = 100;

    progress.value = 0;


    info.appendChild(
        top
    );

    info.appendChild(
        progress
    );


    card.appendChild(
        info
    );


    transfers.prepend(
        card
    );


    return {
        card,
        progress,
        status
    };
}


function updateTransferCard(
    transfer,
    progress,
    status
) {

    transfer.progress.value =
        progress;


    transfer.status.textContent =
        `${status} · ${Math.round(progress)}%`;
}


// ========================================
// Drag & drop
// ========================================

dropZone.addEventListener(
    "dragover",
    (event) => {

        event.preventDefault();

        dropZone.classList.add(
            "dragover"
        );
    }
);


dropZone.addEventListener(
    "dragleave",
    () => {

        dropZone.classList.remove(
            "dragover"
        );
    }
);


dropZone.addEventListener(
    "drop",
    (event) => {

        event.preventDefault();

        dropZone.classList.remove(
            "dragover"
        );


        addSelectedFiles(
            Array.from(
                event.dataTransfer.files
            )
        );
    }
);


// ========================================
// Room code
// ========================================

copyRoomButton.addEventListener(
    "click",
    async () => {

        if (!sessionId) {
            return;
        }


        try {

            await navigator.clipboard.writeText(
                sessionId
            );


            copyRoomButton.textContent =
                "Copied";


            setTimeout(
                () => {

                    copyRoomButton.textContent =
                        "Copy";

                },
                1200
            );

        } catch (error) {

            console.error(
                "Failed to copy room code:",
                error
            );

            addMessage(
                `Room code: ${sessionId}`
            );
        }
    }
);


// ========================================
// Signaling
// ========================================

function sendSignal(
    type,
    targetId,
    data
) {

    if (
        socket.readyState !==
        WebSocket.OPEN
    ) {
        return;
    }


    socket.send(
        JSON.stringify({
            type,
            targetId,
            peerId,
            data
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
// Helpers
// ========================================

function addMessage(message) {

    messages.textContent +=
        `${message}\n`;


    messages.scrollTop =
        messages.scrollHeight;
}


function formatBytes(bytes) {

    if (bytes === 0) {
        return "0 B";
    }


    const units = [
        "B",
        "KB",
        "MB",
        "GB"
    ];


    const index =
        Math.floor(
            Math.log(bytes) /
            Math.log(1024)
        );


    const value =
        bytes /
        Math.pow(1024, index);


    return `${value.toFixed(
        value >= 10 || index === 0
            ? 0
            : 1
    )} ${units[index]}`;
}


function getFileIcon(filename) {

    const extension =
        filename
            .split(".")
            .pop()
            .toLowerCase();


    if (
        [
            "jpg",
            "jpeg",
            "png",
            "gif",
            "webp"
        ].includes(extension)
    ) {
        return "IMG";
    }


    if (
        [
            "mp4",
            "mov",
            "avi",
            "mkv"
        ].includes(extension)
    ) {
        return "VID";
    }


    if (
        [
            "mp3",
            "wav",
            "ogg",
            "flac"
        ].includes(extension)
    ) {
        return "AUD";
    }


    if (
        [
            "zip",
            "rar",
            "7z",
            "tar",
            "gz"
        ].includes(extension)
    ) {
        return "ZIP";
    }


    if (extension === "pdf") {
        return "PDF";
    }


    return "FILE";
}