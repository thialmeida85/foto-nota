const defaultModel = 'qwen/qwen3.6-27b';

export async function extractNotaWithGroq({ imageDataUrl, ocrText = '' }) {
  if (!process.env.GROQ_API_KEY) {
    const error = new Error('GROQ_API_KEY nao configurada no backend.');
    error.status = 503;
    throw error;
  }

  if (!imageDataUrl?.startsWith('data:image/')) {
    const error = new Error('Imagem invalida para analise com IA.');
    error.status = 400;
    throw error;
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || defaultModel,
      temperature: 0,
      max_tokens: 1024,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: buildPrompt(ocrText)
            },
            {
              type: 'image_url',
              image_url: {
                url: imageDataUrl
              }
            }
          ]
        }
      ]
    })
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message = payload?.error?.message || 'Falha ao consultar Groq Vision.';
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    const error = new Error('Groq nao retornou conteudo.');
    error.status = 502;
    throw error;
  }

  try {
    return normalizeGroqResult(JSON.parse(content));
  } catch {
    const error = new Error('Groq retornou JSON invalido.');
    error.status = 502;
    throw error;
  }
}

function buildPrompt(ocrText) {
  return `Voce e um assistente de extracao de dados especializado em cupons fiscais brasileiros.
Sua tarefa e analisar a imagem de um cupom fiscal e extrair as informacoes solicitadas, retornando-as ESTRITAMENTE no formato JSON.

REGRAS IMPORTANTES:
1. Extraia SOMENTE dados visiveis na imagem. Nao invente ou infira informacoes.
2. Sua resposta DEVE ser um unico objeto JSON valido, sem nenhum texto, comentario ou \`\`\`json markdown\`\`\` antes ou depois.
3. Se uma informacao nao for encontrada, use uma string vazia "" para campos de texto ou 0.0 para o campo de confianca.

FOCO PRINCIPAL:
- A "chave de acesso" (chave_nfe) de 44 digitos e a informacao mais importante.
- Se houver um QR Code com texto, a chave geralmente esta no parametro "p=" antes do primeiro caractere "|".
- Nao confunda a chave de acesso com outros codigos (produto, COO, etc.).

Formato de saida JSON esperado:
{
  "chave_nfe": "string contendo exatamente 44 digitos, ou string vazia",
  "tipo": "string, um de: 'NFCE', 'CFE_SAT', 'NFE', ou 'DESCONHECIDO'",
  "numero": "string contendo o numero da nota, ou string vazia",
  "serie": "string contendo a serie da nota, ou string vazia",
  "data_emissao": "string no formato 'YYYY-MM-DD', ou string vazia",
  "valor_total": "string contendo o valor total com ponto como separador decimal (ex: '123.45'), ou string vazia",
  "confianca": "numero de 0.0 a 1.0 indicando sua confianca na extracao da chave_nfe",
  "observacao": "string curta com qualquer observacao relevante (ex: 'Imagem borrada'), ou string vazia"
}

O texto abaixo foi extraido via OCR e pode conter erros. Use-o como apoio, mas priorize a imagem.
Texto OCR:
${String(ocrText || 'Nenhum').slice(0, 4000)}`.trim();
}

function normalizeGroqResult(result) {
  const chave = String(result.chave_nfe || '').replace(/\D/g, '').slice(0, 44);
  const tipo = ['NFE', 'NFCE', 'CFE_SAT', 'DESCONHECIDO'].includes(result.tipo)
    ? result.tipo
    : inferTipo(chave);

  return {
    chave_nfe: chave,
    tipo,
    numero: String(result.numero || '').replace(/[^\d]/g, ''),
    serie: String(result.serie || '').replace(/[^\d]/g, ''),
    data_emissao: String(result.data_emissao || ''),
    valor_total: normalizeMoney(result.valor_total),
    confianca: clampConfidence(result.confianca),
    observacao: String(result.observacao || '').slice(0, 240)
  };
}

function inferTipo(chave) {
  const model = chave.slice(20, 22);
  if (model === '55') return 'NFE';
  if (model === '65') return 'NFCE';
  return 'DESCONHECIDO';
}

function normalizeMoney(value) {
  const text = String(value || '').replace(',', '.').replace(/[^\d.]/g, '');
  return text || '';
}

function clampConfidence(value) {
  const number = Number(value);
  if (Number.isNaN(number)) return 0;
  return Math.max(0, Math.min(1, number));
}
