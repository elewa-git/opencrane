import type { Prisma, PrismaClient } from "@prisma/client";

import { PrismaAuthorizationAuthority, ___RunSerializableAuthorizationTransaction, type AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";

import type { ProviderGatewayAuthorizationFactory, ProviderGatewayUnitOfWork } from "./provider-gateway-authority.types";
import type { ProviderByokRepository } from "./provider-byok-repository.types";
import { _CreateProviderByokRepository } from "./provider-byok-repository.factory";
import { _CreateProviderEffectCommandRepository } from "./provider-effect-command-repository.factory";
import type { ProviderEffectCommandRepository } from "./provider-effect-command.types";

/** Runs provider and model operations inside the transaction that owns authorization evidence. */
export class PrismaProviderGatewayUnitOfWork implements ProviderGatewayUnitOfWork<Prisma.TransactionClient>
{
	/** Root client that opens one protected operation transaction. */
	private readonly prisma: PrismaClient;
	/** Constructs the central authority from the operation transaction. */
	private readonly createAuthorization: ProviderGatewayAuthorizationFactory<Prisma.TransactionClient> | null;

	/** Binds provider and model operations to the product database. */
	constructor(prisma: PrismaClient, createAuthorization?: ProviderGatewayAuthorizationFactory<Prisma.TransactionClient>)
	{
		this.prisma = prisma;
		this.createAuthorization = createAuthorization ?? null;
	}

	/** Builds the provider-effect repository over the exact protected transaction. */
	private _effects(transaction: Prisma.TransactionClient): ProviderEffectCommandRepository
	{
		return _CreateProviderEffectCommandRepository(transaction);
	}

	/** Runs one operation that may contain an external effect without retrying the callback. */
	run<Result>(operation: (transaction: Prisma.TransactionClient, authorization: AuthorizationAuthority, effects: ProviderEffectCommandRepository, byok: ProviderByokRepository) => Promise<Result>): Promise<Result>
	{
		const createAuthorization = this.createAuthorization;
		const effects = this._effects.bind(this);
		return this.prisma.$transaction(async function _Run(transaction): Promise<Result>
		{
			const authorization = createAuthorization === null ? new PrismaAuthorizationAuthority(transaction) : createAuthorization(transaction);
			return operation(transaction, authorization, effects(transaction), _CreateProviderByokRepository(transaction));
		});
	}

	/** Runs one database-only protected mutation with bounded Serializable conflict retries. */
	runDatabaseMutation<Result>(operation: (transaction: Prisma.TransactionClient, authorization: AuthorizationAuthority, effects: ProviderEffectCommandRepository, byok: ProviderByokRepository) => Promise<Result>): Promise<Result>
	{
		const effects = this._effects.bind(this);
		return ___RunSerializableAuthorizationTransaction(this.prisma, async function _Run(transaction, authorization): Promise<Result>
		{
			return operation(transaction, authorization, effects(transaction), _CreateProviderByokRepository(transaction));
		}, this.createAuthorization ?? undefined);
	}
}
