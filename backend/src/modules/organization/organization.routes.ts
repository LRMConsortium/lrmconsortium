import { Router } from 'express';
import { OrganizationController } from './organization.controller';
import { auditTrail } from '../../middleware/auditTrail.js';

const router = Router();

// POST /organizations
router.post('', auditTrail('organization'), OrganizationController.create);


export default router;
