import { asyncHandler, ok } from "../../shared/http.js";
import { seedHQExecutives } from "./hqinit.executives.service.js";

export const seedHQExecutivesController = asyncHandler(async (req, res) => {
  const { hqId } = req.body;

  const result = await seedHQExecutives({ hqId });

  ok(res, {
    success: true,
    data: result,
  });
});
