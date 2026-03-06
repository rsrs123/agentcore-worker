import { proxyActivities, workflowInfo } from '@temporalio/workflow';
import type * as activities from './activities';
import type { LeadInput, OutreachResult } from './shared';

const { generateOutreachEmail, researchLead, upsertLead, saveOutreachEmail } =
  proxyActivities<typeof activities>({
    startToCloseTimeout: '60 seconds',
    retry: {
      maximumAttempts: 3,
      initialInterval: '1 second',
      backoffCoefficient: 2,
    },
  });

export async function outreachWorkflow(lead: LeadInput): Promise<OutreachResult> {
  const info = workflowInfo();

  // Step 1: Upsert lead in Supabase
  const leadId = await upsertLead({
    name: lead.name,
    company: lead.company,
    industry: lead.industry,
    email: lead.email,
    source: 'temporal',
  });

  // Step 2: Research the lead (Fase 2: Apollo + Apify)
  const research = await researchLead(lead.company);

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
