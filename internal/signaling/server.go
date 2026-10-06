package signaling

import (
	"crypto/rand"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
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

type DiscoveredDevice struct {
	DeviceID   string
	DeviceName string
	DeviceType string
	Status     string
	Conn       *websocket.Conn
	WriteLock  *sync.Mutex
	LastSeen   time.Time
}

type Server struct {
	upgrader websocket.Upgrader
	manager  *session.Manager

	mu        sync.RWMutex
	devices   map[string]*DiscoveredDevice     // keyed by DeviceID
	connMap   map[*websocket.Conn]string       // maps Conn to DeviceID
	connLocks map[*websocket.Conn]*sync.Mutex // ensures thread-safe writes per connection
}

func NewServer() *Server {
	s := &Server{
		upgrader: websocket.Upgrader{
			ReadBufferSize:  4096,
			WriteBufferSize: 4096,
			CheckOrigin: func(r *http.Request) bool {
				return true // Allows pairing from different local hostnames / IPs
			},
		},
		manager:   session.NewManager(session.DefaultMaxPeersPerSession),
		devices:   make(map[string]*DiscoveredDevice),
		connMap:   make(map[*websocket.Conn]string),
		connLocks: make(map[*websocket.Conn]*sync.Mutex),
	}

	go s.discoveryCleanupLoop()
	return s
}

func (s *Server) GetManager() *session.Manager {
	return s.manager
}

func (s *Server) getConnLock(conn *websocket.Conn) *sync.Mutex {
	s.mu.Lock()
	defer s.mu.Unlock()
	lock, exists := s.connLocks[conn]
	if !exists {
		lock = &sync.Mutex{}
		s.connLocks[conn] = lock
	}
	return lock
}

func (s *Server) writeJSONSafe(conn *websocket.Conn, msg interface{}) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	lock := s.getConnLock(conn)
	lock.Lock()
	defer lock.Unlock()

	_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
	return conn.WriteMessage(websocket.TextMessage, data)
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
	var currentDeviceID string

	// Ping ticker for keepalive
	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()

	// Done channel for cleanup
	done := make(chan struct{})

	go func() {
		for {
			select {
			case <-ticker.C:
				lock := s.getConnLock(conn)
				lock.Lock()
				_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
				err := conn.WriteMessage(websocket.PingMessage, []byte{})
				lock.Unlock()
				if err != nil {
					return
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
		if currentDeviceID != "" {
			s.removeDiscoveredDevice(conn, currentDeviceID)
		}
		s.mu.Lock()
		delete(s.connLocks, conn)
		delete(s.connMap, conn)
		s.mu.Unlock()
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

		// ================= Discovery & Presence =================
		case "register-presence":
			devID := strings.TrimSpace(msg.DeviceID)
			if devID == "" || len(devID) > 64 {
				continue
			}

			devName := sanitizeDeviceName(msg.DeviceName)
			devType := sanitizeDeviceType(msg.DeviceType)

			currentDeviceID = devID
			s.registerDiscoveredDevice(conn, devID, devName, devType)

		case "update-presence":
			if currentDeviceID == "" {
				continue
			}
			devName := sanitizeDeviceName(msg.DeviceName)
			devType := sanitizeDeviceType(msg.DeviceType)
			s.updateDiscoveredDevice(currentDeviceID, devName, devType)

		case "request-pairing":
			// A discovered peer was clicked on the Radar
			targetDevID := strings.TrimSpace(msg.TargetDeviceID)
			log.Printf("[signaling] Received request-pairing from %s to %s", currentDeviceID, targetDevID)
			if targetDevID == "" || currentDeviceID == "" {
				continue
			}

			if currentSessionID != "" && currentPeer != nil {
				s.handlePeerDisconnect(currentSessionID, currentPeer.ID)
				currentSessionID = ""
				currentPeer = nil
			}

			// Generate a session room code for this pair
			roomCode := s.generateUniqueRoomCode()
			s.manager.Create(roomCode)
			log.Printf("[signaling] Created session %s for pairing %s -> %s", roomCode, currentDeviceID, targetDevID)

			// Notify target device with invitation
			s.forwardPairingInvitation(targetDevID, currentDeviceID, msg.DeviceName, msg.DeviceType, roomCode)

			// Reply to sender with room code
			_ = s.writeJSONSafe(conn, Message{
				Type:           "pairing-initiated",
				SessionID:      roomCode,
				TargetDeviceID: targetDevID,
			})

		// ================= WebRTC Room Sessions =================
		case "create-session":
			if currentSessionID != "" {
				if currentPeer != nil {
					s.handlePeerDisconnect(currentSessionID, currentPeer.ID)
				}
				currentSessionID = ""
				currentPeer = nil
			}

			roomCode := s.generateUniqueRoomCode()
			s.manager.Create(roomCode)

			peerID := s.generatePeerID()
			currentPeer = peer.New(peerID, conn, sanitizeDeviceName(msg.DeviceName), sanitizeDeviceType(msg.DeviceType))

			if err := s.manager.AddPeer(roomCode, currentPeer); err != nil {
				_ = s.writeJSONSafe(conn, Message{
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
			code := strings.ToUpper(strings.TrimSpace(msg.SessionID))
			if code == "" {
				_ = s.writeJSONSafe(conn, Message{Type: "error", Error: "Session code is required"})
				continue
			}

			if currentSessionID != "" {
				if currentSessionID == code {
					// Already in this session
					continue
				}
				// Cleanly leave previous session before joining the new one
				if currentPeer != nil {
					s.handlePeerDisconnect(currentSessionID, currentPeer.ID)
				}
				currentSessionID = ""
				currentPeer = nil
			}

			sess, exists := s.manager.Get(code)
			if !exists {
				_ = s.writeJSONSafe(conn, Message{Type: "error", Error: "Session not found or has expired"})
				continue
			}

			peerID := s.generatePeerID()
			currentPeer = peer.New(peerID, conn, sanitizeDeviceName(msg.DeviceName), sanitizeDeviceType(msg.DeviceType))

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
				_ = s.writeJSONSafe(conn, Message{Type: "error", Error: err.Error()})
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

// Discovery Helpers
func (s *Server) registerDiscoveredDevice(conn *websocket.Conn, devID, devName, devType string) {
	s.mu.Lock()
	lock, hasLock := s.connLocks[conn]
	if !hasLock {
		lock = &sync.Mutex{}
		s.connLocks[conn] = lock
	}

	device := &DiscoveredDevice{
		DeviceID:   devID,
		DeviceName: devName,
		DeviceType: devType,
		Status:     "available",
		Conn:       conn,
		WriteLock:  lock,
		LastSeen:   time.Now(),
	}

	s.devices[devID] = device
	s.connMap[conn] = devID

	// Prepare list of other active devices
	var otherDevices []DiscoveredInfo
	for id, d := range s.devices {
		if id != devID {
			otherDevices = append(otherDevices, DiscoveredInfo{
				DeviceID:   d.DeviceID,
				DeviceName: d.DeviceName,
				DeviceType: d.DeviceType,
				Status:     d.Status,
			})
		}
	}
	s.mu.Unlock()

	// Send presence-list to caller
	_ = s.writeJSONSafe(conn, Message{
		Type:    "presence-list",
		Devices: otherDevices,
	})

	// Broadcast device-joined to all other devices
	s.broadcastToDiscoverable(devID, Message{
		Type: "device-joined",
		Device: &DiscoveredInfo{
			DeviceID:   devID,
			DeviceName: devName,
			DeviceType: devType,
			Status:     "available",
		},
	})
	log.Printf("[discovery] Device registered: %s (%s, %s)", devName, devType, devID)
}

func (s *Server) updateDiscoveredDevice(devID, devName, devType string) {
	s.mu.Lock()
	device, exists := s.devices[devID]
	if exists {
		device.DeviceName = devName
		device.DeviceType = devType
		device.LastSeen = time.Now()
	}
	s.mu.Unlock()

	if exists {
		s.broadcastToDiscoverable(devID, Message{
			Type: "device-updated",
			Device: &DiscoveredInfo{
				DeviceID:   devID,
				DeviceName: devName,
				DeviceType: devType,
				Status:     "available",
			},
		})
	}
}

func (s *Server) removeDiscoveredDevice(conn *websocket.Conn, devID string) {
	s.mu.Lock()
	delete(s.devices, devID)
	delete(s.connMap, conn)
	s.mu.Unlock()

	s.broadcastToDiscoverable(devID, Message{
		Type:     "device-left",
		DeviceID: devID,
	})
	log.Printf("[discovery] Device removed: %s", devID)
}

func (s *Server) forwardPairingInvitation(targetDevID, fromDevID, fromName, fromType, roomCode string) {
	s.mu.RLock()
	targetDevice, exists := s.devices[targetDevID]
	var targetConn *websocket.Conn
	if exists {
		targetConn = targetDevice.Conn
	}
	s.mu.RUnlock()

	if targetConn != nil {
		_ = s.writeJSONSafe(targetConn, Message{
			Type:           "pairing-invitation",
			SessionID:      roomCode,
			TargetDeviceID: fromDevID,
			DeviceName:     fromName,
			DeviceType:     fromType,
		})
	}
}

func (s *Server) broadcastToDiscoverable(excludeDevID string, msg Message) {
	var targetConns []*websocket.Conn
	s.mu.RLock()
	for id, d := range s.devices {
		if id != excludeDevID && d.Conn != nil {
			targetConns = append(targetConns, d.Conn)
		}
	}
	s.mu.RUnlock()

	for _, conn := range targetConns {
		_ = s.writeJSONSafe(conn, msg)
	}
}

func (s *Server) discoveryCleanupLoop() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		now := time.Now()
		var expiredIDs []string

		s.mu.Lock()
		for id, d := range s.devices {
			if now.Sub(d.LastSeen) > 5*time.Minute {
				expiredIDs = append(expiredIDs, id)
			}
		}
		for _, id := range expiredIDs {
			delete(s.devices, id)
		}
		s.mu.Unlock()

		for _, id := range expiredIDs {
			s.broadcastToDiscoverable(id, Message{
				Type:     "device-left",
				DeviceID: id,
			})
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

func sanitizeDeviceName(raw string) string {
	clean := strings.TrimSpace(raw)
	// Strip control characters
	clean = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return -1
		}
		return r
	}, clean)

	if len(clean) == 0 {
		return "Device"
	}
	if len(clean) > 40 {
		return clean[:40]
	}
	return clean
}

func sanitizeDeviceType(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "phone", "tablet", "laptop", "desktop":
		return strings.ToLower(strings.TrimSpace(raw))
	default:
		return "desktop"
	}
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
