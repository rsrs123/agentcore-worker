export const TASK_QUEUE = 'convereach-agents';

export interface LeadInput {
  name: string;
  company: string;
  industry: string;
  email?: string;
  website?: string;
}

export interface OutreachResult {
  email: string;
  subject: string;
  research: string;
  leadId: string;
  emailId: string;
  generatedAt: string;
}

export interface ScoutInput {
  searchQuery: string;      // e.g. "SaaS empresa Barcelona"
  maxResults?: number;      // default 10
  autoTriggerOutreach?: boolean;  // default true
}

export interface ScrapedLead {
  name: string;
  company: string;
  industry: string;
  website?: string;
  email?: string;
}

export interface ScoutResult {
  leadsFound: number;
  leadsProcessed: number;
  leads: ScrapedLead[];
}
