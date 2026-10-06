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

func TestDeviceDiscoveryAndPairing(t *testing.T) {
	srv := NewServer()
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", srv.HandleWebSocket)

	ts := httptest.NewServer(mux)
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	dialer := websocket.DefaultDialer

	// 1. Device A connects and registers presence
	connA, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to dial Device A: %v", err)
	}
	defer connA.Close()

	regA := Message{
		Type:       "register-presence",
		DeviceID:   "dev_macbook_01",
		DeviceName: "Swaraj's MacBook",
		DeviceType: "laptop",
	}
	if err := connA.WriteJSON(regA); err != nil {
		t.Fatalf("failed to register presence for Device A: %v", err)
	}

	var presListA Message
	if err := connA.ReadJSON(&presListA); err != nil {
		t.Fatalf("failed to read presence-list for Device A: %v", err)
	}
	if presListA.Type != "presence-list" {
		t.Fatalf("expected presence-list, got: %s", presListA.Type)
	}
	if len(presListA.Devices) != 0 {
		t.Fatalf("expected empty presence list for first device, got %d devices", len(presListA.Devices))
	}

	// 2. Device B connects and registers presence
	connB, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to dial Device B: %v", err)
	}
	defer connB.Close()

	regB := Message{
		Type:       "register-presence",
		DeviceID:   "dev_pixel_02",
		DeviceName: "Pixel Phone",
		DeviceType: "phone",
	}
	if err := connB.WriteJSON(regB); err != nil {
		t.Fatalf("failed to register presence for Device B: %v", err)
	}

	// Device B receives presence list (should contain Device A)
	var presListB Message
	if err := connB.ReadJSON(&presListB); err != nil {
		t.Fatalf("failed to read presence-list for Device B: %v", err)
	}
	if len(presListB.Devices) != 1 || presListB.Devices[0].DeviceID != "dev_macbook_01" {
		t.Fatalf("expected Device B to see Device A in presence list, got: %+v", presListB.Devices)
	}

	// Device A receives device-joined broadcast for Device B
	var devJoinedA Message
	if err := connA.ReadJSON(&devJoinedA); err != nil {
		t.Fatalf("failed to read device-joined on Device A: %v", err)
	}
	if devJoinedA.Type != "device-joined" || devJoinedA.Device == nil || devJoinedA.Device.DeviceID != "dev_pixel_02" {
		t.Fatalf("unexpected device-joined message on Device A: %+v", devJoinedA)
	}

	// 3. Device A requests pairing with Device B via Radar
	pairReq := Message{
		Type:           "request-pairing",
		TargetDeviceID: "dev_pixel_02",
		DeviceName:     "Swaraj's MacBook",
		DeviceType:     "laptop",
	}
	if err := connA.WriteJSON(pairReq); err != nil {
		t.Fatalf("failed to send pairing request: %v", err)
	}

	// Device A receives pairing-initiated with session code
	var pairInitA Message
	if err := connA.ReadJSON(&pairInitA); err != nil {
		t.Fatalf("failed to read pairing-initiated on Device A: %v", err)
	}
	if pairInitA.Type != "pairing-initiated" || pairInitA.SessionID == "" {
		t.Fatalf("invalid pairing-initiated message: %+v", pairInitA)
	}
	assignedSessionID := pairInitA.SessionID

	// Device B receives pairing-invitation with the same session code
	var pairInviteB Message
	if err := connB.ReadJSON(&pairInviteB); err != nil {
		t.Fatalf("failed to read pairing-invitation on Device B: %v", err)
	}
	if pairInviteB.Type != "pairing-invitation" || pairInviteB.SessionID != assignedSessionID {
		t.Fatalf("invalid pairing-invitation on Device B: %+v", pairInviteB)
	}

	// 4. Device B disconnects -> Device A receives device-left
	connB.Close()

	_ = connA.SetReadDeadline(time.Now().Add(2 * time.Second))
	var devLeftA Message
	if err := connA.ReadJSON(&devLeftA); err != nil {
		t.Fatalf("failed to read device-left on Device A: %v", err)
	}
	if devLeftA.Type != "device-left" || devLeftA.DeviceID != "dev_pixel_02" {
		t.Fatalf("unexpected device-left message: %+v", devLeftA)
	}
}
