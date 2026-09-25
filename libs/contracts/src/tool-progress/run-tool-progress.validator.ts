import { z } from "zod";

import { RunToolProgressPhases, type RunToolProgress } from "./run-tool-progress.types";

/** Rejects unknown phases and all added fields at the public tool-progress boundary. */
export const ___RunToolProgressSchema: z.ZodType<RunToolProgress> = z.object({ phase: z.nativeEnum(RunToolProgressPhases) }).strict();
