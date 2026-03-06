import { proxyActivities, workflowInfo, startChild } from '@temporalio/workflow';
import type * as activities from './activities';
import type { LeadInput, OutreachResult, ScoutInput, ScoutResult } from './shared';
import { TASK_QUEUE } from './shared';

const { generateOutreachEmail, upsertLead, saveOutreachEmail } =
  proxyActivities<typeof activities>({
    startToCloseTimeout: '3 minutes',
    retry: {
      maximumAttempts: 3,
      initialInterval: '2 seconds',
      backoffCoefficient: 2,
    },
  });

// researchLead scrapes the web — needs longer timeout + heartbeat
const { researchLead } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
  heartbeatTimeout: '30 seconds',
  retry: { maximumAttempts: 2, initialInterval: '5 seconds' },
});

// Apify scraping needs longer timeout + heartbeat
const { runApifyScrape } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
  heartbeatTimeout: '30 seconds',
  retry: { maximumAttempts: 2, initialInterval: '5 seconds' },
});

export async function outreachWorkflow(lead: LeadInput): Promise<OutreachResult> {
  const info = workflowInfo();

  // Step 1: Upsert lead in Supabase
  const leadId = await upsertLead({
    name: lead.name,
    company: lead.company,
    industry: lead.industry,
    email: lead.email,
    website: lead.website,
    source: 'temporal',
  });

  // Step 2: Research the lead — real web scrape if website available
  const research = await researchLead(lead.company, lead.website);

  // Step 3: Generate personalized email with context
  const emailBody = await generateOutreachEmail({
    name: lead.name,
    company: lead.company,
    industry: lead.industry,
    pain_point: research,
  });

  const subject = `Una pregunta rápida sobre ${lead.company}`;

  // Step 4: Persist generated email
  const emailId = await saveOutreachEmail({
    lead_id: leadId,
    subject,
    body: emailBody,
    research_context: research,
    workflow_id: info.workflowId,
    run_id: info.runId,
  });

  return {
    email: emailBody,
    subject,
    research,
    leadId,
    emailId,
    generatedAt: new Date().toISOString(),
  };
}

export async function scoutWorkflow(input: ScoutInput): Promise<ScoutResult> {
  const maxResults = input.maxResults ?? 10;
  const autoTrigger = input.autoTriggerOutreach ?? true;

  // Step 1: Scrape leads via Apify Google Maps
  const scrapedLeads = await runApifyScrape({
    searchQuery: input.searchQuery,
    maxResults,
  });

  let processed = 0;

  // Step 2: For each lead, upsert and optionally trigger outreach
  for (const lead of scrapedLeads) {
    if (!lead.company) continue;

    // Only upsert + trigger outreach if we have an email (avoids duplicates for null emails)
    const email = lead.email || undefined;

    await upsertLead({
      name: lead.name,
      company: lead.company,
      industry: lead.industry,
      website: lead.website,
      email,
      source: 'apify',
    });

    // Trigger outreach only when we have an email to send to
    if (autoTrigger && lead.name && lead.company && email) {
      const childId = `outreach-apify-${lead.company.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}`;
      try {
        await startChild(outreachWorkflow, {
          args: [{ name: lead.name, company: lead.company, industry: lead.industry, email, website: lead.website }],
          workflowId: childId,
          taskQueue: TASK_QUEUE,
        });
        processed++;
      } catch (err: any) {
        if (err?.name !== 'WorkflowExecutionAlreadyStartedError') throw err;
      }
    }
  }

  return {
    leadsFound: scrapedLeads.length,
    leadsProcessed: processed,
    leads: scrapedLeads,
  };
}
