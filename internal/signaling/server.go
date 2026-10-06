package signaling

import (
	"crypto/rand"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/Swaraj-Singh-30/SlingShare/internal/peer"
	"github.com/Swaraj-Singh-30/SlingShare/internal/session"
	"github.com/gorilla/websocket"
)

const (
	roomCodeLength = 6
	maxMessageSize = 65536 // 64 KB max signaling message limit
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
)

type Server struct {
	upgrader websocket.Upgrader
	manager  *session.Manager
}

func NewServer() *Server {
	return &Server{
		upgrader: websocket.Upgrader{
			ReadBufferSize:  4096,
			WriteBufferSize: 4096,
			CheckOrigin: func(r *http.Request) bool {
				return true // Allows pairing from different local hostnames / IPs
			},
		},
		manager: session.NewManager(session.DefaultMaxPeersPerSession),
	}
}

func (s *Server) GetManager() *session.Manager {
	return s.manager
}

func (s *Server) GetIceServers() []IceServer {
	var servers []IceServer

	// STUN servers
	stunEnv := os.Getenv("STUN_SERVERS")
	if stunEnv == "" {
		stunEnv = "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302"
	}
	stunUrls := strings.Split(stunEnv, ",")
	var cleanStun []string
	for _, u := range stunUrls {
		trimmed := strings.TrimSpace(u)
		if trimmed != "" {
			cleanStun = append(cleanStun, trimmed)
		}
	}
	if len(cleanStun) > 0 {
		servers = append(servers, IceServer{URLs: cleanStun})
	}

	// TURN server (optional)
	turnServer := strings.TrimSpace(os.Getenv("TURN_SERVER"))
	if turnServer != "" {
		servers = append(servers, IceServer{
			URLs:       []string{turnServer},
			Username:   strings.TrimSpace(os.Getenv("TURN_USERNAME")),
			Credential: strings.TrimSpace(os.Getenv("TURN_CREDENTIAL")),
		})
	}

	return servers
}

func (s *Server) HandleConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"iceServers": s.GetIceServers(),
		"version":    "1.0.0",
	})
}

func (s *Server) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("[signaling] WebSocket upgrade failed:", err)
		return
	}

	conn.SetReadLimit(maxMessageSize)
	_ = conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		_ = conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	var currentSessionID string
	var currentPeer *peer.Peer

	// Ping ticker for keepalive
	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()

	// Done channel for cleanup
	done := make(chan struct{})

	go func() {
		for {
			select {
			case <-ticker.C:
				if currentPeer != nil {
					if err := currentPeer.SendMessage(websocket.PingMessage, []byte{}); err != nil {
						return
					}
				} else {
					_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
					if err := conn.WriteMessage(websocket.PingMessage, []byte{}); err != nil {
						return
					}
				}
			case <-done:
				return
			}
		}
	}()

	defer func() {
		close(done)
		if currentSessionID != "" && currentPeer != nil {
			s.handlePeerDisconnect(currentSessionID, currentPeer.ID)
		}
		_ = conn.Close()
	}()

	for {
		_, rawMessage, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("[signaling] Peer read error: %v", err)
			}
			return
		}

		var msg Message
		if err := json.Unmarshal(rawMessage, &msg); err != nil {
			log.Printf("[signaling] Invalid JSON received from client: %v", err)
			continue
		}

		switch msg.Type {

		case "create-session":
			if currentSessionID != "" {
				continue
			}

			roomCode := s.generateUniqueRoomCode()
			s.manager.Create(roomCode)

			peerID := s.generatePeerID()
			currentPeer = peer.New(peerID, conn, msg.DeviceName, msg.DeviceType)

			if err := s.manager.AddPeer(roomCode, currentPeer); err != nil {
				_ = currentPeer.SendJSON(Message{
					Type:  "error",
					Error: "Failed to initialize session",
				})
				return
			}

			currentSessionID = roomCode

			iceServers := s.GetIceServers()
			_ = currentPeer.SendJSON(Message{
				Type:       "session-created",
				SessionID:  roomCode,
				PeerID:     peerID,
				DeviceName: currentPeer.DeviceName,
				DeviceType: currentPeer.DeviceType,
				IceServers: iceServers,
			})

			log.Printf("[signaling] Session created: %s by peer %s (%s)", roomCode, peerID, currentPeer.DeviceName)

		case "join-session":
			if currentSessionID != "" {
				continue
			}

			code := strings.ToUpper(strings.TrimSpace(msg.SessionID))
			if code == "" {
				s.sendErrorDirect(conn, "Session code is required")
				continue
			}

			sess, exists := s.manager.Get(code)
			if !exists {
				s.sendErrorDirect(conn, "Session not found or has expired")
				continue
			}

			peerID := s.generatePeerID()
			currentPeer = peer.New(peerID, conn, msg.DeviceName, msg.DeviceType)

			// Get existing peers before adding the new one
			existingPeers := sess.GetPeers()
			var existingPeerInfos []PeerInfo
			for _, ep := range existingPeers {
				existingPeerInfos = append(existingPeerInfos, PeerInfo{
					ID:         ep.ID,
					DeviceName: ep.DeviceName,
					DeviceType: ep.DeviceType,
				})
			}

			if err := s.manager.AddPeer(code, currentPeer); err != nil {
				s.sendErrorDirect(conn, err.Error())
				currentPeer = nil
				continue
			}

			currentSessionID = code
			iceServers := s.GetIceServers()

			// Send session-joined to the joining peer with existing peers info
			_ = currentPeer.SendJSON(Message{
				Type:       "session-joined",
				SessionID:  code,
				PeerID:     peerID,
				DeviceName: currentPeer.DeviceName,
				DeviceType: currentPeer.DeviceType,
				Peers:      existingPeerInfos,
				IceServers: iceServers,
			})

			log.Printf("[signaling] Peer %s (%s) joined session %s", peerID, currentPeer.DeviceName, code)

			// Notify existing peers that a new peer joined
			for _, ep := range existingPeers {
				_ = ep.SendJSON(Message{
					Type:       "peer-joined",
					SessionID:  code,
					PeerID:     peerID,
					DeviceName: currentPeer.DeviceName,
					DeviceType: currentPeer.DeviceType,
				})
			}

		case "offer", "answer", "ice-candidate":
			if currentSessionID == "" || currentPeer == nil {
				continue
			}

			sess, exists := s.manager.Get(currentSessionID)
			if !exists {
				continue
			}

			targetPeer, ok := sess.GetPeer(msg.TargetID)
			if !ok {
				log.Printf("[signaling] Target peer %s not found in session %s", msg.TargetID, currentSessionID)
				continue
			}

			// Forward message with sender PeerID attached
			msg.PeerID = currentPeer.ID
			msg.SessionID = currentSessionID
			_ = targetPeer.SendJSON(msg)

		case "leave-session":
			if currentSessionID != "" && currentPeer != nil {
				s.handlePeerDisconnect(currentSessionID, currentPeer.ID)
				currentSessionID = ""
				currentPeer = nil
			}
		}
	}
}

func (s *Server) handlePeerDisconnect(sessionID, peerID string) {
	_, remaining := s.manager.RemovePeer(sessionID, peerID)
	log.Printf("[signaling] Peer %s left session %s (%d peers remaining)", peerID, sessionID, remaining)

	if remaining > 0 {
		if sess, exists := s.manager.Get(sessionID); exists {
			for _, p := range sess.GetPeers() {
				_ = p.SendJSON(Message{
					Type:      "peer-left",
					SessionID: sessionID,
					PeerID:    peerID,
				})
			}
		}
	}
}

func (s *Server) sendErrorDirect(conn *websocket.Conn, message string) {
	data, _ := json.Marshal(Message{
		Type:  "error",
		Error: message,
	})
	_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
	_ = conn.WriteMessage(websocket.TextMessage, data)
}

func (s *Server) generateUniqueRoomCode() string {
	for {
		code := s.generateRoomCode()
		if _, exists := s.manager.Get(code); !exists {
			return code
		}
	}
}

func (s *Server) generateRoomCode() string {
	const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	randomBytes := make([]byte, roomCodeLength)
	_, err := rand.Read(randomBytes)
	if err != nil {
		log.Fatalf("Failed to generate random bytes: %v", err)
	}

	result := make([]byte, roomCodeLength)
	for i := 0; i < roomCodeLength; i++ {
		result[i] = characters[int(randomBytes[i])%len(characters)]
	}
	return string(result)
}

func (s *Server) generatePeerID() string {
	const characters = "abcdefghjkmnpqrstuvwxyz23456789"
	randomBytes := make([]byte, 8)
	_, err := rand.Read(randomBytes)
	if err != nil {
		log.Fatalf("Failed to generate random bytes: %v", err)
	}

	result := make([]byte, 8)
	for i := 0; i < 8; i++ {
		result[i] = characters[int(randomBytes[i])%len(characters)]
	}
	return string(result)
}
