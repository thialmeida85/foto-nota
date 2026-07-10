const defaultModel = 'meta-llama/llama-4-scout-17b-16e-instruct';

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
      max_completion_tokens: 900,
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
  return `
Voce esta lendo uma foto de cupom fiscal brasileiro NFC-e/NF-e/CFe-SAT.
Extraia SOMENTE dados visiveis na imagem. Nao invente.

Prioridade maxima:
- chave de acesso de 44 digitos da NF-e/NFC-e;
- se houver QR Code textual, use o parametro p= antes do primeiro |;
- nao confunda codigo de produto, valor, data, numero da nota ou serie com chave de acesso.

Retorne apenas JSON neste formato:
{
  "chave_nfe": "string com 44 digitos ou vazio",
  "tipo": "NFE|NFCE|CFE_SAT|DESCONHECIDO",
  "numero": "string ou vazio",
  "serie": "string ou vazio",
  "data_emissao": "YYYY-MM-DD ou vazio",
  "valor_total": "numero decimal com ponto ou vazio",
  "confianca": 0.0,
  "observacao": "string curta"
}

Texto OCR local, se ajudar:
${String(ocrText || '').slice(0, 4000)}
`.trim();
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
