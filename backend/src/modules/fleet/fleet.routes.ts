import { Router } from "express";

import { addVehicleController } from "./fleet.addVehicle.controller.js";
import { assignVehicleToDriverController } from "./fleet.assignVehicleToDriver.controller.js";
import { updateVehicleStatusController } from "./fleet.updateVehicleStatus.controller.js";
import { fleetAnalyticsController } from "./fleet.analytics.controller.js";

const router = Router();

router.post("/add-vehicle", addVehicleController);
router.post("/assign-vehicle", assignVehicleToDriverController);
router.post("/update-vehicle-status", updateVehicleStatusController);
router.post("/analytics", fleetAnalyticsController);

export default router;
