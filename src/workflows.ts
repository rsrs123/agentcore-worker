import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities';
import type { LeadInput, OutreachResult } from './shared';

const { generateOutreachEmail, researchLead } = proxyActivities<typeof activities>({
  startToCloseTimeout: '60 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '1 second',
    backoffCoefficient: 2,
  },
});

export async function outreachWorkflow(lead: LeadInput): Promise<OutreachResult> {
  // Step 1: Research the lead (Fase 2: Apollo + Apify)
  const research = await researchLead(lead.company);

  // Step 2: Generate personalized email with context
  const email = await generateOutreachEmail({
    name: lead.name,
    company: lead.company,
    industry: lead.industry,
    pain_point: research,
  });

  return {
    email,
    research,
    generatedAt: new Date().toISOString(),
  };
}
