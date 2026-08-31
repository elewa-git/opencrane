import { z } from "zod";

import { AG_UI_RUN_WAIT_STATE_EVENT, AgUiRunWaitOperations, AgUiRunWaitReasons, AgUiRunWaitSources, type AgUiRunWaitStateEnvelope } from "./ag-ui-projection.types";

/** One bounded identifier that can cross the AG-UI browser boundary. */
const _IdentifierSchema = z.string().min(1).max(256);

/** One display-safe wait entry. */
const _RunWaitSchema = z.object({ id: _IdentifierSchema, reason: z.nativeEnum(AgUiRunWaitReasons) }).strict();

/** Reasons each server authority may place in its own replaceable wait collection. */
const _REASONS_BY_SOURCE: Readonly<Record<AgUiRunWaitSources, ReadonlySet<AgUiRunWaitReasons>>> = {
	[AgUiRunWaitSources.Runtime]: new Set([AgUiRunWaitReasons.ExternalAction]),
	[AgUiRunWaitSources.Participant]: new Set([AgUiRunWaitReasons.ParticipantInput, AgUiRunWaitReasons.Approval, AgUiRunWaitReasons.PersonalMemoryPermission]),
	[AgUiRunWaitSources.Recovery]: new Set([AgUiRunWaitReasons.RecoveryRequired]),
};

/** Strict wire schema shared by every AG-UI wait-state consumer. */
const _RunWaitStateSchema: z.ZodType<AgUiRunWaitStateEnvelope> = z.object({
	version: z.literal(AG_UI_RUN_WAIT_STATE_EVENT),
	runId: _IdentifierSchema,
	source: z.nativeEnum(AgUiRunWaitSources),
	operation: z.nativeEnum(AgUiRunWaitOperations),
	waits: z.array(_RunWaitSchema).max(256),
}).strict().superRefine(function _ValidateAuthority(envelope, context)
{
	if (envelope.operation !== AgUiRunWaitOperations.Replace && envelope.waits.length === 0)
		context.addIssue({ code: "custom", message: "add and remove operations require at least one wait", path: ["waits"] });
	const ids = new Set<string>();
	for (const [index, wait] of envelope.waits.entries())
	{
		if (ids.has(wait.id))
			context.addIssue({ code: "custom", message: "wait identifiers must be unique", path: ["waits", index, "id"] });
		ids.add(wait.id);
		if (!_REASONS_BY_SOURCE[envelope.source].has(wait.reason))
			context.addIssue({ code: "custom", message: "wait reason does not belong to its source", path: ["waits", index, "reason"] });
	}
});

/** Parse one strict server-projected wait envelope, or return null for unowned input. */
export function ___ParseAgUiRunWaitState(value: unknown): AgUiRunWaitStateEnvelope | null
{
	const parsed = _RunWaitStateSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}
