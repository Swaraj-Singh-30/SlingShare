package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/Swaraj-Singh-30/SlingShare/internal/signaling"
)

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && signaling.IsOriginAllowed(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("Access-Control-Max-Age", "86400")
		}

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "10000"
	}
	if port[0] == ':' {
		port = port[1:]
	}
	addr := "0.0.0.0:" + port

	mux := http.NewServeMux()
	signalingServer := signaling.NewServer()

	// Health check endpoint
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"status":  "healthy",
			"service": "SlingShare",
		})
	})

	// Public configuration endpoint (STUN/TURN)
	mux.HandleFunc("/api/config", signalingServer.HandleConfig)

	// WebRTC WebSocket signaling endpoint
	mux.HandleFunc("/ws", signalingServer.HandleWebSocket)

	// Static file serving: prefer web/dist (built Astro site)
	distDir := "./web/dist"
	if _, err := os.Stat(distDir); os.IsNotExist(err) {
		// Fallback for dev if web/dist not built yet
		distDir = "./web"
	}

	fileServer := http.FileServer(http.Dir(distDir))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Clean and verify request path
		path := filepath.Clean(r.URL.Path)
		fullPath := filepath.Join(distDir, path)

		// Check if exact file exists
		if fi, err := os.Stat(fullPath); err == nil && !fi.IsDir() {
			fileServer.ServeHTTP(w, r)
			return
		}

		// Check if directory has index.html
		if fi, err := os.Stat(filepath.Join(fullPath, "index.html")); err == nil && !fi.IsDir() {
			fileServer.ServeHTTP(w, r)
			return
		}

		// For routes without file extension (like /app or /security), check if path.html exists
		htmlPath := fullPath + ".html"
		if fi, err := os.Stat(htmlPath); err == nil && !fi.IsDir() {
			http.ServeFile(w, r, htmlPath)
			return
		}

		// Otherwise serve standard fileServer (or 404)
		fileServer.ServeHTTP(w, r)
	})

	server := &http.Server{
		Addr:         addr,
		Handler:      corsMiddleware(mux),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Graceful shutdown handling
	idleConnsClosed := make(chan struct{})
	go func() {
		sigint := make(chan os.Signal, 1)
		signal.Notify(sigint, os.Interrupt, syscall.SIGTERM)
		<-sigint

		log.Println("[server] Shutting down server gracefully...")
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		if err := server.Shutdown(ctx); err != nil {
			log.Printf("[server] HTTP server Shutdown error: %v", err)
		}
		close(idleConnsClosed)
	}()

	log.Printf("[server] SlingShare server listening at http://%s (serving static from %s)", addr, distDir)

	if err := server.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatalf("[server] HTTP server ListenAndServe error: %v", err)
	}

	<-idleConnsClosed
	log.Println("[server] Server stopped.")
}