import { Router } from 'express';
import { createOrganization } from '../controllers/organization.controller';

const router = Router();

router.post('/organizations', createOrganization);

export default router;
