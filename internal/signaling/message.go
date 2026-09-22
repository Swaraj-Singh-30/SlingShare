package signaling

type Message struct {
	Type      string `json:"type"`
	SessionID string `json:"sessionId,omitempty"`
	PeerID    string `json:"peerId,omitempty"`
	Data      string `json:"data,omitempty"`
}