#!/bin/bash
# AgentCore OS — Deploy Temporal + Node-RED on VPS
# Ejecuta esto en el servidor: ssh root@72.62.29.17 "bash -s" < deploy-vps.sh
# O pega cada bloque en la terminal web de Hostinger

set -e

echo "=== AgentCore OS — Deploy Phase 1 ==="

# --- TEMPORAL ---
echo "[1/4] Creando directorio para Temporal..."
mkdir -p /opt/agentcore/temporal

cat > /opt/agentcore/temporal/docker-compose.yml << 'YAML'
version: "3.5"

services:
  temporal-postgresql:
    container_name: temporal-postgresql
    image: postgres:13
    environment:
      POSTGRES_PASSWORD: temporal_secret_2026
      POSTGRES_USER: temporal
      POSTGRES_DB: temporal
    networks:
      - temporal-network
    volumes:
      - temporal-db:/var/lib/postgresql/data
    restart: unless-stopped

  temporal:
    container_name: temporal
    image: temporalio/auto-setup:1.25
    depends_on:
      - temporal-postgresql
    environment:
      - DB=postgresql
      - DB_PORT=5432
      - POSTGRES_USER=temporal
      - POSTGRES_PWD=temporal_secret_2026
      - POSTGRES_SEEDS=temporal-postgresql
    networks:
      - temporal-network
    ports:
      - 7233:7233
    restart: unless-stopped

  temporal-ui:
    container_name: temporal-ui
    image: temporalio/ui:2.31.2
    depends_on:
      - temporal
    environment:
      - TEMPORAL_ADDRESS=temporal:7233
      - TEMPORAL_CORS_ORIGINS=https://temporal.agentflowing.com
    networks:
      - temporal-network
    ports:
      - 8081:8080
    restart: unless-stopped

networks:
  temporal-network:
    driver: bridge

volumes:
  temporal-db:
YAML

echo "[2/4] Levantando Temporal..."
cd /opt/agentcore/temporal
docker compose up -d

# --- NODE-RED ---
echo "[3/4] Creando directorio para Node-RED..."
mkdir -p /opt/agentcore/nodered

cat > /opt/agentcore/nodered/docker-compose.yml << 'YAML'
version: "3.5"

services:
  nodered:
    container_name: nodered
    image: nodered/node-red:latest
    ports:
      - 1880:1880
    volumes:
      - nodered-data:/data
    environment:
      - NODE_RED_ENABLE_SAFE_MODE=false
      - TZ=Europe/Madrid
    restart: unless-stopped

volumes:
  nodered-data:
YAML

echo "[4/4] Levantando Node-RED..."
cd /opt/agentcore/nodered
docker compose up -d

# --- VERIFICAR ---
echo ""
echo "=== Verificando contenedores ==="
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo ""
echo "=== Tests de conectividad ==="
sleep 5
curl -s -o /dev/null -w "Temporal gRPC port 7233: %{http_code}\n" http://localhost:7233 || echo "Temporal port 7233: OK (gRPC no responde a HTTP, es normal)"
curl -s -o /dev/null -w "Temporal UI port 8081: %{http_code}\n" http://localhost:8081
curl -s -o /dev/null -w "Node-RED port 1880: %{http_code}\n" http://localhost:1880

echo ""
echo "=== LISTO ==="
echo "Temporal UI: http://72.62.29.17:8081"
echo "Node-RED:    http://72.62.29.17:1880"
echo ""
echo "Siguiente paso: anadir en Coolify los proxies para:"
echo "  temporal.agentflowing.com → puerto 8081"
echo "  nodered.agentflowing.com  → puerto 1880"
