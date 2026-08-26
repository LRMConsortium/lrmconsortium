import { asyncHandler, ok } from "../../shared/http.js";
import { attachFounderToHQ } from "./hqinit.attach.service.js";

export const attachFounderToHQController = asyncHandler(async (req, res) => {
  const { hqId, founderProfileId } = req.body;

  const result = await attachFounderToHQ({ hqId, founderProfileId });

  ok(res, {
    success: true,
    data: result,
  });
});
