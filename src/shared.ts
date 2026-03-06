export const TASK_QUEUE = 'convereach-agents';

export interface LeadInput {
  name: string;
  company: string;
  industry: string;
  email?: string;
}

export interface OutreachResult {
  email: string;
  subject: string;
  research: string;
  leadId: string;
  emailId: string;
  generatedAt: string;
}
