export function cleanKey(value = '') {
  return String(value).replace(/\D/g, '');
}

export function maskKey(value = '') {
  const clean = cleanKey(value);
  if (clean.length <= 10) return clean;
  return `${clean.slice(0, 6)}...${clean.slice(-4)}`;
}

