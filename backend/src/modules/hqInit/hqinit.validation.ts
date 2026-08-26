import { z } from "zod";

export const initHQSchema = z.object({
  organizationId: z.string().min(1),
  founderProfileId: z.string().min(1),
});
