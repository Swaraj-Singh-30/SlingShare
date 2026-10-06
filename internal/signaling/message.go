package signaling

import "encoding/json"

type Message struct {
	Type           string          `json:"type"`
	SessionID      string          `json:"sessionId,omitempty"`
	PeerID         string          `json:"peerId,omitempty"`
	TargetID       string          `json:"targetId,omitempty"`
	DeviceID       string          `json:"deviceId,omitempty"`
	DeviceName     string          `json:"deviceName,omitempty"`
	DeviceType     string          `json:"deviceType,omitempty"`
	TargetDeviceID string          `json:"targetDeviceId,omitempty"`
	Data           json.RawMessage `json:"data,omitempty"`
	Peers          []PeerInfo      `json:"peers,omitempty"`
	Devices        []DiscoveredInfo `json:"devices,omitempty"`
	Device         *DiscoveredInfo  `json:"device,omitempty"`
	IceServers     []IceServer     `json:"iceServers,omitempty"`
	Error          string          `json:"error,omitempty"`
}

type PeerInfo struct {
	ID         string `json:"id"`
	DeviceName string `json:"deviceName"`
	DeviceType string `json:"deviceType"`
}

type DiscoveredInfo struct {
	DeviceID   string `json:"deviceId"`
	DeviceName string `json:"deviceName"`
	DeviceType string `json:"deviceType"`
	Status     string `json:"status"` // "available" | "busy"
}

type IceServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}