package peer

import (
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Peer struct {
	ID        string
	Conn      *websocket.Conn
	JoinedAt  time.Time
	WriteLock sync.Mutex
}

func New(id string, conn *websocket.Conn) *Peer {
	return &Peer{
		ID:       id,
		Conn:     conn,
		JoinedAt: time.Now(),
	}
}