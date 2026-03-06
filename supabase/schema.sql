-- AgentCore OS — Database Schema
-- Run this in Supabase SQL Editor after creating the project

-- ─── LEADS ────────────────────────────────────────────────────
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text not null,
  industry text,
  email text,
  linkedin_url text,
  website text,
  pain_point text,
  source text default 'manual',          -- manual | apify | huginn | apollo
  status text default 'new',             -- new | researched | emailed | replied | converted | rejected
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─── CAMPAIGNS ───────────────────────────────────────────────
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status text default 'active',          -- active | paused | completed
  model_used text default 'llama-3.3-70b-versatile',
  created_at timestamptz default now()
);

-- ─── OUTREACH EMAILS ─────────────────────────────────────────
create table if not exists outreach_emails (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete cascade,
  campaign_id uuid references campaigns(id),
  workflow_id text,                      -- Temporal workflow ID
  run_id text,                           -- Temporal run ID
  subject text,
  body text not null,
  research_context text,
  model_used text,
  status text default 'generated',       -- generated | sent | opened | replied | bounced
  sent_at timestamptz,
  created_at timestamptz default now()
);

-- ─── REPLIES ─────────────────────────────────────────────────
create table if not exists replies (
  id uuid primary key default gen_random_uuid(),
  outreach_email_id uuid references outreach_emails(id),
  lead_id uuid references leads(id),
  body text,
  sentiment text,                        -- positive | negative | neutral | out_of_office
  received_at timestamptz default now()
);

-- ─── WORKFLOW RUNS ───────────────────────────────────────────
create table if not exists workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_id text not null,
  run_id text not null,
  workflow_type text not null,           -- outreachWorkflow | scoutWorkflow | etc
  status text default 'running',         -- running | completed | failed
  input jsonb,
  result jsonb,
  error text,
  started_at timestamptz default now(),
  completed_at timestamptz
);

-- ─── INDEXES ─────────────────────────────────────────────────
create index if not exists leads_status_idx on leads(status);
create index if not exists leads_company_idx on leads(company);
create index if not exists outreach_emails_lead_id_idx on outreach_emails(lead_id);
create index if not exists outreach_emails_status_idx on outreach_emails(status);
create index if not exists workflow_runs_workflow_id_idx on workflow_runs(workflow_id);

-- ─── AUTO-UPDATE updated_at ──────────────────────────────────
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger leads_updated_at
  before update on leads
  for each row execute function update_updated_at();

-- ─── ROW LEVEL SECURITY (básico) ────────────────────────────
alter table leads enable row level security;
alter table campaigns enable row level security;
alter table outreach_emails enable row level security;
alter table replies enable row level security;
alter table workflow_runs enable row level security;

-- Service role bypasses RLS — el worker usa service_role key
-- Para el dashboard futuro se añadirán policies por usuario
