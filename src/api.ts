import express from 'express';
import { Connection, Client } from '@temporalio/client';
import { TASK_QUEUE } from './shared';

const app = express();
app.use(express.json());

let temporalClient: Client;

export async function startApi(temporalAddress: string): Promise<void> {
  const conn = await Connection.connect({ address: temporalAddress });
  temporalClient = new Client({ connection: conn });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'agentcore-trigger-api' });
  });

  // POST /trigger/scout — starts scoutWorkflow
  // Body: { searchQuery, maxResults?, autoTriggerOutreach? }
  app.post('/trigger/scout', async (req, res) => {
    const { searchQuery, maxResults = 10, autoTriggerOutreach = true } = req.body as {
      searchQuery?: string;
      maxResults?: number;
      autoTriggerOutreach?: boolean;
    };

    if (!searchQuery) {
      res.status(400).json({ error: 'searchQuery required' });
      return;
    }

    const workflowId = `scout-api-${Date.now()}`;
    await temporalClient.workflow.start('scoutWorkflow', {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: [{ searchQuery, maxResults, autoTriggerOutreach }],
    });

    res.json({ workflowId, status: 'started', searchQuery });
  });

  // POST /trigger/outreach — starts outreachWorkflow for a single lead
  // Body: { name, company, industry, email? }
  app.post('/trigger/outreach', async (req, res) => {
    const { name, company, industry = 'general', email } = req.body as {
      name?: string;
      company?: string;
      industry?: string;
      email?: string;
    };

    if (!company) {
      res.status(400).json({ error: 'company required' });
      return;
    }

    const workflowId = `outreach-api-${Date.now()}`;
    await temporalClient.workflow.start('outreachWorkflow', {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: [{ name: name ?? company, company, industry, email }],
    });

    res.json({ workflowId, status: 'started', company });
  });

  const PORT = process.env.API_PORT ?? 3020;
  app.listen(PORT, () => {
    console.log(`[AgentCore API] Trigger API listening on :${PORT}`);
  });
}
