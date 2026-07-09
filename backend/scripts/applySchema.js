import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL nao configurada.');
  process.exit(1);
}

const schemaPath = path.resolve('../database/schema.sql');
const sql = fs.readFileSync(schemaPath, 'utf8');
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

try {
  await client.connect();
  await client.query(sql);
  console.log('Schema aplicado com sucesso.');
} finally {
  await client.end();
}
