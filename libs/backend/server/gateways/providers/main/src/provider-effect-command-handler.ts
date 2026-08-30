import * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";

import { _byokCredentialName, _byokSecretName, _DeprovisionByokKey, _ProvisionByokKey, _RegisterLiteLlmModel } from "@opencrane/backend/server/gateways/model-routing";

import { _log } from "./log";
import { ProviderEffectOutcomeUncertainError } from "./provider-effect-command-errors";
import { ProviderEffectCommandKinds, type ProviderEffectCommandHandler, type ProviderEffectCommandRecord, type ProviderEffectEphemeralMaterial, type ProviderEffectHandlerResult } from "./provider-effect-command.types";

/**
 * Performs Kubernetes and LiteLLM work for a command whose database claim already committed.
 *
 * The handler has no authorization API. It can act only on the closed payload loaded from a claimed
 * command. Raw provider material enters through the method argument, is never logged, and is never
 * copied into command persistence.
 *
 * Called by: {@link DefaultProviderEffectCommandExecutor} in provider route composition.
 */
export class DefaultProviderEffectCommandHandler implements ProviderEffectCommandHandler
{
	/** Root Prisma client used by the existing provider-custody reconciler after admission. */
	private readonly prisma: PrismaClient;
	/** Kubernetes API used for the fixed provider Secret catalogue. */
	private readonly coreApi: k8s.CoreV1Api | null;
	/** Namespace that contains the fixed provider Secret catalogue. */
	private readonly operatorNamespace: string | null;

	/**
	 * Binds command delivery to the existing provider-custody and model-registration adapters.
	 *
	 * @param prisma - Product database used by provider custody after external reconciliation.
	 * @param coreApi - Kubernetes client restricted to fixed BYOK Secret names.
	 * @param operatorNamespace - Namespace that owns those Secrets.
	 */
	constructor(prisma: PrismaClient, coreApi: k8s.CoreV1Api | null = null, operatorNamespace: string | null = null)
	{
		this.prisma = prisma;
		this.coreApi = coreApi;
		this.operatorNamespace = operatorNamespace;
	}

	/** @inheritdoc */
	async execute(command: ProviderEffectCommandRecord, material: ProviderEffectEphemeralMaterial): Promise<ProviderEffectHandlerResult>
	{
		switch (command.payload.kind)
		{
			case ProviderEffectCommandKinds.SetByokKey:
			{
				if (this.coreApi === null || this.operatorNamespace === null)
					throw new Error("Set-BYOK execution requires the Kubernetes custody adapter");
				const providerKey = material.providerKey?.trim() ?? "";
				if (material.provider !== command.payload.value.provider || providerKey.length === 0)
					throw new Error("Set-BYOK execution requires matching ephemeral provider material");
				_requireFixedCustodyCoordinates(command.payload.value.provider, command.payload.value.secretRef, command.payload.value.litellmCredentialName);
				const provisioned = await _ProvisionByokKey({ prisma: this.prisma, coreApi: this.coreApi, operatorNamespace: this.operatorNamespace, provider: command.payload.value.provider, apiKey: providerKey, log: _log });
				if (!provisioned.litellmOutcomeCertain)
					throw new ProviderEffectOutcomeUncertainError();
				return { kind: command.payload.kind, providerCredentialId: provisioned.row.id, litellmRegistered: provisioned.litellmRegistered };
			}
			case ProviderEffectCommandKinds.DeleteByokKey:
				if (this.coreApi === null || this.operatorNamespace === null)
					throw new Error("Delete-BYOK execution requires the Kubernetes custody adapter");
				_requireFixedCustodyCoordinates(command.payload.value.provider, command.payload.value.secretRef, command.payload.value.litellmCredentialName);
				const deprovisioned = await _DeprovisionByokKey({ prisma: this.prisma, coreApi: this.coreApi, operatorNamespace: this.operatorNamespace, provider: command.payload.value.provider });
				if (!deprovisioned.litellmOutcomeCertain)
					throw new ProviderEffectOutcomeUncertainError();
				return { kind: command.payload.kind };
			case ProviderEffectCommandKinds.RegisterModel:
			{
				const value = command.payload.value;
				const litellmModelId = await _RegisterLiteLlmModel({ deploymentId: command.id, publicModelName: value.publicModelName, upstreamModel: value.upstreamModel, scope: value.scope, clusterTenant: value.clusterTenant, apiBase: value.apiBase, apiKeyEnvRef: value.apiKeyEnvRef, litellmCredentialName: value.litellmCredentialName, requireLiveRegistration: true });
				return { kind: command.payload.kind, litellmModelId };
			}
		}
	}
}

/** Refuse a command whose persisted custody coordinates differ from the fixed provider catalogue. */
function _requireFixedCustodyCoordinates(provider: string, secretRef: string, litellmCredentialName: string): void
{
	if (secretRef !== _byokSecretName(provider) || litellmCredentialName !== _byokCredentialName(provider))
		throw new Error("provider effect command contains invalid custody coordinates");
}
