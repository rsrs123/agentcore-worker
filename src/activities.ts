import Groq from 'groq-sdk';
import { Context } from '@temporalio/activity';
import { supabase } from './supabase';
import type { ScrapedLead } from './shared';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function upsertLead(lead: {
  name: string;
  company: string;
  industry: string;
  email?: string;
  linkedin_url?: string;
  website?: string;
  source?: string;
}): Promise<string> {
  const { data, error } = await supabase
    .from('leads')
    .upsert(
      { ...lead, status: 'new', source: lead.source ?? 'temporal' },
      { onConflict: 'email' }
    )
    .select('id')
    .single();

  if (error) throw new Error(`upsertLead failed: ${error.message}`);
  return data.id as string;
}

export async function generateOutreachEmail(leadData: {
  name: string;
  company: string;
  industry: string;
  pain_point: string;
}): Promise<string> {
  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: `Eres un experto en ventas B2B para el mercado español y latinoamericano.
Escribes cold emails directos, sin parecer spam, con tono profesional pero cercano.
Reglas:
- Maximo 120 palabras
- Solo el cuerpo del email, sin asunto ni saludo formal
- Primera frase engancha con algo especifico de la empresa
- CTA claro y sin presion al final
- Tono: directo, humano, no corporativo`,
      },
      {
        role: 'user',
        content: `Escribe un cold email para:
Nombre: ${leadData.name}
Empresa: ${leadData.company}
Sector: ${leadData.industry}
Contexto detectado: ${leadData.pain_point}`,
      },
    ],
    temperature: 0.7,
    max_tokens: 300,
  });

  return completion.choices[0].message.content ?? '';
}

export async function saveOutreachEmail(params: {
  lead_id: string;
  subject: string;
  body: string;
  research_context: string;
  workflow_id?: string;
  run_id?: string;
}): Promise<string> {
  const { data, error } = await supabase
    .from('outreach_emails')
    .insert({
      lead_id: params.lead_id,
      subject: params.subject,
      body: params.body,
      research_context: params.research_context,
      workflow_id: params.workflow_id,
      run_id: params.run_id,
      model_used: 'llama-3.3-70b-versatile',
      status: 'generated',
    })
    .select('id')
    .single();

  if (error) throw new Error(`saveOutreachEmail failed: ${error.message}`);

  // Update lead status to 'researched'
  await supabase.from('leads').update({ status: 'researched' }).eq('id', params.lead_id);

  return data.id as string;
}

export async function researchLead(company: string, website?: string): Promise<string> {
  if (!website || !process.env.APIFY_API_KEY) {
    // Fallback: generic mock context
    return `${company} es una empresa en crecimiento buscando optimizar su proceso de adquisicion de clientes y reducir el ciclo de ventas.`;
  }

  const APIFY_KEY = process.env.APIFY_API_KEY;

  // Start website content crawler (cheerio = fast, no JS rendering needed)
  const startRes = await fetch(
    `https://api.apify.com/v2/acts/apify~website-content-crawler/runs?token=${APIFY_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startUrls: [{ url: website }],
        maxCrawlPages: 3,
        crawlerType: 'cheerio',
        excludeUrlGlobs: ['**/*.pdf', '**/*.jpg', '**/*.png', '**/*.css', '**/*.js'],
      }),
    }
  );

  if (!startRes.ok) {
    // Non-fatal: fall back to generic context
    return `${company} opera en el sector ${company} con presencia digital activa en ${website}.`;
  }

  const runData = (await startRes.json()) as { data: { id: string; status: string } };
  const runId = runData.data.id;

  // Poll with heartbeat (max 3 min — website crawl is fast with cheerio)
  const deadline = Date.now() + 3 * 60 * 1000;
  let status = runData.data.status;
  while (status !== 'SUCCEEDED' && status !== 'FAILED' && status !== 'ABORTED') {
    if (Date.now() > deadline) break;
    Context.current().heartbeat({ runId, status });
    await new Promise((r) => setTimeout(r, 8_000));
    const poll = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_KEY}`);
    status = ((await poll.json()) as { data: { status: string } }).data.status;
  }

  if (status !== 'SUCCEEDED') {
    return `${company} es una empresa con presencia activa en ${website}.`;
  }

  // Get scraped text (first 3 pages merged)
  const dataRes = await fetch(
    `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${APIFY_KEY}&limit=3`
  );
  const pages = (await dataRes.json()) as Array<{ text?: string }>;
  const rawText = pages
    .map((p) => p.text ?? '')
    .join('\n')
    .slice(0, 3000); // cap at 3k chars for Groq context

  if (!rawText.trim()) {
    return `${company} tiene presencia digital en ${website}.`;
  }

  // Summarize with Groq into actionable sales context
  const summary = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: `Eres un analista de ventas B2B. A partir del contenido de una web empresarial, extrae en 2-3 frases concisas:
1. Qué hace exactamente la empresa y para quién
2. Su propuesta de valor principal
3. Un posible pain point o área de mejora que podría resolverse con automatización o IA
Responde SOLO con esas 2-3 frases, sin introducción ni formato.`,
      },
      {
        role: 'user',
        content: `Empresa: ${company}\nContenido web:\n${rawText}`,
      },
    ],
    temperature: 0.3,
    max_tokens: 200,
  });

  return summary.choices[0].message.content ?? `${company} opera en ${website}.`;
}

export async function runApifyScrape(params: {
  searchQuery: string;
  maxResults: number;
}): Promise<ScrapedLead[]> {
  const APIFY_KEY = process.env.APIFY_API_KEY;
  if (!APIFY_KEY) throw new Error('APIFY_API_KEY not set');

  // Start actor run (no waitForFinish — we poll manually with heartbeat)
  const startRes = await fetch(
    `https://api.apify.com/v2/acts/lukaskrivka~google-maps-with-contact-details/runs?token=${APIFY_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        searchStringsArray: [params.searchQuery],
        maxCrawledPlacesPerSearch: params.maxResults,
        countryCode: 'es',
        language: 'es',
      }),
    }
  );

  if (!startRes.ok) {
    const err = await startRes.text();
    throw new Error(`Apify start failed: ${startRes.status} ${err}`);
  }

  const runData = (await startRes.json()) as { data: { id: string; status: string } };
  const runId = runData.data.id;

  // Poll until SUCCEEDED or FAILED (heartbeat keeps Temporal alive)
  const deadline = Date.now() + 8 * 60 * 1000; // 8 minutes max
  let status = runData.data.status;
  while (status !== 'SUCCEEDED' && status !== 'FAILED' && status !== 'ABORTED') {
    if (Date.now() > deadline) throw new Error(`Apify run ${runId} timed out after 8 minutes`);
    Context.current().heartbeat({ runId, status });
    await new Promise((r) => setTimeout(r, 10_000)); // poll every 10s
    const pollRes = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_KEY}`
    );
    const pollData = (await pollRes.json()) as { data: { status: string } };
    status = pollData.data.status;
  }

  if (status !== 'SUCCEEDED') {
    throw new Error(`Apify run ${runId} ended with status: ${status}`);
  }

  const dataRes = await fetch(
    `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${APIFY_KEY}&format=json&limit=${params.maxResults}`
  );
  const items = (await dataRes.json()) as Array<{
    title?: string;
    categoryName?: string;
    website?: string;
    emails?: string[];
    city?: string;
    phone?: string;
    permanentlyClosed?: boolean;
  }>;

  return items
    .filter((item) => item.title && !item.permanentlyClosed)
    .map((item) => ({
      name: item.title ?? '',
      company: item.title ?? '',
      industry: item.categoryName ?? 'general',
      website: item.website ?? '',
      email: item.emails?.[0] ?? '',
    }));
}

export async function classifyReply(replyText: string): Promise<'positive' | 'negative' | 'neutral' | 'out_of_office'> {
  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: `Clasifica la respuesta a un email de ventas B2B. Responde SOLO con una de estas palabras: positive, negative, neutral, out_of_office`,
      },
      {
        role: 'user',
        content: replyText,
      },
    ],
    temperature: 0,
    max_tokens: 10,
  });

  const result = completion.choices[0].message.content?.trim().toLowerCase();
  if (result === 'positive' || result === 'negative' || result === 'neutral' || result === 'out_of_office') {
    return result;
  }
  return 'neutral';
}
