# Initial project structure:
 
Go
├── HTTP server
├── WebSocket signalling
├── Session management
└── Static content / SEO pages

Browser
├── HTML
├── CSS
├── Vanilla JavaScript
├── WebRTC
├── Web Crypto API
└── QR generation/scanning

:
dropivia/
├── cmd/
│   └── server/
│       └── main.go
├── internal/
│   ├── signaling/
│   ├── session/
│   └── peer/
├── web/
│   ├── index.html
│   ├── app.js
│   └── style.css
├── go.mod
└── README.md
