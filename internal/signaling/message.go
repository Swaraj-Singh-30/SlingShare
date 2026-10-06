package signaling

import "encoding/json"

type Message struct {
	Type       string          `json:"type"`
	SessionID  string          `json:"sessionId,omitempty"`
	PeerID     string          `json:"peerId,omitempty"`
	TargetID   string          `json:"targetId,omitempty"`
	DeviceName string          `json:"deviceName,omitempty"`
	DeviceType string          `json:"deviceType,omitempty"`
	Data       json.RawMessage `json:"data,omitempty"`
	Peers      []PeerInfo      `json:"peers,omitempty"`
	IceServers []IceServer     `json:"iceServers,omitempty"`
	Error      string          `json:"error,omitempty"`
}

type PeerInfo struct {
	ID         string `json:"id"`
	DeviceName string `json:"deviceName"`
	DeviceType string `json:"deviceType"`
}

type IceServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}