import { FounderProfile } from './founder.model.js';
import { validateFounderProfile } from './founder.validation.js';
import type { Request, Response } from 'express';

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Unknown error';

// 1. CREATE ONE
export const createFounderProfile = async (req: Request, res: Response) => {
  try {
    const errors = validateFounderProfile(req.body);
    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: errors.join(', '),
        },
      });
    }

    const { fullName, founderTitle, email } = req.body;

    const profile = await FounderProfile.create({
      fullName,
      founderTitle,
      email,
      user: (req as Request & { user: { _id: string } }).user._id,
    });

    return res.status(201).json({
      success: true,
      data: {
        founderProfileId: profile._id,
      },
    });
  } catch (error: unknown) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'FOUNDER_PROFILE_CREATION_FAILED',
        message: getErrorMessage(error),
      },
    });
  }
};

// 2. CREATE MULTIPLE
export const createMultipleFounders = async (req: Request, res: Response) => {
  try {
    const { founders } = req.body;

    const userId = req.actor.userId;

    const enrichedFounders = founders.map((f: Record<string, unknown>) => ({
      ...f,
      user: userId,
    }));

    const created = await FounderProfile.insertMany(enrichedFounders);

    return res.status(201).json({
      success: true,
      data: created,
    });
  } catch (error: unknown) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MULTI_CREATE_FAILED',
        message: getErrorMessage(error),
      },
    });
  }
};


// 3. GET ALL FOUNDERS
export const getFounders = async (_req: Request, res: Response) => {
  try {
    const founders = await FounderProfile.find();
    return res.status(200).json({ success: true, data: founders });
  } catch (error: unknown) {
    return res.status(400).json({
      success: false,
      error: { code: 'GET_FOUNDERS_FAILED', message: getErrorMessage(error) },
    });
  }
};

// 4. GET FOUNDER ME
export const getFounderMe = async (req: Request, res: Response) => {
  try {
    const founder = await FounderProfile.findOne({ user: (req as Request & { user: { _id: string } }).user._id });
    return res.status(200).json({ success: true, data: founder });
  } catch (error: unknown) {
    return res.status(400).json({
      success: false,
      error: { code: 'GET_ME_FAILED', message: getErrorMessage(error) },
    });
  }
};

// 5. GET FOUNDER BY ID
export const getFounderById = async (req: Request, res: Response) => {
  try {
    const founder = await FounderProfile.findById(req.params.founderId);
    return res.status(200).json({ success: true, data: founder });
  } catch (error: unknown) {
    return res.status(400).json({
      success: false,
      error: { code: 'GET_BY_ID_FAILED', message: getErrorMessage(error) },
    });
  }
};

// 6. UPDATE FOUNDER ME
export const updateFounderMe = async (req: Request, res: Response) => {
  try {
    const founder = await FounderProfile.findOneAndUpdate(
      { user: (req as Request & { user: { _id: string } }).user._id },
      req.body,
      { new: true }
    );
    return res.status(200).json({ success: true, data: founder });
  } catch (error: unknown) {
    return res.status(400).json({
      success: false,
      error: { code: 'UPDATE_ME_FAILED', message: getErrorMessage(error) },
    });
  }
};

// 7. UPDATE FOUNDER BY ID
export const updateFounderById = async (req: Request, res: Response) => {
  try {
    const founder = await FounderProfile.findByIdAndUpdate(
      req.params.founderId,
      req.body,
      { new: true }
    );
    return res.status(200).json({ success: true, data: founder });
  } catch (error: unknown) {
    return res.status(400).json({
      success: false,
      error: { code: 'UPDATE_BY_ID_FAILED', message: getErrorMessage(error) },
    });
  }
};

// 8. DELETE FOUNDER BY ID
export const deleteFounderById = async (req: Request, res: Response) => {
  try {
    await FounderProfile.findByIdAndDelete(req.params.founderId);
    return res.status(200).json({ success: true });
  } catch (error: unknown) {
    return res.status(400).json({
      success: false,
      error: { code: 'DELETE_FAILED', message: getErrorMessage(error) },
    });
  }
};

// 9. RESTORE FOUNDER BY ID
export const restoreFounderById = async (req: Request, res: Response) => {
  try {
    const founder = await FounderProfile.findByIdAndUpdate(
      req.params.founderId,
      { deleted: false },
      { new: true }
    );
    return res.status(200).json({ success: true, data: founder });
  } catch (error: unknown) {
    return res.status(400).json({
      success: false,
      error: { code: 'RESTORE_FAILED', message: getErrorMessage(error) },
    });
  }
};
