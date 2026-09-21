package main

import (
	"log"
	"net/http"
)

func main() {
	mux := http.NewServeMux()

	//Health check (cause why not)

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request){
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("SlingShare server is running"))
	})

	// Serve frontend
	mux.Handle("/", http.FileServer(http.Dir("./web")))

	server := &http.Server{
		Addr: ":8080",
		Handler: mux,
	}

	log.Println("SlingShare server is running at http://localhost:8080")

	if err := server.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}