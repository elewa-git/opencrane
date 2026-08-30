import type { Request } from "express";
import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";

/** Authenticated local Principal that requests provider or model administration. */
export interface ProviderGatewayCaller
{
	/** Silo derived from the trusted request host. */
	readonly siloId: string;
	/** Durable local Principal admitted by authentication middleware. */
	readonly principalId: string;
}

/** Resolves provider-gateway authority only from the authenticated request. */
export type ProviderGatewayCallerResolver = (request: Request) => ProviderGatewayCaller | null;

/** Constructs the central authority over one provider-gateway transaction. */
export type ProviderGatewayAuthorizationFactory<Transaction> = (transaction: Transaction) => AuthorizationAuthority;

/** Opens the transaction shared by provider persistence and central authorization. */
export interface ProviderGatewayUnitOfWork<Transaction>
{
	/** Runs one operation that may contain an external effect without automatic transaction retries. */
	run<Result>(operation: (transaction: Transaction, authorization: AuthorizationAuthority) => Promise<Result>): Promise<Result>;
	/** Runs one database-only mutation at Serializable isolation with bounded P2034 retries. */
	runDatabaseMutation<Result>(operation: (transaction: Transaction, authorization: AuthorizationAuthority) => Promise<Result>): Promise<Result>;
}

/** Signals that the central product authority denied a provider-gateway operation. */
export class ProviderGatewayAuthorizationError extends Error
{
	/** Creates the stable authorization error returned by the HTTP adapter. */
	constructor()
	{
		super("Provider or model operation is not authorized");
		this.name = "ProviderGatewayAuthorizationError";
	}
}
