import { Request, Response } from 'express';
import { Organization } from '../models/Organization';

export const createOrganization = async (req: Request, res: Response) => {
  try {
    const org = await Organization.create(req.body);
    return res.status(201).json({
      success: true,
      data: org
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error'
    });
  }
};
