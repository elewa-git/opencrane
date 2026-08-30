import type { GlobalModelRoutingDefaultCommandPort, GlobalModelRoutingDefaultCommandResult, ModelRoutingCaller } from "@opencrane/backend/server/gateways/model-routing";
import type { AutoRoutingConfig } from "@opencrane/contracts";
import { ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import { ProviderEffectFinalizationBlockedError } from "./provider-effect-command-errors";
import { _PROVIDER_EFFECT_EXECUTOR_PROFILE } from "./provider-effect-command-composition";
import { ProviderEffectExecutionStatuses, type ProviderEffectCommandExecutor } from "./provider-effect-command.types";
import type { ProviderGatewayUnitOfWork } from "./provider-gateway-authority.types";

/** Routes Global default writes through the same durable alias child used by provider setup. */
export class DefaultGlobalModelRoutingDefaultCommandPort implements GlobalModelRoutingDefaultCommandPort
{
	/** Serializable provider transaction that owns selection and child admission. */
	private readonly unitOfWork: ProviderGatewayUnitOfWork<unknown>;
	/** Shared post-commit provider executor. */
	private readonly executor: ProviderEffectCommandExecutor;

	/** Binds routing selection to the one application-root provider executor. */
	constructor(unitOfWork: ProviderGatewayUnitOfWork<unknown>, executor: ProviderEffectCommandExecutor)
	{
		this.unitOfWork = unitOfWork;
		this.executor = executor;
	}

	/** @inheritdoc */
	async upsert(caller: ModelRoutingCaller, command: { readonly defaultModel: string; readonly autoConfig: AutoRoutingConfig | null }): Promise<GlobalModelRoutingDefaultCommandResult>
	{
		const owner = { siloId: caller.siloId, principalId: caller.principalId, executorProfile: _PROVIDER_EFFECT_EXECUTOR_PROFILE } as const;
		const context = { ...owner, actorKind: "user" as const, actorId: caller.principalId, resourceKind: ProductAuthorizationResourceKinds.Organization, resourceId: caller.siloId };
		try
		{
			const admitted = await this.unitOfWork.runDatabaseMutation(function _Admit(_transaction, authorization, effects)
			{
				return effects.reconcileGlobalRoutingDefault(owner, command.defaultModel, command.autoConfig, context, authorization, new Date());
			});
			if (admitted.child === null)
				return { status: "succeeded", value: admitted.value };
			const childContext = { ...context, resourceKind: admitted.child.resourceKind, resourceId: admitted.child.resourceId };
			const delivered = await this.executor.execute(admitted.child.id, undefined, childContext);
			if (delivered.status === ProviderEffectExecutionStatuses.Succeeded || delivered.status === ProviderEffectExecutionStatuses.AlreadySucceeded)
				return { status: "succeeded", value: admitted.value };
			return { status: "pending", commandId: admitted.child.id };
		}
		catch (error)
		{
			if (error instanceof ProviderEffectFinalizationBlockedError)
				return { status: "busy", commandId: null };
			throw error;
		}
	}
}
