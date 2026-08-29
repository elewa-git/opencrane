import { ElicitationPurposes, ElicitationRequestStates, type ConversationElicitation } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

import { _ProjectElicitation as _BuildElicitationProjection } from "./elicitation-persistence-mapping";

/** Project a Prisma row after mapping its persistence enums to the public vocabulary. */
export function _Projection(row: { id: string; conversationId: string; runId: string; attempt: number; assignedParticipantId: string; purpose: "RuntimeInput" | "ToolApproval" | "PersonalMemoryPermission" | "A2uiAction"; state: "Requested" | "Answered" | "Declined" | "Expired" | "Cancelled"; body: unknown; requiresStepUp: boolean; createdAt: Date; expiresAt: Date; resolvedAt: Date | null; safeReason: string | null }): ConversationElicitation
{
	return _BuildElicitationProjection({ ...row, body: row.body as JsonValue, purpose: _PublicPurpose(row.purpose), state: _PublicState(row.state) });
}

/** Derive deadline expiry for reads without mutating the stored request. */
export function _ProjectionAt(row: Parameters<typeof _Projection>[0], now: Date): ConversationElicitation
{
	if (row.state !== "Requested" || row.expiresAt.getTime() > now.getTime())
		return _Projection(row);
	return { ..._Projection(row), state: ElicitationRequestStates.Expired, resolvedAt: now.toISOString(), safeReason: "response_window_expired" };
}

/** Map a Prisma purpose to the public vocabulary. */
export function _PublicPurpose(purpose: "RuntimeInput" | "ToolApproval" | "PersonalMemoryPermission" | "A2uiAction"): ElicitationPurposes { return { RuntimeInput: ElicitationPurposes.RuntimeInput, ToolApproval: ElicitationPurposes.ToolApproval, PersonalMemoryPermission: ElicitationPurposes.PersonalMemoryPermission, A2uiAction: ElicitationPurposes.A2uiAction }[purpose]; }

/** Map a Prisma lifecycle state to the public vocabulary. */
export function _PublicState(state: "Requested" | "Answered" | "Declined" | "Expired" | "Cancelled"): ElicitationRequestStates { return { Requested: ElicitationRequestStates.Requested, Answered: ElicitationRequestStates.Answered, Declined: ElicitationRequestStates.Declined, Expired: ElicitationRequestStates.Expired, Cancelled: ElicitationRequestStates.Cancelled }[state]; }

/** Whether one protected purpose payload is a non-array JSON record. */
export function _Record(value: unknown): value is { readonly [key: string]: JsonValue }
{
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
