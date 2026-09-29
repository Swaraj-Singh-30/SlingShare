package signaling

import (
	"crypto/rand"
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

const (
	roomCodeLength = 6
	maxPeers       = 2
)

type Server struct {
	upgrader websocket.Upgrader

	mu       sync.RWMutex
	sessions map[string]map[*websocket.Conn]string
}

func NewServer() *Server {
	return &Server{
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true
			},
		},
		sessions: make(map[string]map[*websocket.Conn]string),
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

	var sessionID string
	var peerID string

	for {
		_, rawMessage, err := conn.ReadMessage()
		if err != nil {
			if sessionID != "" {
				s.removePeer(sessionID, peerID, conn)
			}

			log.Println("WebSocket connection closed:", err)
			return
		}

		var msg Message

		if err := json.Unmarshal(rawMessage, &msg); err != nil {
			log.Println("Invalid message:", err)
			continue
		}

		switch msg.Type {

		case "create-session":
			if sessionID != "" {
				continue
			}

			sessionID = s.generateRoomCode()
			peerID = s.generatePeerID()

			s.mu.Lock()

			s.sessions[sessionID] = map[*websocket.Conn]string{
				conn: peerID,
			}

			s.mu.Unlock()

			s.sendMessage(conn, Message{
				Type:      "session-created",
				SessionID: sessionID,
				PeerID:    peerID,
			})

			log.Printf(
				"Peer %s created session %s",
				peerID,
				sessionID,
			)

		case "join-session":
			if sessionID != "" {
				continue
			}

			if msg.SessionID == "" {
				s.sendError(conn, "Session code is required")
				continue
			}

			s.mu.Lock()

			peers, exists := s.sessions[msg.SessionID]

			if !exists {
				s.mu.Unlock()
				s.sendError(conn, "Session not found")
				continue
			}

			if len(peers) >= maxPeers {
				s.mu.Unlock()
				s.sendError(conn, "Session is full")
				continue
			}

			sessionID = msg.SessionID
			peerID = s.generatePeerID()

			peers[conn] = peerID

			s.mu.Unlock()

			s.sendMessage(conn, Message{
				Type:      "session-joined",
				SessionID: sessionID,
				PeerID:    peerID,
			})

			log.Printf(
				"Peer %s joined session %s",
				peerID,
				sessionID,
			)

			s.notifyPeerJoined(sessionID, conn, peerID)

		case "offer", "answer", "ice-candidate":
			if sessionID == "" {
				continue
			}

			s.forwardToPeer(
				sessionID,
				msg.TargetID,
				rawMessage,
			)
		}
	}
}

func (s *Server) removePeer(
	sessionID string,
	peerID string,
	conn *websocket.Conn,
) {
	s.mu.Lock()

	peers, exists := s.sessions[sessionID]

	if !exists {
		s.mu.Unlock()
		return
	}

	delete(peers, conn)

	remainingPeers := make([]*websocket.Conn, 0)

	for peerConn := range peers {
		remainingPeers = append(remainingPeers, peerConn)
	}

	if len(peers) == 0 {
		delete(s.sessions, sessionID)
	}

	s.mu.Unlock()

	for _, peerConn := range remainingPeers {
		s.sendMessage(peerConn, Message{
			Type:   "peer-left",
			PeerID: peerID,
		})
	}

	log.Printf(
		"Peer %s left session %s",
		peerID,
		sessionID,
	)
}

func (s *Server) notifyPeerJoined(
	sessionID string,
	newConn *websocket.Conn,
	newPeerID string,
) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	peers := s.sessions[sessionID]

	for conn := range peers {
		if conn == newConn {
			continue
		}

		s.sendMessage(conn, Message{
			Type:   "peer-joined",
			PeerID: newPeerID,
		})
	}
}

func (s *Server) forwardToPeer(
	sessionID string,
	targetID string,
	rawMessage []byte,
) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	peers := s.sessions[sessionID]

	for conn, peerID := range peers {
		if peerID != targetID {
			continue
		}

		err := conn.WriteMessage(
			websocket.TextMessage,
			rawMessage,
		)

		if err != nil {
			log.Println("Failed to forward message:", err)
		}

		return
	}
}

func (s *Server) sendMessage(
	conn *websocket.Conn,
	message Message,
) {
	data, err := json.Marshal(message)

	if err != nil {
		log.Println("Failed to marshal message:", err)
		return
	}

	err = conn.WriteMessage(
		websocket.TextMessage,
		data,
	)

	if err != nil {
		log.Println("WebSocket write failed:", err)
	}
}

func (s *Server) sendError(
	conn *websocket.Conn,
	message string,
) {
	data, err := json.Marshal(message)

	if err != nil {
		log.Println("Failed to marshal error:", err)
		return
	}

	s.sendMessage(conn, Message{
		Type: "error",
		Data: data,
	})
}

func (s *Server) generateRoomCode() string {
	const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

	randomBytes := make([]byte, roomCodeLength)

	_, err := rand.Read(randomBytes)
	if err != nil {
		log.Fatal(err)
	}

	result := make([]byte, roomCodeLength)

	for i := 0; i < roomCodeLength; i++ {
		index := int(randomBytes[i]) % len(characters)
		result[i] = characters[index]
	}

	return string(result)
}

func (s *Server) generatePeerID() string {
	const characters = "abcdefghijklmnopqrstuvwxyz0123456789"

	randomBytes := make([]byte, 8)

	_, err := rand.Read(randomBytes)
	if err != nil {
		log.Fatal(err)
	}

	result := make([]byte, 8)

	for i := 0; i < 8; i++ {
		index := int(randomBytes[i]) % len(characters)
		result[i] = characters[index]
	}

	return string(result)
}
