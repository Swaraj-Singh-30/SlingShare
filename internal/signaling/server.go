package signaling

import (
	"log"
	"net/http"

	"github.com/Swaraj-Singh-30/SlingShare/internal/peer"
	"github.com/Swaraj-Singh-30/SlingShare/internal/session"
	"github.com/gorilla/websocket"
)

type Server struct {
	upgrader websocket.Upgrader
	sessions *session.Manager
}

func NewServer() *Server {
	return &Server{
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true
			},
		},
		sessions: session.NewManager(),
	}
}

func (s *Server) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("WebSocket upgrade failed:", err)
		return
	}
	defer conn.Close()

	// Temporary IDs for testing.
	peerID := r.URL.Query().Get("peer")
	sessionID := r.URL.Query().Get("session")

	if peerID == "" || sessionID == "" {
		log.Println("Missing peer or session ID")
		return
	}

	p := peer.New(peerID, conn)

	// Create the session if it doesn't exist.
	if _, exists := s.sessions.Get(sessionID); !exists {
		s.sessions.Create(sessionID)
	}

	if !s.sessions.AddPeer(sessionID, p) {
		log.Println("Failed to add peer")
		return
	}

	log.Printf("Peer %s joined session %s", peerID, sessionID)

	defer s.sessions.RemovePeer(sessionID, peerID)

	for {
		messageType, message, err := conn.ReadMessage()
		if err != nil {
			log.Printf("Peer %s disconnected", peerID)
			return
		}

		log.Printf("Received from %s: %s", peerID, message)

		s.broadcast(sessionID, peerID, messageType, message)
	}
}

func (s *Server) broadcast(
	sessionID string,
	senderID string,
	messageType int,
	message []byte,
) {
	currentSession, exists := s.sessions.Get(sessionID)
	if !exists {
		return
	}

	for peerID, p := range currentSession.Peers {
		if peerID == senderID {
			continue
		}

		p.WriteLock.Lock()

		err := p.Conn.WriteMessage(messageType, message)

		p.WriteLock.Unlock()

		if err != nil {
			log.Printf("Failed to send message to %s: %v", peerID, err)
		}
	}
}