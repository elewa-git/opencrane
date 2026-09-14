import { AuthorizationBoundaryKind, MemoryDatasetState, type Prisma } from "@prisma/client";

import { PersonalMemoryOperationKinds, PersonalMemoryOperationPhases, type PersonalMemoryOperationRecord } from "@opencrane/backend/agents/personal/memory";
import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import type { ConversationCaller } from "../../authorization/conversation-caller.types";
import type { PersonalMemoryOperationAuthorization } from "./personal-memory-operation-authority.types";

/** Rechecks active dataset ownership and central MemoryScope permission in one read transaction. */
export class PrismaPersonalMemoryOperationAuthorizationRepository implements PersonalMemoryOperationAuthorization
{
	/** Binds dataset and authorization reads to the same transaction snapshot. */
	constructor(private readonly transaction: Prisma.TransactionClient, private readonly authorization: Pick<AuthorizationAuthority, "decidePrincipal">) {}

	/** Returns whether the current personal dataset and grant permit this saved operation. */
	async allows(operation: PersonalMemoryOperationRecord, actor: ConversationCaller, now: Date): Promise<boolean>
	{
		if (actor.siloId !== operation.siloId || actor.principalId !== operation.actorPrincipalId || !Number.isFinite(now.getTime()))
			return false;
		const activePhase = operation.phase === PersonalMemoryOperationPhases.RecoveryRequired ? operation.recoveryPhase : operation.phase;
		if (activePhase === null || activePhase === PersonalMemoryOperationPhases.Completed || activePhase === PersonalMemoryOperationPhases.RecoveryRequired)
			return false;
		const ensuring = activePhase === PersonalMemoryOperationPhases.DatasetEnsurePending;
		const dataset = await this.transaction.memoryDataset.findFirst({
			where: {
				id: operation.datasetId,
				siloId: operation.siloId,
				boundaryKind: AuthorizationBoundaryKind.Personal,
				boundaryPrincipalId: operation.actorPrincipalId,
				state: ensuring ? MemoryDatasetState.Provisioning : MemoryDatasetState.Active,
				cogneeDatasetId: ensuring ? null : operation.providerDatasetId,
			},
			select: { id: true },
		});
		if (dataset === null)
			return false;
		const action = operation.kind === PersonalMemoryOperationKinds.Forget ? ProductAuthorizationActions.Forget : ProductAuthorizationActions.Manage;
		const result = await this.authorization.decidePrincipal({
			siloId: operation.siloId,
			principalId: actor.principalId,
			resource: { kind: ProductAuthorizationResourceKinds.MemoryScope, id: operation.datasetId },
			action,
			nowEpochMs: now.getTime(),
		});
		return result.outcome === AuthorizationDecisionOutcomes.Allow;
	}
}
