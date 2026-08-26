import { Router } from "express";
import { initHQController } from "./hqinit.controller.js";
import { attachFounderToHQController } from "./hqinit.attach.controller.js";
import { seedHQExecutivesController } from "./hqinit.executives.controller.js";

const router = Router();

router.post("/init", initHQController);

router.post("/seed-executives", seedHQExecutivesController);

// ⭐ Add this new route
router.post("/attach-founder", attachFounderToHQController);

export default router;
