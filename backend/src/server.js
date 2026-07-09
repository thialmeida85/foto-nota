import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import notasRoutes from './routes/notas.js';
import automacaoRoutes from './routes/automacao.js';
import { query } from './services/db.js';

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, database: 'ok', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ ok: false, database: 'erro', error: error.message });
  }
});

app.use('/api/notas', notasRoutes);
app.use('/api/automacao', automacaoRoutes);

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({
    error: error.publicMessage || 'Erro interno do servidor'
  });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`API pronta em http://0.0.0.0:${port}`);
});

