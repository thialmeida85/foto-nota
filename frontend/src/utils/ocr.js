export function extractFiscalKey(text) {
  const onlyNumbers = String(text || '').replace(/\D/g, '');
  const match44 = onlyNumbers.match(/\d{44}/);

  if (match44) {
    return {
      key: match44[0],
      tipo: 'NFCE',
      confidence: 'found-44',
      needsConfirmation: false
    };
  }

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

export function maskKey(value = '') {
  const clean = String(value).replace(/\D/g, '');
  if (clean.length <= 10) return clean;
  return `${clean.slice(0, 6)}...${clean.slice(-4)}`;
}

