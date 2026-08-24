import { z } from "zod";

import { WorkflowPayloadValidationError } from "./workflow-guard.errors";
import type { IWorkflowSiloTaskInput } from "./workflow-guard.types";

/**
 * Matches the one field that lets the workflow guard bind generic task input to its owning silo.
 *
 * The schema checks the stable top-level contract. `_AssertPersistableWorkflowPayload` then checks every
 * retained field, because a passthrough schema intentionally leaves product task fields open.
 */
const _WorkflowSiloTaskInputSchema: z.ZodType<IWorkflowSiloTaskInput> = z.object({
	/** Requires one non-blank canonical identifier without mutating the saved task input. */
	siloId: z.string().min(1).refine(function _HasNoOuterWhitespace(value: string): boolean
	{
		return value === value.trim();
	}, "siloId must not have surrounding whitespace."),
}).passthrough();

/**
 * Parse one generic task input before the workflow engine can replay it into application code.
 *
 * Called by: `WorkflowGuard` for task admission and engine dispatch. `unknown` is intentional at
 * this boundary: generic task input is type-safe in memory but becomes untrusted after storage.
 */
export function _ParseWorkflowSiloTaskInput(input: unknown): IWorkflowSiloTaskInput
{
	const parsed = _WorkflowSiloTaskInputSchema.safeParse(input);
	if (!parsed.success)
	{
		throw new WorkflowPayloadValidationError();
	}
	_AssertPersistableWorkflowPayload(input);
	return parsed.data;
}

/**
 * Reject values and field names that cannot safely cross into workflow storage.
 *
 * Called by: task admission, event delivery, and event receipt. `unknown` is intentional because
 * these values cross an engine boundary; all callers receive the value only after this check.
 */
export function _AssertPersistableWorkflowPayload(value: unknown, seen: WeakSet<object> = new WeakSet<object>()): void
{
	if (value === null || typeof value === "string" || typeof value === "boolean")
	{
		return;
	}
	if (typeof value === "number")
	{
		if (Number.isFinite(value))
		{
			return;
		}
		throw new WorkflowPayloadValidationError();
	}
	if (typeof value !== "object" || seen.has(value))
	{
		throw new WorkflowPayloadValidationError();
	}
	seen.add(value);
	if (Array.isArray(value))
	{
		for (const item of value)
		{
			_AssertPersistableWorkflowPayload(item, seen);
		}
		return;
	}
	if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
	{
		throw new WorkflowPayloadValidationError();
	}
	for (const [fieldName, item] of Object.entries(value))
	{
		if (_LooksLikeCredentialField(fieldName))
		{
			throw new WorkflowPayloadValidationError();
		}
		_AssertPersistableWorkflowPayload(item, seen);
	}
}

/** Return whether a field name could carry a credential that must stay outside task storage. */
function _LooksLikeCredentialField(fieldName: string): boolean
{
	const normalized = fieldName.replaceAll("_", "").replaceAll("-", "").toLowerCase();
	const credentialNames = new Set([
		"password",
		"passwd",
		"secret",
		"token",
		"credential",
		"authorization",
		"apikey",
		"privatekey",
		"accesskey",
		"connectionstring",
		"databaseurl",
		"bearer",
		"cookie",
	]);
	return credentialNames.has(normalized)
		|| normalized.endsWith("token")
		|| normalized.endsWith("secret")
		|| normalized.endsWith("credential")
		|| normalized.endsWith("credentials");
}
