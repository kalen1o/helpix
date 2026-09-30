SHELL := /bin/bash
.DEFAULT_GOAL := help

.PHONY: help setup start dev up down logs ps db reset-db dashboard test typecheck smoke

help: ## Show this help
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-10s %s\n", $$1, $$2}'

.env:
	cp .env.example .env
	@echo "Created .env from .env.example — change the secrets before sharing this machine."

setup: .env ## Install dependencies and create .env if missing
	npm install

start: up dashboard ## Docker stack (postgres, tenant-auth, gateway :4000) + dashboard dev server :5173

dev: .env db ## Hot reload: postgres in Docker; tenant-auth, gateway and dashboard run locally (Ctrl-C stops all)
	docker compose stop gateway tenant-auth
	@trap 'trap - INT TERM EXIT; kill 0' INT TERM EXIT; \
	PORT=4001 npm run dev -w services/tenant-auth & \
	PORT=4000 npm run dev -w services/gateway & \
	npm run dev -w apps/admin-dashboard & \
	wait

up: .env ## Start the Docker stack (rebuilds images) and wait until it serves requests
	docker compose up -d --build
	@echo "Waiting for gateway and tenant-auth..."; \
	for i in $$(seq 1 60); do \
	  code=$$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:4000/auth/refresh -H 'content-type: application/json' -d '{}'); \
	  if [ "$$code" != "000" ] && [ "$$code" != "502" ]; then echo "Ready: http://localhost:4000"; exit 0; fi; \
	  sleep 1; \
	done; \
	echo "Stack not ready after 60s — run 'make logs'"; exit 1

down: ## Stop the Docker stack (keeps the database volume)
	docker compose down

logs: ## Follow Docker stack logs
	docker compose logs -f

ps: ## Show Docker stack status
	docker compose ps

db: ## Start only Postgres (host port 5433)
	docker compose up -d --wait postgres

reset-db: .env ## Delete ALL data, recreate the databases and reseed the super-admin from .env (asks first; FORCE=1 skips)
	@if [ "$(FORCE)" != "1" ]; then \
	  read -r -p "This permanently deletes all Helpix data (tenants, admins, test DB). Type 'yes' to continue: " ans; \
	  [ "$$ans" = "yes" ] || { echo "Aborted."; exit 1; }; \
	fi
	docker compose down -v
	$(MAKE) up

dashboard: ## Run the admin dashboard dev server (http://localhost:5173)
	npm run dev -w apps/admin-dashboard

test: db ## Run all workspace tests
	npm test

typecheck: ## Typecheck all workspaces
	npm run typecheck

smoke: ## End-to-end smoke test through the gateway (needs the stack running)
	npm run smoke
