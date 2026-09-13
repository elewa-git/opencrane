import { z } from "zod";

import type { PersonalAgentToolsCommand } from "./personal-agent-tools.types";

/** Bounds a complete tool replacement and rejects identity, credentials and execution policy. */
export const ___PersonalAgentToolsSchema: z.ZodType<PersonalAgentToolsCommand> = z.object({
	expectedActiveRevisionId: z.string().min(1).max(128).refine(value => value === value.trim()),
	toolRevisionIds: z.array(z.string().min(1).max(128).refine(value => value === value.trim())).max(32).refine(values => new Set(values).size === values.length),
}).strict();
