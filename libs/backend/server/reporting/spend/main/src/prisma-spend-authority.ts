import { type Prisma, type PrismaClient } from "@prisma/client";

import { PrismaAuthorizationAuthority, type AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { AccountBudgetSetting, BudgetSetting, BudgetSettingWrite, SpendAuthority, SpendAuthorizationAuthorityFactory, SpendRouteCaller, SpendTransactionRepository, TokenUsageCandidate, TokenUsageView } from "./spend.types";

/** Signals that the current Principal lacks organisation spend authority. */
export class SpendAuthorizationError extends Error {}

/** Persists budget settings and reads token-usage candidates inside one operation transaction. */
class PrismaSpendRepository implements SpendTransactionRepository
{
	/** Prisma transaction that owns every repository operation. */
	private readonly transaction: Prisma.TransactionClient;

	/** Stores the transaction supplied by the spend unit of work. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Reads the singleton global monthly budget ceiling. */
	async getGlobalBudget(siloId: string): Promise<BudgetSetting>
	{
		const item = await this.transaction.globalBudgetSetting.findUnique({ where: { siloId_id: { siloId, id: 1 } } });
		return item === null ? { currency: "USD", ceilingAmount: 0 } : { currency: item.currency, ceilingAmount: Number(item.ceilingAmount) };
	}

	/** Creates or replaces the singleton global monthly budget ceiling. */
	async putGlobalBudget(siloId: string, setting: BudgetSettingWrite): Promise<void>
	{
		await this.transaction.globalBudgetSetting.upsert({ where: { siloId_id: { siloId, id: 1 } }, update: setting, create: { siloId, id: 1, ...setting } });
	}

	/** Lists every account-specific budget ceiling in stable account order. */
	async listAccountBudgets(siloId: string): Promise<readonly AccountBudgetSetting[]>
	{
		const accounts = await this.transaction.accountBudgetSetting.findMany({ where: { siloId }, orderBy: { userId: "asc" } });
		return accounts.map(function _MapAccount(item)
		{
			return { userId: item.userId, currency: item.currency, ceilingAmount: Number(item.ceilingAmount) };
		});
	}

	/** Creates or replaces one account-specific budget ceiling. */
	async putAccountBudget(siloId: string, userId: string, setting: BudgetSettingWrite): Promise<void>
	{
		await this.transaction.accountBudgetSetting.upsert({ where: { siloId_userId: { siloId, userId } }, update: setting, create: { siloId, userId, ...setting } });
	}

	/** Removes one account-specific ceiling so the global value applies again. */
	async deleteAccountBudget(siloId: string, userId: string): Promise<void>
	{
		await this.transaction.accountBudgetSetting.deleteMany({ where: { siloId, userId } });
	}

	/** Reads all current token-usage candidates before item authorization. */
	listTokenUsage(siloId: string): Promise<readonly TokenUsageCandidate[]>
	{
		return this.transaction.tokenUsageSnapshot.findMany({ where: { siloId }, select: { id: true, userId: true, inputTokens: true, outputTokens: true, totalTokens: true, currency: true, totalCost: true }, orderBy: { sampledAt: "desc" } });
	}

	/** Reads the singleton global ceiling used by token-usage projection. */
	getGlobalBudgetRow(siloId: string)
	{
		return this.transaction.globalBudgetSetting.findUnique({ where: { siloId_id: { siloId, id: 1 } } });
	}

	/** Reads account ceilings used by token-usage projection. */
	listAccountBudgetRows(siloId: string)
	{
		return this.transaction.accountBudgetSetting.findMany({ where: { siloId } });
	}
}

/** Owns transaction-bound central authorization for spend reads and writes. */
export class PrismaSpendUnitOfWork implements SpendAuthority
{
	/** Root client used only to open operation transactions. */
	private readonly prisma: PrismaClient;
	/** Builds the central authority over each operation transaction. */
	private readonly createAuthorization: SpendAuthorizationAuthorityFactory<Prisma.TransactionClient> | null;

	/** Stores the transaction owner and optional test authority factory. */
	constructor(prisma: PrismaClient, createAuthorization?: SpendAuthorizationAuthorityFactory<Prisma.TransactionClient>)
	{
		this.prisma = prisma;
		this.createAuthorization = createAuthorization ?? null;
	}

	/** Reads the global ceiling after checking current organisation administration. */
	getGlobalBudget(caller: SpendRouteCaller): Promise<BudgetSetting>
	{
		return this._WithAuthority(async function _Get(repository, authorization)
		{
			await _RequireOrganizationAdministration(authorization, caller);
			return repository.getGlobalBudget(caller.siloId);
		});
	}

	/** Writes the global ceiling with decision evidence in the same transaction. */
	putGlobalBudget(caller: SpendRouteCaller, setting: BudgetSettingWrite): Promise<void>
	{
		return this._WithAuthority(async function _Put(repository, authorization)
		{
			await _AdmitOrganizationAdministration(authorization, caller, { operation: "put-global-budget", setting } as unknown as JsonValue);
			await repository.putGlobalBudget(caller.siloId, setting);
		});
	}

	/** Lists account ceilings after checking current organisation administration. */
	listAccountBudgets(caller: SpendRouteCaller): Promise<readonly AccountBudgetSetting[]>
	{
		return this._WithAuthority(async function _List(repository, authorization)
		{
			await _RequireOrganizationAdministration(authorization, caller);
			return repository.listAccountBudgets(caller.siloId);
		});
	}

	/** Writes one account ceiling with decision evidence in the same transaction. */
	putAccountBudget(caller: SpendRouteCaller, userId: string, setting: BudgetSettingWrite): Promise<void>
	{
		return this._WithAuthority(async function _Put(repository, authorization)
		{
			await _AdmitOrganizationAdministration(authorization, caller, { operation: "put-account-budget", userId, setting } as unknown as JsonValue);
			await repository.putAccountBudget(caller.siloId, userId, setting);
		});
	}

	/** Deletes one account ceiling with decision evidence in the same transaction. */
	deleteAccountBudget(caller: SpendRouteCaller, userId: string): Promise<void>
	{
		return this._WithAuthority(async function _Delete(repository, authorization)
		{
			await _AdmitOrganizationAdministration(authorization, caller, { operation: "delete-account-budget", userId });
			await repository.deleteAccountBudget(caller.siloId, userId);
		});
	}

	/** Lists only token-usage rows covered by current exact read grants. */
	listTokenUsage(caller: SpendRouteCaller): Promise<readonly TokenUsageView[]>
	{
		return this._WithAuthority(async function _List(repository, authorization)
		{
			// 1. Read candidates and budget projections through the operation transaction.
			const [usage, globalBudget, accountBudgets] = await Promise.all([repository.listTokenUsage(caller.siloId), repository.getGlobalBudgetRow(caller.siloId), repository.listAccountBudgetRows(caller.siloId)]);

			// 2. Filter every candidate with one shared Principal and grant resolution.
			const resources = usage.map(item => ({ kind: ProductAuthorizationResourceKinds.TokenUsage, id: String(item.id) }));
			const allowed = await authorization.listPrincipalEntitled({ siloId: caller.siloId, principalId: caller.principalId, action: ProductAuthorizationActions.Read, resources, nowEpochMs: Date.now() });
			const allowedIds = new Set(allowed.map(resource => resource.id));
			const budgetByUser = new Map(accountBudgets.map(item => [item.userId, item]));

			// 3. Build the public view only from rows that survived authorization.
			return usage.filter(item => allowedIds.has(String(item.id))).map(function _MapUsage(item): TokenUsageView
			{
				const accountBudget = budgetByUser.get(item.userId);
				const hasGlobalBudget = globalBudget !== null && globalBudget.currency === item.currency;
				let budgetCeiling: number | undefined;
				if (accountBudget?.currency === item.currency)
				{
					budgetCeiling = Number(accountBudget.ceilingAmount);
				}
				else if (hasGlobalBudget)
				{
					budgetCeiling = Number(globalBudget.ceilingAmount);
				}
				return { userId: item.userId, inputTokens: item.inputTokens, outputTokens: item.outputTokens, totalTokens: item.totalTokens, currency: item.currency, totalCost: Number(item.totalCost), ...(budgetCeiling === undefined ? {} : { budgetCeiling }) };
			});
		});
	}

	/** Binds spend persistence and the central authority to one Prisma transaction. */
	private _WithAuthority<Result>(operation: (repository: PrismaSpendRepository, authorization: AuthorizationAuthority) => Promise<Result>): Promise<Result>
	{
		const createAuthorization = this.createAuthorization;
		return this.prisma.$transaction(async function _Run(transaction)
		{
			const repository = new PrismaSpendRepository(transaction);
			const authorization = createAuthorization === null ? new PrismaAuthorizationAuthority(transaction) : createAuthorization(transaction);
			return operation(repository, authorization);
		});
	}
}

/** Requires the exact organisation administration grant for a protected read. */
async function _RequireOrganizationAdministration(authorization: AuthorizationAuthority, caller: SpendRouteCaller): Promise<void>
{
	const resources = [{ kind: ProductAuthorizationResourceKinds.Organization, id: caller.siloId }] as const;
	const allowed = await authorization.listPrincipalEntitled({ siloId: caller.siloId, principalId: caller.principalId, action: ProductAuthorizationActions.Administer, resources, nowEpochMs: Date.now() });
	if (allowed.length !== 1)
	{
		throw new SpendAuthorizationError("Organisation administration authority is required");
	}
}

/** Admits the exact organisation administration action before a budget write. */
async function _AdmitOrganizationAdministration(authorization: AuthorizationAuthority, caller: SpendRouteCaller, argumentsValue: JsonValue): Promise<void>
{
	const admission = await authorization.admitPrincipal({ siloId: caller.siloId, principalId: caller.principalId, actorKind: "user", actorId: caller.principalId, resource: { kind: ProductAuthorizationResourceKinds.Organization, id: caller.siloId }, action: ProductAuthorizationActions.Administer, argumentsDigest: ___DigestCanonicalJson(argumentsValue), nowEpochMs: Date.now() });
	if (admission.outcome !== AuthorizationDecisionOutcomes.Allow)
	{
		throw new SpendAuthorizationError("Organisation administration authority is required");
	}
}
