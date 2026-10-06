.PHONY: dev build test clean help

# Default target
all: build

help:
	@echo "SlingShare Development & Production Commands:"
	@echo "  make dev      - Build frontend and start the SlingShare server"
	@echo "  make build    - Compile frontend (Astro) and backend (Go binary)"
	@echo "  make test     - Run Go backend tests and end-to-end integration tests"
	@echo "  make clean    - Remove build artifacts and binaries"

dev: build
	@echo "==> Starting SlingShare server on http://localhost:10000..."
	PORT=10000 ./bin/server

build:
	@echo "==> Building web frontend (Astro)..."
	cd web && npm run build
	@echo "==> Compiling backend server (Go)..."
	go build -o ./bin/server ./cmd/server
	@echo "==> Build complete! Binary located at ./bin/server"

test:
	@echo "==> Running Go backend unit tests..."
	go test -v ./...
	@echo "==> Running Playwright E2E tests..."
	cd web && node e2e-test.mjs

clean:
	@echo "==> Cleaning artifacts..."
	rm -rf ./bin ./web/dist ./web/node_modules/.astro
