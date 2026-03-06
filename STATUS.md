# AgentCore OS — Estado del Proyecto
> Última actualización: 2026-03-06
> Razón de pausa: pendiente de presupuesto para Smartlead + ZapMail antes de continuar

---

## Qué es esto

**AgentCore OS** es una plataforma de outreach B2B autónoma para el mercado español/latinoamericano.

Estrategia de negocio en dos fases:
1. **Agencia primero**: usarlo internamente para hacer outreach para clientes → genera ingresos + datos reales
2. **Producto después**: vender AgentCore OS como SaaS a otras agencias/empresas

El diferencial a largo plazo es un modelo LLM propio (`SalesLLM-ES`) fine-tuneado con datos reales de reply rate en el mercado hispano — un dataset que no existe en ningún lugar público.

---

## Infraestructura desplegada y funcionando

### VPS
- **IP**: `72.62.29.17`
- **Proveedor**: Hostinger KVM4 — 4CPU / 16GB RAM / 200GB SSD — París
- **SSH**: `root@72.62.29.17` / password en `.env.master`
- **OS**: Ubuntu 24.04 LTS
- **Dominio**: `agentflowing.com` (DNS en Namecheap — NO tocar este dominio para outreach)

### Servicios corriendo en VPS

| Servicio | URL | Puerto interno | Estado |
|----------|-----|----------------|--------|
| Temporal Server | `temporal.agentflowing.com` | 7233 (gRPC) | ✅ running |
| Temporal UI | `temporal.agentflowing.com` | 8081 | ✅ running |
| Node-RED | `nodered.agentflowing.com` | 1880 | ✅ running |
| Huginn | `huginn.agentflowing.com` | 3030 | ✅ running |
| agentcore-worker | interno | — | ✅ running |
| Trigger API | `http://72.62.29.17:3020` | 3020 | ✅ running |
| Coolify (panel) | `http://72.62.29.17:8000` | 8000 | ✅ running |

### Docker networks
- `temporal_temporal-network` — Temporal + agentcore-worker (comunicación interna)
- `coolify` — Huginn + Node-RED + Traefik (HTTPS via Coolify proxy)

### Repositorio
- **GitHub**: `https://github.com/rsrs123/agentcore-worker`
- **Local**: `/Users/rs/LLM_SaaS_01/agentcore-worker/`
- **Branch**: `main`

---

## Stack técnico

```
Orchestration:   Temporal.io (auto-setup:1.25, UI:2.31.2)
Worker:          Node.js 20 (bookworm-slim — glibc requerido por Temporal SDK)
Language:        TypeScript 5.4
Task Queue:      convereach-agents
LLM fast:        Groq — Llama 3.3 70B Versatile
LLM flexible:    OpenRouter (configurado, no en uso activo aún)
Scraping:        Apify (lukaskrivka~google-maps-with-contact-details + apify~website-content-crawler)
Database:        Supabase PostgreSQL (wyslgaboofgyvnwgwpyn.supabase.co)
Signals:         Huginn (RSS + JS Agent + Post Agent)
Trigger:         Express API :3020 (dentro del worker container)
Fine-tuning:     RunPod (planificado — pendiente de datos)
```

---

## Credenciales

Todas en `/Users/rs/LLM_SaaS_01/.env.master` (local, nunca commitear).

| Variable | Dónde encontrarla |
|----------|-------------------|
| `GROQ_API_KEY` | console.groq.com |
| `OPENROUTER_API_KEY` | openrouter.ai/keys |
| `APIFY_API_KEY` | console.apify.com/account/integrations |
| `COOLIFY_API_TOKEN` | 72.62.29.17:8000 → Settings → API |
| `GITHUB_TOKEN` | github.com/settings/tokens |
| `VPS_SSH` | root@72.62.29.17 (password en .env.master) |
| `SUPABASE_URL` | wyslgaboofgyvnwgwpyn.supabase.co |
| `SUPABASE_SERVICE_KEY` | Supabase dashboard → Settings → API |
| `HUGINN_PASSWORD` | AgentCore2026! (admin@agentflowing.com) |

---

## Código — Archivos clave

```
agentcore-worker/
├── src/
│   ├── shared.ts        # Tipos: LeadInput, OutreachResult, ScoutInput, ScrapedLead, ScoutResult
│   ├── activities.ts    # Todas las activities: upsertLead, generateOutreachEmail,
│   │                    # saveOutreachEmail, researchLead (real web scrape),
│   │                    # runApifyScrape, classifyReply
│   ├── workflows.ts     # outreachWorkflow + scoutWorkflow
│   ├── worker.ts        # Temporal worker + arranca la Trigger API
│   ├── api.ts           # Express :3020 — POST /trigger/scout, POST /trigger/outreach
│   └── supabase.ts      # Cliente Supabase (service_role)
├── supabase/
│   └── schema.sql       # Schema completo de la DB
├── Dockerfile           # node:20-bookworm-slim (glibc — NO alpine)
└── STATUS.md            # Este archivo
```

---

## Workflows implementados

### `outreachWorkflow(LeadInput)`
```
1. upsertLead() → Supabase leads (onConflict: email)
2. researchLead(company, website)
   → Si hay website: Apify website-content-crawler (cheerio, max 3 páginas)
   → Groq resume en 2-3 frases de contexto de ventas accionable
   → Si no hay website: texto genérico de fallback
3. generateOutreachEmail(contexto_real)
   → Groq Llama 3.3 70B — email en español, max 120 palabras
4. saveOutreachEmail() → Supabase outreach_emails
   → lead.status = 'researched'
   → email.status = 'generated'
Returns: { email, subject, research, leadId, emailId, generatedAt }
```

### `scoutWorkflow(ScoutInput)`
```
1. runApifyScrape(searchQuery, maxResults)
   → Apify: lukaskrivka~google-maps-with-contact-details
   → Polling con heartbeat (max 8 min, poll cada 10s)
   → Filtra permanentlyClosed=true y leads sin nombre
2. Por cada lead:
   → upsertLead() con source='apify'
   → Si tiene email: startChild(outreachWorkflow)
     → workflowId único por empresa+timestamp
Returns: { leadsFound, leadsProcessed, leads[] }
```

### `classifyReply(replyText)` — activity implementada, workflow pendiente
```
→ Groq clasifica: positive | negative | neutral | out_of_office
```

---

## Trigger API — Endpoints

```
GET  http://72.62.29.17:3020/health
POST http://72.62.29.17:3020/trigger/scout
     Body: { searchQuery: string, maxResults?: number, autoTriggerOutreach?: boolean }

POST http://72.62.29.17:3020/trigger/outreach
     Body: { name?: string, company: string, industry?: string, email?: string, website?: string }
```

---

## Huginn — Agentes configurados

| ID | Nombre | Tipo | Función |
|----|--------|------|---------|
| 8 | RSS Startups ES/LATAM | RssAgent | Crunchbase feed, cada 12h |
| 9 | Extract Company Signal | JavaScriptAgent | Filtra noticias con keywords ES/LATAM |
| 10 | Trigger Scout Workflow | PostAgent | POST a Trigger API :3020/trigger/scout |

Flujo: RSS → JS extrae query → Post dispara scoutWorkflow automáticamente.

---

## Base de datos Supabase — Schema

```sql
leads (id, name, company, industry, email UNIQUE, linkedin_url, website,
       pain_point, source, status, created_at, updated_at)
  status: new | researched | emailed | replied | converted | rejected
  source: manual | apify | temporal | huginn

campaigns (id, name, description, status, model_used, created_at)

outreach_emails (id, lead_id, campaign_id, workflow_id, run_id,
                 subject, body, research_context, model_used,
                 status, sent_at, created_at)
  status: generated | sent | opened | replied | bounced

replies (id, outreach_email_id, lead_id, body, sentiment, received_at)
  sentiment: positive | negative | neutral | out_of_office

workflow_runs (id, workflow_id, run_id, workflow_type, status,
               input, result, error, started_at, completed_at)
```

---

## Próximo paso al reanudar — LO MÁS URGENTE

### 1. Pagar y configurar (decisión de negocio, no técnica)
- **ZapMail** (~$30-50/mo) — warmup de email inboxes. Va PRIMERO. Sin esto Smartlead no sirve.
- **Smartlead** (~$39/mo) — plataforma de envío cold email con API + webhooks
- **Dominios de outreach** (~$10-20/año cada uno) — NUNCA usar agentflowing.com para outreach
  - Ej: `agentcore-growth.com`, `outreachagentflowing.com`
- Conectar dominios en ZapMail → esperar 4-8 semanas de warmup

### 2. Schema additions (hacer ANTES de empezar envíos reales)
```sql
ALTER TABLE outreach_emails
  ADD COLUMN IF NOT EXISTS opened boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS replied boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS reply_sentiment text,
  ADD COLUMN IF NOT EXISTS prompt_used text;
```
El `prompt_used` es crítico para el dataset de fine-tuning posterior.

### 3. Integrar Smartlead (1-2 días de trabajo)
- Nueva activity: `sendViaSmartlead(emailId, leadEmail, subject, body)`
- Actualiza `outreach_emails.status` a `'sent'`
- Webhook Smartlead → Node-RED → Trigger API → `classifyReplyWorkflow`
- Loop cerrado: generar → enviar → trackear → clasificar → Supabase

---

## Flywheel de datos — Visión a largo plazo

```
Mes 1-2:   Sistema genera + envía emails (Groq Llama 3.3 70B)
           Supabase acumula: (prompt, email, opened, replied, sentiment)

Mes 2-3:   500+ emails con resultado conocido
           Primer fine-tuning en RunPod A100 (~$5-6 por run)
           Modelo: Llama 3.1 8B Instruct base + QLoRA
           Herramienta: LlamaFactory (UI visual, sin ser data scientist)
           Dataset: pares (prompt→email) positivos (replied=true)
                  + negativos DPO (replied=false)

Mes 3-4:   A/B test SalesLLM-ES vs Groq
           Si mejor reply rate → sustituye Groq al 50%, luego al 100%
           Inferencia: RunPod Serverless (no Groq — Groq no sirve modelos custom)

Mes 4+:    Fine-tuning mensual automático (Temporal workflow nocturno)
           Modelo mejora continuamente
           Coste de inferencia: ~$0 vs pagar por tokens a Groq
```

---

## Decisión estratégica pendiente

**Agencia primero** (correcto):
- Usar AgentCore OS para hacer outreach para clientes propios
- Genera ingresos mientras el sistema madura
- Acumula datos reales de respuesta en mercado hispano
- Cuando SalesLLM-ES esté entrenado → vender AgentCore OS como producto

**Por qué NO usar Clay + Apollo + Smartlead en su lugar**:
- Clay hace lo mismo que AgentCore OS pero ~$150-800/mo y sin código propio
- Apollo tiene base de datos de 200M contactos verificados (ventaja real) — se puede integrar como fuente adicional en el futuro
- AgentCore OS ES el producto. Si usas Clay, no tienes nada que vender.
- A escala (10k leads/mes) Clay cuesta $800+. AgentCore: coste de Apify solamente.

---

## Ports en uso en el VPS — NO usar estos

```
80, 443    → Traefik/Coolify proxy
3030       → Huginn
3020       → Trigger API (agentcore-worker)
5432       → PostgreSQL (varios)
6001-6002  → Coolify realtime
7233       → Temporal gRPC
8000       → Coolify panel
8080       → Coolify proxy alt
8081       → Temporal UI
1880       → Node-RED
NO usar:   3000-3007 (ocupados por otros proyectos del usuario)
```

---

## Comandos útiles para cuando retomemos

```bash
# SSH al VPS
sshpass -p 'Autobomba@24' ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no root@72.62.29.17

# Ver estado de containers
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Logs del worker
docker logs agentcore-worker --tail 30

# Deploy worker (desde /opt/agentcore/worker en VPS)
cd /opt/agentcore/worker && git pull && docker stop agentcore-worker && docker rm agentcore-worker && docker build -t worker-agentcore-worker:latest . && docker run -d --name agentcore-worker --network temporal_temporal-network --restart unless-stopped -p 3020:3020 --env-file .env worker-agentcore-worker:latest

# Test rápido outreach
curl -X POST http://72.62.29.17:3020/trigger/outreach \
  -H "Content-Type: application/json" \
  -d '{"name":"Pedro","company":"TuEmpresa","industry":"SaaS","email":"test@tuempresa.com","website":"https://tuempresa.com"}'

# Test scout
curl -X POST http://72.62.29.17:3020/trigger/scout \
  -H "Content-Type: application/json" \
  -d '{"searchQuery":"agencia marketing digital Madrid","maxResults":5}'

# Ver leads en Supabase
PGPASSWORD='Autobomba@24' psql "postgresql://postgres.wyslgaboofgyvnwgwpyn@aws-1-eu-west-1.pooler.supabase.com:6543/postgres" \
  -c "SELECT name, email, status, created_at FROM leads ORDER BY created_at DESC LIMIT 10;"
```
