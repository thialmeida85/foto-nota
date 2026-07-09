import { Router } from 'express';
import { automationRunner } from '../services/automationRunner.js';
import { streamLogs } from '../services/logger.js';
import { reprocessErrors } from '../services/notasRepository.js';

const router = Router();

router.post('/start', async (_req, res, next) => {
  try {
    automationRunner.start();
    res.json({ ok: true, state: automationRunner.getState() });
  } catch (error) {
    next(error);
  }
});

router.post('/pause', (_req, res) => {
  automationRunner.pause();
  res.json({ ok: true, state: automationRunner.getState() });
});

router.post('/stop', async (_req, res, next) => {
  try {
    await automationRunner.stop();
    res.json({ ok: true, state: automationRunner.getState() });
  } catch (error) {
    next(error);
  }
});

router.post('/send-next', async (_req, res, next) => {
  try {
    const result = await automationRunner.sendNextOnce();
    res.json({ ok: true, result, state: automationRunner.getState() });
  } catch (error) {
    next(error);
  }
});

router.post('/reprocess-errors', async (_req, res, next) => {
  try {
    const total = await reprocessErrors();
    res.json({ ok: true, total });
  } catch (error) {
    next(error);
  }
});

router.get('/logs', streamLogs);

export default router;

