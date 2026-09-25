import { z } from "zod";

import type { CompanyAssistantToolsCommand } from "./company-assistant-provisioning.types";

/** Validates explicit setup choices while rejecting identity, execution policy and duplicate grant targets. */
export const ___CompanyAssistantProvisioningSchema = z.object({
	name: z.string().min(1).max(120).refine(value => value === value.trim() && value.length > 0),
	modelDefinitionId: z.string().min(1).max(200).refine(value => value === value.trim() && value.length > 0),
	invokerPrincipalIds: z.array(z.string().min(1).max(200).refine(value => value === value.trim() && value.length > 0)).min(1).max(100).refine(values => new Set(values).size === values.length),
}).strict();

/** Bounds a complete tool replacement and rejects identity, credential and execution-policy input. */
export const ___CompanyAssistantToolsSchema: z.ZodType<CompanyAssistantToolsCommand> = z.object({
	expectedActiveRevisionId: z.string().min(1).max(200).refine(value => value === value.trim()),
	toolRevisionIds: z.array(z.string().min(1).max(200).refine(value => value === value.trim())).max(32).refine(values => new Set(values).size === values.length),
}).strict();
