import type { AuthorizationAuthority } from "./authorization-authority.types";

/** Constructs central authorization over one fresh Serializable transaction attempt. */
export type PrismaAuthorizationTransactionAuthorityFactory<Transaction> = (transaction: Transaction) => AuthorizationAuthority;

/**
 * Runs one complete database-only protected operation inside a fresh Serializable transaction.
 *
 * The callback must not perform a network, filesystem, Kubernetes, provider, or other effect that
 * can survive a database rollback, because a P2034 repeats the callback from its first read.
 */
export type PrismaAuthorizationTransactionWork<Transaction, Result> = (transaction: Transaction, authorization: AuthorizationAuthority) => Promise<Result>;

/** Owns the bounded Serializable transaction used by database-only protected operations. */
export interface PrismaAuthorizationTransactionRunner<Transaction>
{
	/** Runs one database-only operation with a fresh authority on every safe retry. */
	run<Result>(work: PrismaAuthorizationTransactionWork<Transaction, Result>, createAuthorization?: PrismaAuthorizationTransactionAuthorityFactory<Transaction>): Promise<Result>;
}
