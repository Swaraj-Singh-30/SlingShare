package peer

import (
	"encoding/json"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Peer struct {
	ID         string    `json:"id"`
	DeviceName string    `json:"deviceName"`
	DeviceType string    `json:"deviceType"`
	Conn       *websocket.Conn `json:"-"`
	JoinedAt   time.Time `json:"joinedAt"`
	WriteLock  sync.Mutex `json:"-"`
}

func New(id string, conn *websocket.Conn, deviceName, deviceType string) *Peer {
	if deviceName == "" {
		deviceName = "Device-" + id[:4]
	}
	if deviceType == "" {
		deviceType = "unknown"
	}
	return &Peer{
		ID:         id,
		DeviceName: deviceName,
		DeviceType: deviceType,
		Conn:       conn,
		JoinedAt:   time.Now(),
	}
}

// SendJSON sends a JSON-serializable message thread-safely.
func (p *Peer) SendJSON(v interface{}) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return p.SendMessage(websocket.TextMessage, data)
}

// SendMessage writes raw bytes to the peer's websocket connection thread-safely.
func (p *Peer) SendMessage(messageType int, data []byte) error {
	p.WriteLock.Lock()
	defer p.WriteLock.Unlock()

	if p.Conn == nil {
		return websocket.ErrCloseSent
	}
	_ = p.Conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	return p.Conn.WriteMessage(messageType, data)
}

// Close closes the underlying websocket connection.
func (p *Peer) Close() error {
	p.WriteLock.Lock()
	defer p.WriteLock.Unlock()

	if p.Conn != nil {
		return p.Conn.Close()
	}
	return nil
}