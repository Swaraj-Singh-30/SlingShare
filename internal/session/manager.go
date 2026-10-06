package session

import (
	"errors"
	"sync"
	"time"

	"github.com/Swaraj-Singh-30/SlingShare/internal/peer"
)

var (
	ErrSessionNotFound = errors.New("session not found")
	ErrSessionFull     = errors.New("session is full")
)

const (
	DefaultMaxPeersPerSession = 2
	SessionIdleTimeout        = 2 * time.Hour
)

type Session struct {
	ID        string                `json:"id"`
	CreatedAt time.Time             `json:"createdAt"`
	Peers     map[string]*peer.Peer `json:"peers"`
	mu        sync.RWMutex          `json:"-"`
}

func (s *Session) PeerCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.Peers)
}

func (s *Session) GetPeers() []*peer.Peer {
	s.mu.RLock()
	defer s.mu.RUnlock()
	peers := make([]*peer.Peer, 0, len(s.Peers))
	for _, p := range s.Peers {
		peers = append(peers, p)
	}
	return peers
}

func (s *Session) GetPeer(peerID string) (*peer.Peer, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	p, ok := s.Peers[peerID]
	return p, ok
}

type Manager struct {
	sessions map[string]*Session
	maxPeers int
	mu       sync.RWMutex
}

func NewManager(maxPeers int) *Manager {
	if maxPeers <= 0 {
		maxPeers = DefaultMaxPeersPerSession
	}
	m := &Manager{
		sessions: make(map[string]*Session),
		maxPeers: maxPeers,
	}

	// Background routine for cleaning up expired sessions
	go m.cleanupLoop()

	return m
}

func (m *Manager) Create(id string) *Session {
	m.mu.Lock()
	defer m.mu.Unlock()

	session := &Session{
		ID:        id,
		CreatedAt: time.Now(),
		Peers:     make(map[string]*peer.Peer),
	}

	m.sessions[id] = session
	return session
}

func (m *Manager) Get(id string) (*Session, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	session, exists := m.sessions[id]
	return session, exists
}

func (m *Manager) Delete(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	delete(m.sessions, id)
}

func (m *Manager) AddPeer(sessionID string, p *peer.Peer) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	session, exists := m.sessions[sessionID]
	if !exists {
		return ErrSessionNotFound
	}

	session.mu.Lock()
	defer session.mu.Unlock()

	if len(session.Peers) >= m.maxPeers {
		return ErrSessionFull
	}

	session.Peers[p.ID] = p
	return nil
}

func (m *Manager) RemovePeer(sessionID, peerID string) (*peer.Peer, int) {
	m.mu.Lock()
	defer m.mu.Unlock()

	session, exists := m.sessions[sessionID]
	if !exists {
		return nil, 0
	}

	session.mu.Lock()
	p, found := session.Peers[peerID]
	if found {
		delete(session.Peers, peerID)
	}
	remaining := len(session.Peers)
	session.mu.Unlock()

	if remaining == 0 {
		delete(m.sessions, sessionID)
	}

	return p, remaining
}

func (m *Manager) cleanupLoop() {
	ticker := time.NewTicker(15 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		m.cleanupExpired()
	}
}

func (m *Manager) cleanupExpired() {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now()
	for id, s := range m.sessions {
		if now.Sub(s.CreatedAt) > SessionIdleTimeout {
			delete(m.sessions, id)
		}
	}
}