package signaling

import "encoding/json"

type Message struct {
	Type      string          `json:"type"`
	SessionID string          `json:"sessionId,omitempty"`
	PeerID    string          `json:"peerId,omitempty"`
	TargetID  string          `json:"targetId,omitempty"`
	Data      json.RawMessage `json:"data,omitempty"`
}