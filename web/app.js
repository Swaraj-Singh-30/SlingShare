const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");
const messages = document.getElementById("messages");

const sessionId = "ABC123";

const socket = new WebSocket(
    `ws://${window.location.host}/ws`
);

let peerId = null;

socket.addEventListener("open", () => {
    addMessage("Connected to SlingShare server");

    socket.send(JSON.stringify({
        type: "join",
        sessionId: sessionId
    }));
});

socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);

    switch (message.type) {
        case "joined":
            peerId = message.peerId;
            addMessage(`Joined session: ${message.sessionId}`);
            addMessage(`Your peer ID: ${peerId}`);
            break;

        case "peer-joined":
            addMessage(`Peer joined: ${message.peerId}`);
            break;

        case "peer-left":
            addMessage(`Peer left: ${message.peerId}`);
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

sendButton.addEventListener("click", () => {
    const message = messageInput.value.trim();

    if (!message) {
        return;
    }

    socket.send(JSON.stringify({
        type: "message",
        data: message
    }));

    addMessage(`You: ${message}`);

    messageInput.value = "";
});

function addMessage(message) {
    messages.textContent += `${message}\n`;
}