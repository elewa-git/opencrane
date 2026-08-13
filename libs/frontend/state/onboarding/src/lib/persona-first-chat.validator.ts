import { z } from "zod";

import { ___ParsePersonaFirstChatSnapshot, UserOnboardingRouteStates, type PersonaFirstChatSnapshot } from "@opencrane/models/user-onboarding";

import type { UserOnboardingRouteSnapshot } from "./persona-first-chat.types.js";

/** Route-only response validated beside the frontend route model that consumes it. */
const _RouteSnapshotSchema: z.ZodType<UserOnboardingRouteSnapshot> = z.object({
	workflowVersion: z.number().int().positive(),
	state: z.nativeEnum(UserOnboardingRouteStates),
	personaInterviewId: z.string().min(1).max(256).nullable(),
	personaRevisionId: z.string().min(1).max(256).nullable(),
	bootstrapConversationId: z.string().min(1).max(256).nullable(),
	startedAt: z.string().datetime({ offset: true }),
	updatedAt: z.string().datetime({ offset: true }),
	completedAt: z.string().datetime({ offset: true }).nullable()
}).strip();

/** Validate a documented conflict envelope, then delegate its projection to the owning model. */
export function _ParsePersonaFirstChatConflictSnapshot(value: unknown): PersonaFirstChatSnapshot | null
{
	const envelope = z.object({ error: z.enum(["onboarding_chat_idempotency_conflict", "onboarding_chat_state_conflict"]), chat: z.unknown() }).strip().safeParse(value);
	if (!envelope.success) return null;
	try { return ___ParsePersonaFirstChatSnapshot(envelope.data.chat); }
	catch { return null; }
}

/** Parse one untrusted route-state response used for post-approval navigation. */
export function _ParseUserOnboardingRouteSnapshot(value: unknown): UserOnboardingRouteSnapshot
{
	const parsed = _RouteSnapshotSchema.safeParse(value);
	if (parsed.success) return parsed.data;
	throw new Error("The onboarding authority returned an invalid route-state projection.");
}
