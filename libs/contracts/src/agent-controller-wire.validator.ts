import { z } from "zod";

/** The field rules both the run-attempt and skill-workload controller validators build on, so the two APIs cannot drift apart on what an id or an instant looks like. */

/** Return whether one value is a bounded, non-empty identifier without ASCII control characters. */
function _IsBoundedIdentifier(value: unknown): value is string
{
	return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Return whether one value is a positive JavaScript-safe integer. */
function _IsPositiveInteger(value: unknown): value is number
{
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Return whether one value is a canonical UTC millisecond instant. */
function _IsMillisecondInstant(value: unknown): value is string
{
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
	const epochMilliseconds = Date.parse(value);
	return Number.isSafeInteger(epochMilliseconds) && new Date(epochMilliseconds).toISOString() === value;
}

/** Return whether one value is a valid opaque identifier for an agent-controller command. */
export function ___IsAgentControllerIdentifier(value: unknown): value is string
{
	return _IsBoundedIdentifier(value);
}

/** Shared schema for identifiers crossing the private agent-controller API. */
export const _AgentControllerBoundedIdentifierSchema = z.custom<string>(_IsBoundedIdentifier, { message: "must be a bounded identifier" });

/** Shared schema for positive counters crossing the private agent-controller API. */
export const _AgentControllerPositiveIntegerSchema = z.custom<number>(_IsPositiveInteger, { message: "must be a positive integer" });

/** Shared schema for canonical database instants crossing the private agent-controller API. */
export const _AgentControllerMillisecondInstantSchema = z.custom<string>(_IsMillisecondInstant, { message: "must be a UTC millisecond instant" });

/** Empty server-owned claim command; strictness rejects caller-selected extensions. */
const _EmptyCommandSchema = z.object({}).strict();

/** Parse against a Zod model, keeping the failing field path so an HTTP adapter can report which field was wrong. */
export function _ParseAgentControllerModel<T>(schema: z.ZodType<T>, value: unknown, sourceName: string): T
{
	const parsed = schema.safeParse(value);
	if (parsed.success) return parsed.data;
	const issue = parsed.error.issues[0];
	if (!issue) throw new Error(`${sourceName} failed validation`);
	const path = issue.path.length === 0 ? sourceName : `${sourceName}.${issue.path.join(".")}`;
	throw new Error(`${path} ${issue.message}`);
}

/** Safely parse one strict command model for an HTTP 400 boundary. */
export function _ParseAgentControllerCommand<T>(schema: z.ZodType<T>, value: unknown): T | null
{
	const parsed = schema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

/** Return whether a claim request body is empty. A claim carries no caller-supplied fields, so any field at all means the request is malformed. */
export function ___IsEmptyAgentControllerCommand(value: unknown): boolean
{
	return _EmptyCommandSchema.safeParse(value).success;
}
