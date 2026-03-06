export const TASK_QUEUE = 'convereach-agents';

export interface LeadInput {
  name: string;
  company: string;
  industry: string;
}

export interface OutreachResult {
  email: string;
  research: string;
  leadId?: string;
  generatedAt: string;
}
