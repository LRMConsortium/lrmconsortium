import { Router } from "express";
import { initHQController } from "./hqinit.controller.js";
import { attachFounderToHQController } from "./hqinit.attach.controller.js";
import { seedHQExecutivesController } from "./hqinit.executives.controller.js";
import { declareRegionController } from "./hqinit.region.controller.js";
import { seedRegionManagersController } from "./hqinit.regionManagers.controller.js";
import { seedBackOfficeController } from "./hqinit.backoffice.controller.js";
import { activateRentalSurfaceController } from "./hqinit.rentalSurface.controller.js";
import { onboardPropertyController } from "./hqinit.propertyOnboarding.controller.js";
const router = Router();
router.post("/seed-region-managers", seedRegionManagersController);
router.post("/seed-backoffice", seedBackOfficeController);
router.post("/activate-rental-surface", activateRentalSurfaceController);
router.post("/onboard-property", onboardPropertyController);
router.post("/declare-region", declareRegionController);

router.post("/init", initHQController);

router.post("/seed-executives", seedHQExecutivesController);
router.post("/attach-founder", attachFounderToHQController);

export default router;
