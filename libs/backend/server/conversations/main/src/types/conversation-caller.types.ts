/**
 * Who the caller is, as the server worked it out from the browser session.
 *
 * The router builds this itself from the session cookie and the request host — it is never
 * read from the request body, query string, or a header, so a client cannot ask to act as a
 * different user or in a different silo. Every method on {@link ConversationUnitOfWork} takes
 * one of these as its first argument, and the database layer re-checks the membership behind
 * it on each call rather than trusting it once at login.
 *
 * Called by: `_resolveCaller` in prisma-self-conversations.router.ts (built from
 * `_ResolveRequestPrincipal`), then passed through `__CreateSelfConversationsRouter`.
 */
export interface ConversationCaller
{
	/** ClusterTenant (silo) the request host resolves to; scopes every read and write below it. */
	readonly siloId: string;
	/** Durable local Principal resolved from the verified issuer and subject. */
	readonly principalId: string;
	/** The user's OIDC `sub`, already verified by the session layer; matched against conversation participant rows. */
	readonly subjectId: string;
	/** Verified OIDC issuer that namespaces the subject for Principal resolution. */
	readonly issuer: string;
}
