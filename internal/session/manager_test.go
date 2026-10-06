package session

import (
	"testing"

	"github.com/Swaraj-Singh-30/SlingShare/internal/peer"
)

func TestSessionManager(t *testing.T) {
	mgr := NewManager(2)

	// 1. Create session
	sess := mgr.Create("TEST01")
	if sess == nil || sess.ID != "TEST01" {
		t.Fatalf("expected session ID TEST01, got %v", sess)
	}

	// 2. Add peer 1
	p1 := peer.New("peer-1", nil, "MacBook Pro", "laptop")
	err := mgr.AddPeer("TEST01", p1)
	if err != nil {
		t.Fatalf("failed to add peer 1: %v", err)
	}

	if sess.PeerCount() != 1 {
		t.Fatalf("expected 1 peer, got %d", sess.PeerCount())
	}

	// 3. Add peer 2
	p2 := peer.New("peer-2", nil, "iPhone 15", "phone")
	err = mgr.AddPeer("TEST01", p2)
	if err != nil {
		t.Fatalf("failed to add peer 2: %v", err)
	}

	if sess.PeerCount() != 2 {
		t.Fatalf("expected 2 peers, got %d", sess.PeerCount())
	}

	// 4. Exceed capacity (max 2)
	p3 := peer.New("peer-3", nil, "Windows PC", "desktop")
	err = mgr.AddPeer("TEST01", p3)
	if err != ErrSessionFull {
		t.Fatalf("expected ErrSessionFull, got %v", err)
	}

	// 5. Remove peer 1
	removed, remaining := mgr.RemovePeer("TEST01", "peer-1")
	if removed == nil || removed.ID != "peer-1" {
		t.Fatalf("expected removed peer-1, got %v", removed)
	}
	if remaining != 1 {
		t.Fatalf("expected 1 remaining peer, got %d", remaining)
	}

	// 6. Remove peer 2 (session should auto-delete)
	_, remaining = mgr.RemovePeer("TEST01", "peer-2")
	if remaining != 0 {
		t.Fatalf("expected 0 remaining peers, got %d", remaining)
	}

	_, exists := mgr.Get("TEST01")
	if exists {
		t.Fatalf("expected session TEST01 to be deleted")
	}
}
