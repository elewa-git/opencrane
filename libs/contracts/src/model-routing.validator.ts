import { z } from "zod";

import { AutoRoutingObjective, ModelRoutingScope, type AutoRoutingConfig, type ModelRoutingDefaultWrite } from "./model-routing.types.js";

/**
 * Public model-routing request validation lives beside the shared wire model so the browser, HTTP
 * adapter, and persistence path cannot acquire separate accepted field lists.
 */

/** Return whether one optional model identifier contains a non-whitespace character. */
function _IsNonBlank(value: string | undefined): boolean
{
	return typeof value === "string" && value.trim().length > 0;
}

/** Auto-routing configuration with typed known fields and deliberate extension preservation. */
const _AutoRoutingConfigSchema: z.ZodType<AutoRoutingConfig> = z.object({
	objective: z.nativeEnum(AutoRoutingObjective),
	costQualitySlider: z.number().min(0).max(10).optional(),
	qualityFloor: z.number().optional(),
	maxBudgetUsd: z.number().nonnegative().optional(),
	allowedModels: z.array(z.string()).optional(),
	latencyCeilingMs: z.number().nonnegative().optional(),
	fallbacks: z.array(z.string()).optional(),
	sessionPin: z.boolean(),
	explorationRate: z.number().min(0).max(1),
}).passthrough();

/** Exact public write command plus its scope and non-empty-default invariants. */
export const ___ModelRoutingDefaultWriteSchema: z.ZodType<ModelRoutingDefaultWrite> = z.object({
	scope: z.nativeEnum(ModelRoutingScope).optional(),
	clusterTenant: z.string().optional(),
	defaultModel: z.string().optional(),
	autoConfig: _AutoRoutingConfigSchema.nullable().optional(),
}).strict().superRefine(function _ValidateWrite(write, context)
{
	const scope = write.scope ?? ModelRoutingScope.Global;
	if (scope === ModelRoutingScope.ClusterTenant && !_IsNonBlank(write.clusterTenant))
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["clusterTenant"], message: "clusterTenant is required for a ClusterTenant default", params: { publicMessage: "A cluster tenant is required for this scope." } });
	}
	const hasDefaultModel = _IsNonBlank(write.defaultModel);
	const hasAutoConfig = write.autoConfig !== undefined && write.autoConfig !== null;
	if (!hasDefaultModel && !hasAutoConfig)
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["defaultModel"], message: "defaultModel or autoConfig is required", params: { publicMessage: "Provide a default model or auto-routing configuration." } });
	}
});
