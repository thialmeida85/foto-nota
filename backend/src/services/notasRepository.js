import { query } from './db.js';
import { cleanKey } from '../utils/mask.js';
import { isValidAccessKey } from '../utils/fiscalKey.js';

export async function listNotas(status) {
  const params = [];
  let where = '';

  if (status) {
    params.push(status);
    where = 'WHERE status = $1';
  }

  const { rows } = await query(
    `SELECT id, chave_nfe, tipo, status, origem, mensagem_erro, tentativas, created_at, updated_at, sent_at
     FROM notas_fiscais
     ${where}
     ORDER BY created_at DESC
     LIMIT 100`,
    params
  );
  return rows;
}

export async function createNota({ chave_nfe, tipo, origem = 'celular', ocr_texto = null }) {
  const chaveLimpa = cleanKey(chave_nfe);
  if (!chaveLimpa) {
    const error = new Error('A chave nao pode ficar vazia.');
    error.status = 400;
    throw error;
  }

  if (['NFE', 'NFCE'].includes(tipo) && !isValidAccessKey(chaveLimpa)) {
    const error = new Error('Chave NF-e/NFC-e invalida. Confira os 44 digitos antes de salvar.');
    error.status = 400;
    error.publicMessage = error.message;
    throw error;
  }

  try {
    const { rows } = await query(
      `INSERT INTO notas_fiscais (chave_nfe, tipo, origem, ocr_texto)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [chaveLimpa, tipo || 'DESCONHECIDO', origem || 'celular', ocr_texto || null]
    );
    return rows[0];
  } catch (error) {
    if (error.code === '23505') {
      error.status = 409;
      error.publicMessage = 'Chave ja cadastrada.';
    }
    throw error;
  }
}

export async function statsNotas() {
  const { rows } = await query(
    `SELECT status, COUNT(*)::int AS total
     FROM notas_fiscais
     GROUP BY status`
  );

  return {
    pendente: 0,
    processando: 0,
    enviada: 0,
    erro: 0,
    ...Object.fromEntries(rows.map((row) => [row.status, row.total]))
  };
}

export async function getNextPendente() {
  const { rows } = await query(
    `SELECT *
     FROM notas_fiscais
     WHERE status = 'pendente'
     ORDER BY created_at ASC
     LIMIT 1`
  );
  return rows[0] || null;
}

export async function updateStatus(id, { status, mensagem_erro = null, sent_at = null, incrementTentativas = false }) {
  const allowed = new Set(['pendente', 'processando', 'enviada', 'erro']);
  if (!allowed.has(status)) {
    const error = new Error('Status invalido.');
    error.status = 400;
    throw error;
  }

  const { rows } = await query(
    `UPDATE notas_fiscais
     SET status = $2,
         mensagem_erro = $3,
         sent_at = $4,
         tentativas = tentativas + $5
     WHERE id = $1
     RETURNING *`,
    [id, status, mensagem_erro, sent_at, incrementTentativas ? 1 : 0]
  );

  if (!rows[0]) {
    const error = new Error('Nota nao encontrada.');
    error.status = 404;
    throw error;
  }

  return rows[0];
}

export async function reprocessErrors() {
  const { rowCount } = await query(
    `UPDATE notas_fiscais
     SET status = 'pendente', mensagem_erro = NULL
     WHERE status = 'erro'`
  );
  return rowCount;
}

export async function deleteNotSentNotas() {
  const { rowCount } = await query(
    `DELETE FROM notas_fiscais
     WHERE status IN ('pendente', 'processando', 'erro')`
  );
  return rowCount;
}
