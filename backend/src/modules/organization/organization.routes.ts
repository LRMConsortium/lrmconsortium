import { Router } from 'express';
import { OrganizationController } from './organization.controller';

const router = Router();

// POST /organizations
router.post('', OrganizationController.create);


export default router;
