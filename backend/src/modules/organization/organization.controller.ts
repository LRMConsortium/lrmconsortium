import { Request, Response } from 'express';
import { OrganizationService } from './organization.service';

export const OrganizationController = {
  async create(req: Request, res: Response) {
    const org = await OrganizationService.create(req.body);
    return res.json({ success: true, data: org });
  }
};
