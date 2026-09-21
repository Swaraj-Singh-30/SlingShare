package main

import (
	"log"
	"net/http"

	"github.com/Swaraj-Singh-30/SlingShare/internal/signaling"
)

func main() {
	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("SlingShare server is running"))
	})

	signalingServer := signaling.NewServer()
	mux.HandleFunc("/ws", signalingServer.HandleWebSocket)

	mux.Handle("/", http.FileServer(http.Dir("./web")))

	server := &http.Server{
		Addr:    ":8080",
		Handler: mux,
	}

	log.Println("SlingShare server is running at http://localhost:8080")

	if err := server.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}