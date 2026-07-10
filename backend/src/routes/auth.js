import { Router } from 'express';
import { login } from '../services/auth.js';

const router = Router();

router.post('/login', (req, res, next) => {
  try {
    res.json(login(req.body || {}));
  } catch (error) {
    next(error);
  }
});

export default router;
