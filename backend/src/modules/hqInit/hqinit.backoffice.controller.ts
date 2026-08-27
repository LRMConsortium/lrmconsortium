import { asyncHandler, ok } from "../../shared/http.js";
import { seedBackOffice } from "./hqinit.backoffice.service.js";

export const seedBackOfficeController = asyncHandler(async (req, res) => {
  const { hqId, regionCode } = req.body;

  const result = await seedBackOffice({
    hqId,
    regionCode,
  });

  ok(res, {
    success: true,
    data: result,
  });
});
