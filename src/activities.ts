import Groq from 'groq-sdk';
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

export async function researchLead(company: string): Promise<string> {
  // Fase 1: contexto mock enriquecido
  // Fase 2: llamara a Apollo + Apify para datos reales
  return `${company} es una empresa en crecimiento activo buscando optimizar su proceso de adquisicion de clientes y reducir el ciclo de ventas. Han mostrado senales de inversion en herramientas digitales recientes.`;
}

export async function runApifyScrape(params: {
  searchQuery: string;
  maxResults: number;
}): Promise<ScrapedLead[]> {
  const APIFY_KEY = process.env.APIFY_API_KEY;
  if (!APIFY_KEY) throw new Error('APIFY_API_KEY not set');

  // Start actor run and wait up to 120s for it to finish
  const startRes = await fetch(
    `https://api.apify.com/v2/acts/apify~google-maps-email-extractor/runs?token=${APIFY_KEY}&waitForFinish=120`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        searchStringsArray: [params.searchQuery],
        maxCrawledPlacesPerSearch: params.maxResults,
        countryCode: 'ES',
        language: 'es',
        includeHistogram: false,
        includeOpeningHours: false,
        includePeopleAlsoSearch: false,
      }),
    }
  );

  if (!startRes.ok) {
    const err = await startRes.text();
    throw new Error(`Apify start failed: ${startRes.status} ${err}`);
  }

  const runData = (await startRes.json()) as { data: { id: string; status: string } };
  const { id: runId, status } = runData.data;

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
  }>;

  return items
    .filter((item) => item.title)
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
