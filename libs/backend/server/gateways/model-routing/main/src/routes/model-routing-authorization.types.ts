import type { Request } from "express";
import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";

/** Authenticated local Principal that requests organisation routing policy. */
export interface ModelRoutingCaller
{
	/** Silo derived from the trusted request host. */
	readonly siloId: string;
	/** Durable local Principal admitted by authentication middleware. */
	readonly principalId: string;
}

/** Resolves routing-policy authority only from the authenticated request. */
export type ModelRoutingCallerResolver = (request: Request) => ModelRoutingCaller | null;

/** Constructs the central authority over one routing-policy transaction. */
export type ModelRoutingAuthorizationFactory<Transaction> = (transaction: Transaction) => AuthorizationAuthority;

/** Opens the transaction shared by routing-policy persistence and central authorization. */
export interface ModelRoutingUnitOfWork<Transaction>
{
	/** Runs one operation with a transaction-scoped authority over the same client. */
	run<Result>(operation: (transaction: Transaction, authorization: AuthorizationAuthority) => Promise<Result>): Promise<Result>;
}

/** Signals that central product authority denied a routing-policy operation. */
export class ModelRoutingAuthorizationError extends Error
{
	/** Creates the stable denial returned by the HTTP adapter. */
	constructor()
	{
		super("Model routing policy operation is not authorized");
		this.name = "ModelRoutingAuthorizationError";
	}
}
