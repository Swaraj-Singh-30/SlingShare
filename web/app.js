const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");
const messages = document.getElementById("messages");

const socket = new WebSocket(
    `ws://${window.location.host}/ws?peer=A&session=ABC123`
);

socket.addEventListener("open", () => {
    addMessage("Connected to SlingShare server");
});

socket.addEventListener("message", (event) => {
    addMessage(`Server: ${event.data}`);
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

    socket.send(message);
    addMessage(`You: ${message}`);

    messageInput.value = "";
});

function addMessage(message) {
    messages.textContent += `${message}\n`;
}