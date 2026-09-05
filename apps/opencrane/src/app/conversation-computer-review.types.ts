import type { Request } from "express";

/** Dependencies required to authorize and reach one active conversation computer review plane. */
export interface ConversationComputerReviewRouterOptions
{
	/** Resolves one currently authorized active sandbox route from projection and canonical history. */
	readonly authority: ConversationComputerReviewAuthority;
	/** Names the release-owned namespace that may contain assigned sandbox Services. */
	readonly sandboxNamespace: string;
	/** Performs the fixed upstream exchange; tests replace it without opening a socket. */
	readonly fetch?: typeof fetch;
}

/** Resolves the authenticated public request without accepting caller identity from its payload. */
export type ConversationComputerReviewPrincipalResolver = (request: Request) => { readonly externalSubject: string; readonly principalId: string; readonly siloId: string } | null;

/** Current authenticated participant coordinates used by review-route admission. */
export interface ConversationComputerReviewCaller
{
	/** Stable local principal checked by central product authorization. */
	readonly principalId: string;
	/** Identity-provider subject checked against active conversation participation. */
	readonly subjectId: string;
	/** Silo selected from the trusted public request host. */
	readonly siloId: string;
}

/** Fixed upstream coordinates derived from one current active lease. */
export interface ConversationComputerReviewRoute
{
	/** High-entropy current lease identifier used as the private gateway credential. */
	readonly leaseId: string;
	/** Controller-owned Sandbox name used only after DNS-label validation. */
	readonly sandboxId: string;
}

/** Authorizes participant access and resolves the current generation-fenced sandbox. */
export interface ConversationComputerReviewAuthority
{
	/** Return the current review route, or null when the conversation is not available to this caller. */
	resolve(caller: ConversationComputerReviewCaller, conversationId: string): Promise<ConversationComputerReviewRoute | null>;
}
