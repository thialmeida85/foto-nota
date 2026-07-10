import crypto from 'node:crypto';

const tokenVersion = 1;

function getAuthConfig() {
  return {
    email: process.env.APP_AUTH_EMAIL || process.env.NOTABE_USERNAME || '',
    password: process.env.APP_AUTH_PASSWORD || process.env.NOTABE_PASSWORD || '',
    secret: process.env.APP_AUTH_SECRET || process.env.APP_AUTH_PASSWORD || process.env.NOTABE_PASSWORD || ''
  };
}

export function authIsConfigured() {
  const { email, password, secret } = getAuthConfig();
  return Boolean(email && password && secret);
}

export function login({ email, password, remember = false }) {
  const config = getAuthConfig();

  if (!authIsConfigured()) {
    const error = new Error('Login do app nao configurado no backend.');
    error.status = 503;
    error.publicMessage = error.message;
    throw error;
  }

  if (String(email || '').trim().toLowerCase() !== config.email.trim().toLowerCase()
    || String(password || '') !== config.password) {
    const error = new Error('Email ou senha invalidos.');
    error.status = 401;
    error.publicMessage = error.message;
    throw error;
  }

  const expiresInMs = remember ? 1000 * 60 * 60 * 24 * 30 : 1000 * 60 * 60 * 12;
  const expiresAt = Date.now() + expiresInMs;
  const payload = {
    v: tokenVersion,
    email: config.email,
    exp: expiresAt
  };

  return {
    token: signPayload(payload, config.secret),
    expiresAt,
    email: config.email
  };
}

export function requireAuth(req, res, next) {
  if (req.path === '/api/health' || req.path.startsWith('/api/auth/')) {
    next();
    return;
  }

  const token = readToken(req);
  if (verifyToken(token)) {
    next();
    return;
  }

  res.status(401).json({ error: 'Login necessario.' });
}

export function verifyToken(token) {
  const { secret } = getAuthConfig();
  if (!token || !secret) return false;

  const [payloadPart, signature] = String(token).split('.');
  if (!payloadPart || !signature) return false;

  const expected = sign(payloadPart, secret);
  if (!safeEqual(signature, expected)) return false;

  try {
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    return payload.v === tokenVersion && Number(payload.exp) > Date.now();
  } catch {
    return false;
  }
}

function readToken(req) {
  const header = req.get('authorization') || '';
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  return req.query?.token || '';
}

function signPayload(payload, secret) {
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${payloadPart}.${sign(payloadPart, secret)}`;
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
