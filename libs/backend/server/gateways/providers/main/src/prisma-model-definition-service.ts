import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import { GeneratedOutputCapability, ModelRoutingScope, type ModelDefinition } from "@opencrane/contracts";

import { ___DoWithTrace } from "@opencrane/backend/observability";
import { ___RunSerializableAuthorizationTransaction, type AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import { ProviderGatewayAuthorizationError, type ProviderGatewayAuthorizationFactory, type ProviderGatewayCaller } from "./provider-gateway-authority.types";
import { _GrantProviderResourceCreatorUse, _RequireProviderGatewayAdministration } from "./provider-gateway-authorization";
import { _PROVIDER_EFFECT_EXECUTOR_PROFILE } from "./provider-effect-command-composition";
import { _RequireProviderEffectAdmission } from "./provider-effect-command-http";
import { ProviderEffectCommandKinds, ProviderEffectExecutionStatuses, ProviderEffectMaterialRequirements, type ProviderEffectCommandExecutor, type ProviderEffectCommandRepository, type ProviderEffectExecutionContext, type ProviderEffectResourceBlocker } from "./provider-effect-command.types";
import { _CreateProviderEffectCommandRepository } from "./provider-effect-command-repository.factory";
import { _ByokProviderConnectionId } from "./provider-resource-identity";
import type { ModelDefinitionCreationResult, ModelDefinitionRegistrationResult, ModelDefinitionService, ModelDefinitionValidationFailure, ValidatedModelDefinitionWrite } from "./model-definition-service.types";
import { _ValidateModelDefinitionWrite } from "./model-definition-write.validator";
import type { ModelDefinitionRecord, ModelDefinitionRepository } from "./model-definition-repository.types";
import { PrismaModelDefinitionRepository } from "./prisma-model-definition-repository";

/** Credential coordinates safe to freeze into one durable model-registration command. */
interface _ResolvedCredential
{
	readonly secretRef: string | null;
	readonly litellmCredentialName: string | null;
	readonly provider: string | null;
}

/** Owns model-definition queries and durable create/resume orchestration outside Express. */
export class PrismaModelDefinitionUnitOfWork implements ModelDefinitionService
{
	/** Root database client that opens each authorization-bound transaction. */
	private readonly prisma: PrismaClient;
	/** Application-owned executor shared with background reconciliation. */
	private readonly effectExecutor: ProviderEffectCommandExecutor;
	/** Optional test or application authorization factory. */
	private readonly createAuthorization: ProviderGatewayAuthorizationFactory<Prisma.TransactionClient> | null;

	/** Bind model operations to the product database and injected durable executor. */
	constructor(prisma: PrismaClient, effectExecutor: ProviderEffectCommandExecutor, createAuthorization?: ProviderGatewayAuthorizationFactory<Prisma.TransactionClient>)
	{
		this.prisma = prisma;
		this.effectExecutor = effectExecutor;
		this.createAuthorization = createAuthorization ?? null;
	}

	/** List model definitions readable by one exact Principal in one exact silo. */
	async list(caller: ProviderGatewayCaller, clusterTenant?: string): Promise<readonly ModelDefinition[]>
	{
		return this._Run(async function _List(_transaction, authorization, _effects, repository)
		{
			const candidates = await repository.list(caller.siloId, clusterTenant);
			const entitled = await authorization.listPrincipalEntitled({ siloId: caller.siloId, principalId: caller.principalId, action: ProductAuthorizationActions.Read, resources: candidates.map(function _Resource(row) { return { kind: ProductAuthorizationResourceKinds.ModelDefinition, id: row.id }; }), nowEpochMs: Date.now() });
			const entitledIds = new Set(entitled.map(function _Id(resource) { return resource.id; }));
			return candidates.filter(function _Entitled(row) { return entitledIds.has(row.id); }).map(_ToContract);
		});
	}

	/** Read one model definition only when the caller holds its exact read grant. */
	async get(caller: ProviderGatewayCaller, modelDefinitionId: string): Promise<ModelDefinition | null>
	{
		return this._Run(async function _Get(_transaction, authorization, _effects, repository)
		{
			const candidate = await repository.find(caller.siloId, modelDefinitionId);
			if (candidate === null)
				return null;
			const entitled = await authorization.listPrincipalEntitled({ siloId: caller.siloId, principalId: caller.principalId, action: ProductAuthorizationActions.Read, resources: [{ kind: ProductAuthorizationResourceKinds.ModelDefinition, id: candidate.id }], nowEpochMs: Date.now() });
			return entitled.length === 1 ? _ToContract(candidate) : null;
		});
	}

	/** Validate, admit, persist, and deliver one durable model registration. */
	async create(caller: ProviderGatewayCaller, value: unknown): Promise<ModelDefinitionCreationResult>
	{
		const write = _ValidateModelDefinitionWrite(value);
		if ("error" in write)
			return { status: "invalid", failure: write };
		const commandId = randomUUID();
		const modelDefinitionId = randomUUID();
		const self = this;
		return ___DoWithTrace("provider.model.register", { siloId: caller.siloId, principalId: caller.principalId, commandId, modelDefinitionId }, async function _RegisterModel()
		{
			const admitted = await self._AdmitCreate(caller, commandId, modelDefinitionId, write);
			if ("error" in admitted)
				return { status: "invalid", failure: admitted };
			if ("providerEffectBlocker" in admitted)
				return { status: "busy", blocker: admitted.providerEffectBlocker };
			const delivered = await self.effectExecutor.execute(admitted.commandId, undefined, _EffectContext(caller, admitted.modelDefinitionId));
			if (delivered.status !== ProviderEffectExecutionStatuses.Succeeded)
				return { status: "pending", commandId: admitted.commandId, modelDefinitionId: admitted.modelDefinitionId };
			const created = await self._ReadPersisted(caller, admitted.modelDefinitionId);
			if (created === null)
				throw new Error("completed model registration command has no model definition");
			return { status: "created", model: created };
		});
	}

	/** Retry one exact admitted registration and return only positively finalized state. */
	async resume(caller: ProviderGatewayCaller, modelDefinitionId: string, commandId: string): Promise<ModelDefinitionRegistrationResult>
	{
		const self = this;
		return ___DoWithTrace("provider.model.register.resume", { siloId: caller.siloId, principalId: caller.principalId, commandId, modelDefinitionId }, async function _ResumeRegistration()
		{
			const delivered = await self.effectExecutor.execute(commandId, undefined, _EffectContext(caller, modelDefinitionId));
			if (delivered.status !== ProviderEffectExecutionStatuses.Succeeded && delivered.status !== ProviderEffectExecutionStatuses.AlreadySucceeded)
				return { status: "pending", commandId, modelDefinitionId };
			const model = await self._ReadPersisted(caller, modelDefinitionId);
			return model === null || model.litellmModelId.startsWith("pending:") ? { status: "pending", commandId, modelDefinitionId } : { status: "completed", model };
		});
	}

	/** Commit the pending definition and its authorization-bound registration command together. */
	private _AdmitCreate(caller: ProviderGatewayCaller, commandId: string, modelDefinitionId: string, write: ValidatedModelDefinitionWrite): Promise<{ readonly commandId: string; readonly modelDefinitionId: string } | { readonly providerEffectBlocker: ProviderEffectResourceBlocker } | ModelDefinitionValidationFailure>
	{
		return this._Run(async function _Create(_transaction, authorization, effects, repository)
		{
			const credential = await _ResolveCredential(repository, caller.siloId, write.providerCredentialId, write.clusterTenant);
			if ("error" in credential)
				return credential;
			if (credential.provider !== null)
			{
				const providerEffectBlocker = await effects.findResourceBlocker(caller.siloId, ProductAuthorizationResourceKinds.ProviderConnection, _ByokProviderConnectionId(caller.siloId, credential.provider));
				if (providerEffectBlocker !== null)
					return { providerEffectBlocker };
			}
			const admission = await _RequireProviderGatewayAdministration(authorization, caller, { operation: "create-model-definition", commandId, modelDefinitionId, ...write });
			const model = await repository.create({ id: modelDefinitionId, siloId: caller.siloId, scope: _ToPrismaScope(write.scope), clusterTenant: write.clusterTenant, publicModelName: write.publicModelName, litellmModelId: `pending:${commandId}`, upstreamModel: write.upstreamModel, apiBase: write.apiBase, providerCredentialId: write.providerCredentialId, generatedOutputCapabilities: write.generatedOutputCapabilities });
			await _GrantProviderResourceCreatorUse(authorization, caller, { kind: ProductAuthorizationResourceKinds.ModelDefinition, id: model.id }, new Date());
			const command = _RequireProviderEffectAdmission(await effects.admit({ id: commandId, siloId: caller.siloId, principalId: caller.principalId, payload: { kind: ProviderEffectCommandKinds.RegisterModel, value: { modelDefinitionId: model.id, publicModelName: write.publicModelName, upstreamModel: write.upstreamModel, scope: write.scope, clusterTenant: write.clusterTenant, apiBase: write.apiBase, apiKeyEnvRef: credential.secretRef, litellmCredentialName: credential.litellmCredentialName, routingDefaultId: null, selectedModelDefinitionId: null } }, resourceKind: ProductAuthorizationResourceKinds.ModelDefinition, resourceId: model.id, resourceRevision: commandId, argumentsDigest: admission.argumentsDigest, materialVerifier: null, authorization: admission.evidence, executorProfile: _PROVIDER_EFFECT_EXECUTOR_PROFILE, materialRequirement: ProviderEffectMaterialRequirements.None }));
			return { commandId: command.id, modelDefinitionId: model.id };
		});
	}

	/** Read one final model projection without granting broader catalogue visibility. */
	private _ReadPersisted(caller: ProviderGatewayCaller, modelDefinitionId: string): Promise<ModelDefinition | null>
	{
		const self = this;
		return ___DoWithTrace("provider.model.finalized.read", { siloId: caller.siloId, principalId: caller.principalId, modelDefinitionId }, function _ReadFinalizedModel()
		{
			return self._Run(async function _Read(_transaction, authorization, _effects, repository)
			{
				const row = await repository.find(caller.siloId, modelDefinitionId);
				if (row === null)
					return null;
				const resource = { kind: ProductAuthorizationResourceKinds.ModelDefinition, id: row.id } as const;
				const entitled = await authorization.listPrincipalEntitled({ siloId: caller.siloId, principalId: caller.principalId, action: ProductAuthorizationActions.Read, resources: [resource], nowEpochMs: Date.now() });
				if (entitled.length !== 1)
					throw new ProviderGatewayAuthorizationError();
				return _ToContract(row);
			});
		});
	}

	/** Run one operation with the central serializable authorization retry policy. */
	private _Run<Result>(operation: (transaction: Prisma.TransactionClient, authorization: AuthorizationAuthority, effects: ProviderEffectCommandRepository, models: ModelDefinitionRepository) => Promise<Result>): Promise<Result>
	{
		return ___RunSerializableAuthorizationTransaction(this.prisma, async function _Transaction(transaction, authorization)
		{
			return operation(transaction, authorization, _CreateProviderEffectCommandRepository(transaction), new PrismaModelDefinitionRepository(transaction));
		}, this.createAuthorization ?? undefined);
	}
}

/** Resolve a credential only when it belongs to the model's exact silo and tenant scope. */
async function _ResolveCredential(repository: ModelDefinitionRepository, siloId: string, providerCredentialId: string | null, modelClusterTenant: string | null): Promise<_ResolvedCredential | ModelDefinitionValidationFailure>
{
	if (providerCredentialId === null)
		return { secretRef: null, litellmCredentialName: null, provider: null };
	const credential = await repository.findCredential(siloId, providerCredentialId);
	if (credential === null)
		return { error: "providerCredentialId does not reference an existing credential.", code: "VALIDATION_ERROR" };
	const credentialClusterTenant = credential.scope === "ClusterTenant" ? credential.clusterTenant : null;
	if (credentialClusterTenant !== null && credentialClusterTenant !== modelClusterTenant)
		return { error: "providerCredentialId is owned by a different ClusterTenant.", code: "CREDENTIAL_SCOPE_MISMATCH" };
	return { secretRef: credential.secretRef, litellmCredentialName: credential.litellmCredentialName ?? null, provider: credential.provider };
}

/** Bind delivery to the caller, exact model definition, and control-plane executor profile. */
function _EffectContext(caller: ProviderGatewayCaller, modelDefinitionId: string): ProviderEffectExecutionContext
{
	return { siloId: caller.siloId, principalId: caller.principalId, actorKind: "user", actorId: caller.principalId, resourceKind: ProductAuthorizationResourceKinds.ModelDefinition, resourceId: modelDefinitionId, executorProfile: _PROVIDER_EFFECT_EXECUTOR_PROFILE };
}

/** Project a persisted model-definition row into its contract DTO. */
function _ToContract(row: ModelDefinitionRecord): ModelDefinition
{
	return { id: row.id, scope: row.scope === "ClusterTenant" ? ModelRoutingScope.ClusterTenant : ModelRoutingScope.Global, clusterTenant: row.clusterTenant, publicModelName: row.publicModelName, litellmModelId: row.litellmModelId, upstreamModel: row.upstreamModel, apiBase: row.apiBase, isDefault: row.isDefault, providerCredentialId: row.providerCredentialId, generatedOutputCapabilities: row.generatedOutputCapabilities as GeneratedOutputCapability[], createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

/** Map the public scope spelling to Prisma's enum member. */
function _ToPrismaScope(scope: ModelRoutingScope): "Global" | "ClusterTenant"
{
	return scope === ModelRoutingScope.ClusterTenant ? "ClusterTenant" : "Global";
}
