import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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

export async function researchLead(company: string): Promise<string> {
  // Fase 1: contexto mock enriquecido
  // Fase 2: llamara a Apollo + Apify para datos reales
  return `${company} es una empresa en crecimiento activo buscando optimizar su proceso de adquisicion de clientes y reducir el ciclo de ventas. Han mostrado senales de inversion en herramientas digitales recientes.`;
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
