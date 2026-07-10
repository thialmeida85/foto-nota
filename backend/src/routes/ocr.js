import { Router } from 'express';
import { extractNotaWithGroq } from '../services/groqVision.js';

const router = Router();

router.post('/groq', async (req, res, next) => {
  try {
    const result = await extractNotaWithGroq(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
