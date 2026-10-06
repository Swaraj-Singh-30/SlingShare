package signaling

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestSignalingWebSocketFlow(t *testing.T) {
	srv := NewServer()
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", srv.HandleWebSocket)
	mux.HandleFunc("/api/config", srv.HandleConfig)

	ts := httptest.NewServer(mux)
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"

	// 1. Connect Client A
	dialer := websocket.DefaultDialer
	connA, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to dial Client A: %v", err)
	}
	defer connA.Close()

	// 2. Client A creates session
	createMsg := Message{
		Type:       "create-session",
		DeviceName: "MacBook",
		DeviceType: "laptop",
	}
	if err := connA.WriteJSON(createMsg); err != nil {
		t.Fatalf("failed to send create-session: %v", err)
	}

	var respA Message
	if err := connA.ReadJSON(&respA); err != nil {
		t.Fatalf("failed to read create-session response: %v", err)
	}

	if respA.Type != "session-created" || respA.SessionID == "" || respA.PeerID == "" {
		t.Fatalf("invalid session-created response: %+v", respA)
	}
	sessionID := respA.SessionID
	peerA := respA.PeerID

	// 3. Connect Client B
	connB, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to dial Client B: %v", err)
	}
	defer connB.Close()

	// 4. Client B joins session
	joinMsg := Message{
		Type:       "join-session",
		SessionID:  sessionID,
		DeviceName: "Pixel Phone",
		DeviceType: "phone",
	}
	if err := connB.WriteJSON(joinMsg); err != nil {
		t.Fatalf("failed to send join-session: %v", err)
	}

	var respB Message
	if err := connB.ReadJSON(&respB); err != nil {
		t.Fatalf("failed to read join-session response: %v", err)
	}

	if respB.Type != "session-joined" || respB.SessionID != sessionID {
		t.Fatalf("invalid session-joined response: %+v", respB)
	}
	peerB := respB.PeerID
	if len(respB.Peers) != 1 || respB.Peers[0].ID != peerA {
		t.Fatalf("expected Client B to see peer A, got: %+v", respB.Peers)
	}

	// 5. Client A should receive peer-joined notification
	var peerJoinedMsg Message
	if err := connA.ReadJSON(&peerJoinedMsg); err != nil {
		t.Fatalf("failed to read peer-joined on Client A: %v", err)
	}
	if peerJoinedMsg.Type != "peer-joined" || peerJoinedMsg.PeerID != peerB {
		t.Fatalf("unexpected peer-joined message: %+v", peerJoinedMsg)
	}

	// 6. Test offer forwarding from A to B
	offerData := json.RawMessage(`{"sdp":"mock-sdp-offer","type":"offer"}`)
	offerMsg := Message{
		Type:     "offer",
		TargetID: peerB,
		Data:     offerData,
	}
	if err := connA.WriteJSON(offerMsg); err != nil {
		t.Fatalf("failed to send offer: %v", err)
	}

	var receivedOffer Message
	if err := connB.ReadJSON(&receivedOffer); err != nil {
		t.Fatalf("failed to read offer on Client B: %v", err)
	}
	if receivedOffer.Type != "offer" || receivedOffer.PeerID != peerA {
		t.Fatalf("unexpected forwarded offer: %+v", receivedOffer)
	}

	// 7. Client B disconnects -> Client A should receive peer-left
	connB.Close()

	_ = connA.SetReadDeadline(time.Now().Add(2 * time.Second))
	var peerLeftMsg Message
	if err := connA.ReadJSON(&peerLeftMsg); err != nil {
		t.Fatalf("failed to read peer-left on Client A: %v", err)
	}
	if peerLeftMsg.Type != "peer-left" || peerLeftMsg.PeerID != peerB {
		t.Fatalf("unexpected peer-left message: %+v", peerLeftMsg)
	}
}
