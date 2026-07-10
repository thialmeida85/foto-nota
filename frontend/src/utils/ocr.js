export function extractFiscalKey(text) {
  const rawText = String(text || '');
  const candidates = collectAccessKeyCandidates(rawText);
  const reliableCandidates = candidates.filter((candidate) => isValidAccessKey(candidate.key) && isPlausibleAccessKey(candidate.key));
  const bestCandidate = reliableCandidates
    .sort((a, b) => b.score - a.score)[0];

  if (bestCandidate) {
    return {
      key: bestCandidate.key,
      tipo: getFiscalKeyType(bestCandidate.key),
      confidence: bestCandidate.reason,
      needsConfirmation: false
    };
  }

  const onlyNumbers = rawText.replace(/\D/g, '');
  const possibleLong = onlyNumbers.match(/\d{35,}/);
  if (possibleLong) {
    return {
      key: possibleLong[0],
      tipo: 'CFE_SAT',
      confidence: 'possible-cfe',
      needsConfirmation: true
    };
  }

  return {
    key: '',
    tipo: 'DESCONHECIDO',
    confidence: 'none',
    needsConfirmation: false
  };
}

function collectAccessKeyCandidates(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidates = new Map();

  function addCandidate(source, score, reason) {
    const normalized = normalizeDigitText(source);
    for (const key of extractWindowsOf44(normalized)) {
      const current = candidates.get(key);
      const bonus = isValidAccessKey(key) ? 100 : 0;
      const next = { key, score: score + bonus, reason };
      if (!current || next.score > current.score) candidates.set(key, next);
    }
  }

  // NFC-e QR codes usually carry the access key after ?p= or &p=.
  for (const match of text.matchAll(/[?&]p\s*=\s*([0-9A-Za-z\s|.-]{44,})/gi)) {
    addCandidate(match[1].split('|')[0], 140, 'qrcode-param');
  }

  lines.forEach((line, index) => {
    const context = removeDiacritics(line).toLowerCase();
    const nextLines = [line, lines[index + 1], lines[index + 2]].filter(Boolean).join(' ');

    if (context.includes('chave') || context.includes('acesso') || context.includes('consulta')) {
      addCandidate(nextLines, 120, 'access-key-context');
    }

    if (context.includes('qrcode') || context.includes('qr code') || context.includes('nfce.fazenda')) {
      addCandidate(nextLines, 110, 'qrcode-line');
    }

    const digitCount = normalizeDigitText(line).replace(/\D/g, '').length;
    const looksLikeGroupedKey = digitCount >= 40 && /(\d[\s.-]){8,}/.test(line);
    if (looksLikeGroupedKey) {
      addCandidate(line, 80, 'grouped-key-line');
    }
  });

  return [...candidates.values()];
}

function normalizeDigitText(value) {
  return String(value)
    .replace(/[Oo]/g, '0')
    .replace(/[Il|]/g, '1')
    .replace(/[Ss]/g, '5')
    .replace(/[Bb]/g, '8');
}

function extractWindowsOf44(value) {
  const digits = value.replace(/\D/g, '');
  const windows = new Set();

  for (let index = 0; index <= digits.length - 44; index += 1) {
    windows.add(digits.slice(index, index + 44));
  }

  return [...windows];
}

function isValidAccessKey(key) {
  if (!/^\d{44}$/.test(key)) return false;

  const expectedDigit = calculateAccessKeyDigit(key.slice(0, 43));
  return expectedDigit === Number(key[43]);
}

function isPlausibleAccessKey(key) {
  if (!/^\d{44}$/.test(key)) return false;

  const stateCode = Number(key.slice(0, 2));
  const month = Number(key.slice(4, 6));
  const model = key.slice(20, 22);

  const validStateCodes = new Set([
    11, 12, 13, 14, 15, 16, 17,
    21, 22, 23, 24, 25, 26, 27,
    28, 29, 31, 32, 33, 35, 41,
    42, 43, 50, 51, 52, 53
  ]);

  return validStateCodes.has(stateCode)
    && month >= 1
    && month <= 12
    && ['55', '65'].includes(model);
}

function calculateAccessKeyDigit(first43Digits) {
  let factor = 2;
  let sum = 0;

  for (let index = first43Digits.length - 1; index >= 0; index -= 1) {
    sum += Number(first43Digits[index]) * factor;
    factor = factor === 9 ? 2 : factor + 1;
  }

  const digit = 11 - (sum % 11);
  return digit >= 10 ? 0 : digit;
}

function getFiscalKeyType(key) {
  const model = key.slice(20, 22);
  if (model === '65') return 'NFCE';
  if (model === '55') return 'NFE';
  return 'DESCONHECIDO';
}

function removeDiacritics(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function maskKey(value = '') {
  const clean = String(value).replace(/\D/g, '');
  if (clean.length <= 10) return clean;
  return `${clean.slice(0, 6)}...${clean.slice(-4)}`;
}
