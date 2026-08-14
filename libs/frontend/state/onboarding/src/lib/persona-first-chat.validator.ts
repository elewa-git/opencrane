import { z } from "zod";

import { ___ParsePersonaFirstChatSnapshot, UserOnboardingRouteStates, type PersonaFirstChatSnapshot } from "@opencrane/models/user-onboarding";

import type { UserOnboardingRouteSnapshot } from "./persona-first-chat.types";

/**
 * Guards the boundary where an onboarding HTTP response becomes something this library will act on.
 *
 * Two shapes arrive from that API and they are checked in two places. The first-chat projection is
 * checked by the model package, because the conversation workspace validates the same value and the two
 * must not drift; this file only calls into it. The route-state response is checked here, because
 * {@link UserOnboardingRouteSnapshot} is a frontend-only type that exists for routing and nothing
 * outside this library reads it.
 *
 * Both functions here refuse rather than repair, so a caller either gets a value it can trust or an
 * error it must surface.
 */

/** Checks the route-state response. It has no transcript and no persona details — only the ids and
 *  timestamps a routing decision needs — so it is cheap enough to read on every navigation. */
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

/**
 * Works out whether a failed answer call is a recoverable conflict, and if so recovers the chat it
 * carries.
 *
 * The server returns 409 with the current chat in the body when the same conversation moved on
 * elsewhere — another tab, or a retry after a response was lost. That is not really a failure: the right
 * response is to adopt the chat returned here and show the user the question the server is actually on,
 * which is what `PersonaFirstChatConflictError` exists to carry.
 *
 * This is why it returns null rather than throwing. Anything that is not one of the two documented
 * conflict bodies is somebody else's error — a 500, a network failure, an unrelated 400 — and must keep
 * travelling as one. A chat that fails the model's own checks is also treated as not-a-conflict, because
 * adopting an inconsistent chat would put a broken conversation on screen instead of an honest failure.
 *
 * Called by: OpenCranePersonaFirstChatGateway.answer, on the error branch before it falls through to the
 * generic failure message.
 *
 * @param value - The error body from the answer call, whatever shape it turned out to be.
 * @returns The server's current chat when the body is a documented conflict and the chat is valid;
 *   otherwise null, meaning the caller should handle the error normally.
 * @see PersonaFirstChatConflictError
 */
export function _ParsePersonaFirstChatConflictSnapshot(value: unknown): PersonaFirstChatSnapshot | null
{
	const envelope = z.object({ error: z.enum(["onboarding_chat_idempotency_conflict", "onboarding_chat_state_conflict"]), chat: z.unknown() }).strip().safeParse(value);
	if (!envelope.success) return null;
	try { return ___ParsePersonaFirstChatSnapshot(envelope.data.chat); }
	catch { return null; }
}

/**
 * Turns an untrusted `GET /api/v1/me/onboarding` response into a {@link UserOnboardingRouteSnapshot}, or
 * refuses.
 *
 * This is the value routing decisions are made from, so it is checked before anything is routed on it:
 * an unrecognised state or a malformed timestamp would otherwise send the user to a screen the server
 * does not agree they are on. Unknown properties are dropped, so a new server field does not break a
 * deployed client.
 *
 * Called by: OpenCranePersonaFirstChatGateway.loadRouteState, which backs
 * PersonaOnboardingStore.resolveReadyRoute after the persona is approved.
 *
 * @param value - The decoded response body, or anything at all; no shape is assumed.
 * @returns The route state, safe to branch on and to route from.
 * @throws Error when the response does not match the route shape. Callers turn this into a retryable
 *   message rather than a dead end, because the route can be loaded again.
 */
export function _ParseUserOnboardingRouteSnapshot(value: unknown): UserOnboardingRouteSnapshot
{
	const parsed = _RouteSnapshotSchema.safeParse(value);
	if (parsed.success) return parsed.data;
	throw new Error("The onboarding authority returned an invalid route-state projection.");
}
