import { HQInit } from "../../models/HQInit.js";

export const seedHQExecutives = async ({
  hqId,
}: {
  hqId: string;
}) => {
  const hq = await HQInit.findById(hqId);
  if (!hq) {
    throw new Error("HQ not found");
  }

  const executives = [
    {
      code: "COE",
      title: "Chief Operations Executive",
      clearance: "EXECUTIVE_TIER",
    },
    {
      code: "CCE",
      title: "Chief Compliance Executive",
      clearance: "EXECUTIVE_TIER",
    },
    {
      code: "CFE",
      title: "Chief Finance Executive",
      clearance: "EXECUTIVE_TIER",
    },
  ];

  const updatedHQ = await HQInit.findByIdAndUpdate(
    hqId,
    {
      $set: {
        executives,
      },
    },
    { new: true }
  );

  return updatedHQ;
};
