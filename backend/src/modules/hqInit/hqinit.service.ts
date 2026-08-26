import { HQInit } from "../../models/HQInit.js";
import { Organization } from "../../models/Organization.js";

export const initHQ = async ({
  organizationId,
  founderProfileId,
}: {
  organizationId: string;
  founderProfileId: string;
}) => {
  // 1. Fetch the organization (required to generate HQ name)
  const organization = await Organization.findById(organizationId);
  if (!organization) {
    throw new Error("Organization not found");
  }

  // 2. Generate HQ name
  const hqName = `${organization.name} Headquarters`;

  // 3. Seed initial constitutional structure
  const zones = ["FOUNDER_COMMAND_CENTER", "HQ_EXECUTIVE", "BACK_OFFICE"];

  const surfaces = {
    rental: true,
    mobility: true,
    commercial: true,
    advertising: true,
    payment: true,
  };

  const regionStructure = {
    pilotRegion: "CASPER-CENTRAL",
  };

  // 4. Create HQ document
  const hq = await HQInit.create({
    organizationId,
    founderProfileId,
    hqCode: `HQ-${organizationId}`,
    hqName,
    zones,
    surfaces,
    regionStructure,
  });

  return hq;
};
