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

	var join Message

	if err := conn.ReadJSON(&join); err != nil {
		log.Println("Failed to read join message:", err)
		return
	}

	if join.Type != "join" || join.SessionID == "" {
		log.Println("Invalid join message")
		return
	}

	sessionID := join.SessionID

	if _, exists := s.sessions.Get(sessionID); !exists {
		s.sessions.Create(sessionID)
	}

	peerID := uuid.NewString()
	p := peer.New(peerID, conn)

	if !s.sessions.AddPeer(sessionID, p) {
		log.Println("Failed to add peer")
		return
	}

	log.Printf("Peer %s joined session %s", peerID, sessionID)

	s.sendMessage(p, Message{
		Type:      "joined",
		SessionID: sessionID,
		PeerID:    peerID,
	})

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

		switch msg.Type {
		case "offer", "answer", "ice-candidate":
			s.routeSignalingMessage(sessionID, peerID, msg)

		case "message":
			s.broadcast(sessionID, peerID, Message{
				Type:   "message",
				PeerID: peerID,
				Data:   msg.Data,
			})

		default:
			log.Printf("Unknown message type from %s: %s", peerID, msg.Type)
		}
	}
}

func (s *Server) routeSignalingMessage(
	sessionID string,
	senderID string,
	msg Message,
) {
	if msg.TargetID == "" {
		return
	}

	currentSession, exists := s.sessions.Get(sessionID)
	if !exists {
		return
	}

	target, exists := currentSession.Peers[msg.TargetID]
	if !exists {
		log.Printf(
			"Target peer %s not found in session %s",
			msg.TargetID,
			sessionID,
		)
		return
	}

	msg.PeerID = senderID

	s.sendMessage(target, msg)
}

func (s *Server) broadcast(
	sessionID string,
	senderID string,
	msg Message,
) {
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
		log.Printf(
			"Failed to send message to peer %s: %v",
			p.ID,
			err,
		)
	}
}