import { AuthorizationBoundaryKind, MemoryDatasetState, type Prisma } from "@prisma/client";
import { PersonalMemoryOperationKinds, PersonalMemoryOperationPhases, type PersonalMemoryOperationRecord } from "@opencrane/backend/agents/personal/memory";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { describe, expect, it, vi } from "vitest";

import { PrismaPersonalMemoryOperationAuthorizationRepository } from "../prisma-personal-memory-operation-authorization-repository";

const _NOW = new Date("2026-09-14T08:00:00.000Z");
const _ACTOR = { siloId: "silo-1", principalId: "principal-1", subjectId: "subject-1", externalIssuer: "https://issuer.test" };

/** Creates only the saved fields used by the current authorization repository. */
function _Operation(kind = PersonalMemoryOperationKinds.Correct, phase = PersonalMemoryOperationPhases.DocumentAddPending): PersonalMemoryOperationRecord
{
	return { operationId: "928b379d-d679-42db-bd46-c938bb15f3d1", siloId: "silo-1", datasetId: "dataset-1", actorPrincipalId: "principal-1", kind, phase, recoveryPhase: null, providerDatasetId: kind === PersonalMemoryOperationKinds.Remember ? null : "51111111-1111-4111-8111-111111111111" } as PersonalMemoryOperationRecord;
}

/** Creates current dataset and central authorization readers. */
function _Fixture()
{
	const transaction = { memoryDataset: { findFirst: vi.fn().mockResolvedValue({ id: "dataset-1" }) } };
	const authorization = { decidePrincipal: vi.fn().mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow }) };
	return { transaction, authorization, repository: new PrismaPersonalMemoryOperationAuthorizationRepository(transaction as unknown as Prisma.TransactionClient, authorization) };
}

describe("personal memory operation authorization repository", function _Suite()
{
	it.each([
		[PersonalMemoryOperationKinds.Remember, PersonalMemoryOperationPhases.DatasetEnsurePending, ProductAuthorizationActions.Manage, MemoryDatasetState.Provisioning, null],
		[PersonalMemoryOperationKinds.Correct, PersonalMemoryOperationPhases.DocumentAddPending, ProductAuthorizationActions.Manage, MemoryDatasetState.Active, "51111111-1111-4111-8111-111111111111"],
		[PersonalMemoryOperationKinds.Forget, PersonalMemoryOperationPhases.DocumentDeletePending, ProductAuthorizationActions.Forget, MemoryDatasetState.Active, "51111111-1111-4111-8111-111111111111"],
	] as const)("requires current personal ownership and %s authority for %s", async function _Allowed(kind, phase, action, state, cogneeDatasetId)
	{
		const f = _Fixture();
		const operation = _Operation(kind, phase);
		await expect(f.repository.allows(operation, _ACTOR, _NOW)).resolves.toBe(true);
		expect(f.transaction.memoryDataset.findFirst).toHaveBeenCalledWith({ where: { id: "dataset-1", siloId: "silo-1", boundaryKind: AuthorizationBoundaryKind.Personal, boundaryPrincipalId: "principal-1", state, cogneeDatasetId }, select: { id: true } });
		expect(f.authorization.decidePrincipal).toHaveBeenCalledWith({ siloId: "silo-1", principalId: "principal-1", resource: { kind: ProductAuthorizationResourceKinds.MemoryScope, id: "dataset-1" }, action, nowEpochMs: _NOW.getTime() });
	});

	it("rejects retired or mismatched dataset ownership before reading grants", async function _DatasetDenied()
	{
		const f = _Fixture();
		f.transaction.memoryDataset.findFirst.mockResolvedValue(null);
		await expect(f.repository.allows(_Operation(), _ACTOR, _NOW)).resolves.toBe(false);
		expect(f.authorization.decidePrincipal).not.toHaveBeenCalled();
	});

	it("rejects a current grant denial without changing grants", async function _GrantDenied()
	{
		const f = _Fixture();
		f.authorization.decidePrincipal.mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Deny });
		await expect(f.repository.allows(_Operation(), _ACTOR, _NOW)).resolves.toBe(false);
		expect(f.authorization.decidePrincipal).toHaveBeenCalledOnce();
	});

	it("uses the saved recovery phase for current dataset eligibility", async function _RecoveryPhase()
	{
		const f = _Fixture();
		const operation = { ..._Operation(PersonalMemoryOperationKinds.Remember), phase: PersonalMemoryOperationPhases.RecoveryRequired, recoveryPhase: PersonalMemoryOperationPhases.DatasetEnsurePending };
		await expect(f.repository.allows(operation, _ACTOR, _NOW)).resolves.toBe(true);
		expect(f.transaction.memoryDataset.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ state: MemoryDatasetState.Provisioning, cogneeDatasetId: null }) }));
	});
});
