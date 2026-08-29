/**
 * Validates deployment JSON before the skill controller passes a profile to its Job builder.
 * The builder and profile types define the workload contract, so this schema rejects fields that
 * neither one owns instead of letting a controller configuration silently drift.
 */
import { z } from "zod";

import type { SkillWorkloadJobProfile } from "@opencrane/backend/agents/skills/k8s-launcher";


/** Bounds a CPU and memory resource map owned by one workload class profile. */
const _ResourceMapSchema = z.object({
	cpu: z.string().min(1),
	memory: z.string().min(1),
}).strict();

/** Bounds requests and limits before the pure Job builder applies its class policy. */
const _ResourcesSchema = z.object({
	requests: _ResourceMapSchema,
	limits: _ResourceMapSchema,
}).strict();

/** Validates the complete configuration passed to one class-specific governed Job builder. */
const _ProfileSchema = z.object({
	kind: z.enum(["authoring", "tool-runner"]),
	image: z.string().min(1),
	imagePullPolicy: z.enum(["Always", "IfNotPresent", "Never"]),
	serverNamespace: z.string().min(1),
	namespace: z.string().min(1),
	serviceAccountName: z.string().min(1),
	capabilityTokenAudience: z.string().min(1),
	bootstrapUrl: z.string().min(1),
	capabilityTokenPath: z.string().min(1),
	bootstrapReferencePath: z.string().min(1),
	scratchSize: z.string().min(1),
	activeDeadlineSeconds: z.number().int().positive(),
	ttlSecondsAfterFinished: z.number().int().nonnegative(),
	resources: _ResourcesSchema,
}).strict();

/** Parses one bounded profile without deciding whether its key has the matching workload class. */
export function _ParseSkillWorkloadControllerProfile(value: unknown): SkillWorkloadJobProfile | null
{
	const result = _ProfileSchema.safeParse(value);
	if (!result.success)
		return null;
	return result.data;
}
