import { Request, Response } from "express";
import { initHQSchema } from "./hqinit.validation.js";
import * as hqInitService from "./hqinit.service.js";

export const initHQController = async (req: Request, res: Response) => {
  try {
    const parsed = initHQSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Record failed validation",
          details: parsed.error.errors.map((err) => ({
            field: err.path.join("."),
            message: err.message,
          })),
        },
      });
    }

    const { organizationId, founderProfileId } = parsed.data;

    const result = await hqInitService.initHQ({
      organizationId,
      founderProfileId,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });

  } catch (error) {
    console.error("HQ Init Error:", error);

    return res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred during HQ initialization.",
        details: error instanceof Error ? error.message : error,
      },
    });
  }
};
