import type { z } from "zod";

import type { PersonalMemoryPermissionPayloadSchema } from "./personal-memory-permission-payload.validator.js";

/** Protected coordinates inferred from the one canonical trust-boundary validator. */
export type PersonalMemoryPermissionPayload = z.infer<typeof PersonalMemoryPermissionPayloadSchema>;
