package signaling

import (
	"log"
	"net/http"

	"github.com/Swaraj-Singh-30/SlingShare/internal/peer"
	"github.com/Swaraj-Singh-30/SlingShare/internal/session"
	"github.com/google/uuid"
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

	log.Println("WebSocket client connected")

	// Wait for the client's join message.
	var msg Message

	if err := conn.ReadJSON(&msg); err != nil {
		log.Println("Failed to read join message:", err)
		return
	}

	if msg.Type != "join" || msg.SessionID == "" {
		log.Println("Invalid join message")
		return
	}

	sessionID := msg.SessionID
	peerID := uuid.NewString()

	// Create the session if it doesn't exist.
	if _, exists := s.sessions.Get(sessionID); !exists {
		s.sessions.Create(sessionID)
	}

	p := peer.New(peerID, conn)

	if !s.sessions.AddPeer(sessionID, p) {
		log.Println("Failed to add peer")
		return
	}

	log.Printf("Peer %s joined session %s", peerID, sessionID)

	// Tell the new peer its assigned ID.
	s.sendMessage(p, Message{
		Type:      "joined",
		SessionID: sessionID,
		PeerID:    peerID,
	})

	// Tell existing peers that a new peer joined.
	s.broadcast(sessionID, peerID, Message{
		Type:   "peer-joined",
		PeerID: peerID,
	})

	defer func() {
		s.sessions.RemovePeer(sessionID, peerID)

		s.broadcast(sessionID, peerID, Message{
			Type:   "peer-left",
			PeerID: peerID,
		})

		log.Printf("Peer %s left session %s", peerID, sessionID)
	}()

	for {
		var msg Message

		if err := conn.ReadJSON(&msg); err != nil {
			log.Printf("Peer %s disconnected", peerID)
			return
		}

		log.Printf("Received from %s: %+v", peerID, msg)

		// For now, relay normal messages to other peers.
		if msg.Type == "message" {
			s.broadcast(sessionID, peerID, Message{
				Type:   "message",
				PeerID: peerID,
				Data:   msg.Data,
			})
		}
	}
}

func (s *Server) broadcast(sessionID, senderID string, msg Message) {
	currentSession, exists := s.sessions.Get(sessionID)
	if !exists {
		return
	}

	for peerID, p := range currentSession.Peers {
		if peerID == senderID {
			continue
		}

		s.sendMessage(p, msg)
	}
}

func (s *Server) sendMessage(p *peer.Peer, msg Message) {
	p.WriteLock.Lock()
	defer p.WriteLock.Unlock()

	if err := p.Conn.WriteJSON(msg); err != nil {
		log.Printf("Failed to send message to peer %s: %v", p.ID, err)
	}
}

func generatePeerID() string {
	return uuid.NewString()
}