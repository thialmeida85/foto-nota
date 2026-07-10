import { Router } from 'express';
import {
  createNota,
  deleteNotSentNotas,
  getNextPendente,
  listNotas,
  statsNotas,
  updateStatus
} from '../services/notasRepository.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    res.json(await listNotas(req.query.status));
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const nota = await createNota(req.body);
    res.status(201).json(nota);
  } catch (error) {
    next(error);
  }
});

router.get('/stats', async (_req, res, next) => {
  try {
    res.json(await statsNotas());
  } catch (error) {
    next(error);
  }
});

router.get('/next', async (_req, res, next) => {
  try {
    res.json(await getNextPendente());
  } catch (error) {
    next(error);
  }
});

router.delete('/not-sent', async (_req, res, next) => {
  try {
    const total = await deleteNotSentNotas();
    res.json({ ok: true, total });
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/status', async (req, res, next) => {
  try {
    res.json(await updateStatus(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
});

export default router;
