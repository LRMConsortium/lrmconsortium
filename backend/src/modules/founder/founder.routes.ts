import { Router } from 'express';
import {
  getFounderMe,
  getFounderById,
  updateFounderMe,
  updateFounderById,
  deleteFounderById,
  restoreFounderById,
} from './founder.controller.js';

const router = Router();

// READ
router.get('/me', getFounderMe);
router.get('/:founderId', getFounderById);

// UPDATE
router.patch('/me', updateFounderMe);
router.patch('/:founderId', updateFounderById);

// DELETE
router.delete('/:founderId', deleteFounderById);

// RESTORE
router.post('/:founderId/restore', restoreFounderById);

export default router;
