import type { Request } from "express";
import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import type { AutoRoutingConfig, ModelRoutingDefault } from "@opencrane/contracts";

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

/** Closed result from the provider-owned durable global-default command path. */
export type GlobalModelRoutingDefaultCommandResult =
	| { readonly status: "succeeded"; readonly value: ModelRoutingDefault }
	| { readonly status: "busy"; readonly commandId: string | null }
	| { readonly status: "pending"; readonly commandId: string };

/** Narrow port that keeps Global default selection and LiteLLM `auto` reconciliation under one authority. */
export interface GlobalModelRoutingDefaultCommandPort
{
	/** Persists the selection and delivers its exact durable alias command. */
	upsert(caller: ModelRoutingCaller, command: { readonly defaultModel: string; readonly autoConfig: AutoRoutingConfig | null }): Promise<GlobalModelRoutingDefaultCommandResult>;
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
