SHELL := /bin/bash
.DEFAULT_GOAL := help

.PHONY: help setup start dev up down logs ps db reset-db dashboard test typecheck smoke screenshots seed-demos demo

help: ## Show this help
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-10s %s\n", $$1, $$2}'

.env:
	cp .env.example .env
	@echo "Created .env from .env.example — change the secrets before sharing this machine."

setup: .env ## Install dependencies and create .env if missing
	npm install

start: up ## Docker stack (gateway :4000 serves the widget) + dashboard :5173 + Orchard Store demo :5174 and its backend :4101
	@trap 'trap - INT TERM EXIT; kill 0' INT TERM EXIT; \
	npm run dev -w apps/admin-dashboard & \
	npm run server -w demos/iphone-store & \
	npm run dev -w demos/iphone-store & \
	wait

dev: .env db ## Hot reload: postgres in Docker; tenant-auth, kb-service, chat-service, gateway and dashboard, widget (rebuilt on change) and Orchard Store demo + backend run locally (Ctrl-C stops all)
	docker compose stop gateway tenant-auth kb-service chat-service
	npm run build -w apps/widget
	@trap 'trap - INT TERM EXIT; kill 0' INT TERM EXIT; \
	PORT=4001 npm run dev -w services/tenant-auth & \
	PORT=4002 npm run dev -w services/kb-service & \
	PORT=4003 npm run dev -w services/chat-service & \
	PORT=4000 npm run dev -w services/gateway & \
	npm run dev -w apps/admin-dashboard & \
	npm run dev -w apps/widget & \
	npm run server -w demos/iphone-store & \
	npm run dev -w demos/iphone-store & \
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
	  read -r -p "This permanently deletes all Helpix data (tenants, admins, KB documents and files, test DB). Type 'yes' to continue: " ans; \
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

smoke: ## End-to-end smoke test through the gateway: tenants, knowledge base, agent, widget (needs the stack running)
	npm run smoke

screenshots: ## Capture README screenshots of the dashboard (needs the stack + dashboard running; uses Google Chrome)
	npm run screenshots

# tenant-auth calls the Orchard backend on the host: from Docker that is host.docker.internal, from `make dev` localhost.
# The mode is read from whether the tenant-auth container is running; set DEMO_ORDER_API_URL to override.
seed-demos: .env ## Create or refresh the demo shops (KB, agent, widget key, shop sign-in key, order API) through the gateway (needs the stack and the demo backend running)
	@url="$${DEMO_ORDER_API_URL:-}"; \
	if [ -z "$$url" ]; then \
	  if [ -n "$$(docker compose ps --status running -q tenant-auth 2>/dev/null)" ]; then url=http://host.docker.internal:4101; \
	  else url=http://localhost:4101; fi; \
	fi; \
	echo "seed-demos: tenant-auth will call the Orchard order API at $$url"; \
	DEMO_ORDER_API_URL="$$url" node --env-file=.env scripts/seed-demos.mjs

demo: ## Run the Orchard Store demo: storefront http://localhost:5174 and its backend :4101 (Ctrl-C stops both)
	@trap 'trap - INT TERM EXIT; kill 0' INT TERM EXIT; \
	npm run server -w demos/iphone-store & \
	npm run dev -w demos/iphone-store & \
	wait
