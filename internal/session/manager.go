package session

import (
	"sync"

	"github.com/Swaraj-Singh-30/SlingShare/internal/peer"
)

type Session struct {
	ID    string
	Peers map[string]*peer.Peer
}

type Manager struct {
	sessions map[string]*Session
	mu       sync.RWMutex
}

func NewManager() *Manager {
	return &Manager{
		sessions: make(map[string]*Session),
	}
}

func (m *Manager) Create(id string) *Session {
	m.mu.Lock()
	defer m.mu.Unlock()

	session := &Session{
		ID:    id,
		Peers: make(map[string]*peer.Peer),
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

func (m *Manager) AddPeer(sessionID string, p *peer.Peer) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	session, exists := m.sessions[sessionID]
	if !exists {
		return false
	}

	session.Peers[p.ID] = p

	return true
}

func (m *Manager) RemovePeer(sessionID, peerID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	session, exists := m.sessions[sessionID]
	if !exists {
		return
	}

	delete(session.Peers, peerID)

	if len(session.Peers) == 0 {
		delete(m.sessions, sessionID)
	}
}