import { Router, type RequestHandler } from "express";
import { createRideBookingController } from "./mobility.createRide.controller.js";
import { assignDriverController } from "./mobility.assignDriver.controller.js";
import * as updateRideStatusModule from "./mobility.updateRideStatus.controller.js";
import * as completeRideModule from "./mobility.completeRide.controller.js";
import * as cancelRideModule from "./mobility.cancelRide.controller.js";
import { rideAnalyticsController } from "./mobility.analytics.controller.js";
import { setDriverAvailabilityController } from "./mobility.driverAvailability.controller.js";
import { availableDriversController } from "./mobility.availableDrivers.controller.js";

const getController = <T>(
  module: Record<string, T | undefined> & { default?: T },
  key: string,
): T => {
  const controller = module[key] ?? module.default;

  if (controller === undefined) {
    throw new Error(`Controller "${key}" not found`);
  }

  return controller;
};

const updateRideStatusController = getController(
  updateRideStatusModule,
  "updateRideStatusController",
) as RequestHandler;

const completeRideController = getController(
  completeRideModule,
  "completeRideController",
) as RequestHandler;

const cancelRideController = getController(
  cancelRideModule,
  "cancelRideController",
) as RequestHandler;

const router = Router();

router.post("/create-ride-booking", createRideBookingController);
router.post("/assign-driver", assignDriverController);
router.post("/update-ride-status", updateRideStatusController);
router.post("/complete-ride", completeRideController);
router.post("/cancel-ride", cancelRideController);
router.post("/analytics", rideAnalyticsController);
router.post("/set-driver-availability", setDriverAvailabilityController);
router.post("/available-drivers", availableDriversController);

export default router;
