import { randomUUID } from "node:crypto";

import { MemoryConsentState, MemoryFactState, OrgMemberStatus, PersonalMemoryOperationFailureCode, PersonalMemoryOperationPhase, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { MemoryFactProvenanceSourceKinds } from "@opencrane/contracts";
import { PersonalMemoryOperationPersistenceOutcomes, PrismaPersonalMemoryOperationRepository } from "@opencrane/backend/agents/personal/memory";

import { PersonalMemoryOperationAuthorizedCatalogApplyOutcomes } from "../personal-memory-operation-authority.types";
import { PrismaPersonalMemoryOperationCatalogUnitOfWork } from "../prisma-personal-memory-operation-catalog";
import { _CatalogFixture } from "./personal-memory-operation-catalog.sql-fixture";

const _Database = new PrismaClient();
const _Observer = new PrismaClient();

/** Reads committed state through another connection, after the protected transaction ends. */
async function _ExpectPending(operationId: string): Promise<void>
{
	expect(await _Observer.memoryFactCatalog.findUnique({ where: { id: operationId } })).toBeNull();
	expect(await _Observer.personalMemoryOperation.findUniqueOrThrow({ where: { id: operationId } })).toMatchObject({ phase: PersonalMemoryOperationPhase.CatalogCommitPending, revision: 5 });
}

/** Authority loss records a recoverable reason without publishing the pending fact. */
async function _ExpectAuthorityEnded(operationId: string): Promise<void>
{
	expect(await _Observer.memoryFactCatalog.findUnique({ where: { id: operationId } })).toBeNull();
	expect(await _Observer.personalMemoryOperation.findUniqueOrThrow({ where: { id: operationId } })).toMatchObject({ phase: PersonalMemoryOperationPhase.RecoveryRequired, recoveryPhase: PersonalMemoryOperationPhase.CatalogCommitPending, revision: 6, failureCode: PersonalMemoryOperationFailureCode.AuthorityEnded });
}

describe("personal-memory catalog authorization on PostgreSQL", function _Suite()
{
	beforeAll(async function _Connect()
	{
		if (!process.env.DATABASE_URL)
			throw new Error("Catalog SQL proofs require DATABASE_URL and the unchanged target baseline");
		await Promise.all([_Database.$connect(), _Observer.$connect()]);
	});

	afterAll(async function _Disconnect() { await Promise.all([_Database.$disconnect(), _Observer.$disconnect()]); });

	it("commits the fact and completed operation through current membership and the exact grant", async function _Commit()
	{
		const fixture = await _CatalogFixture(_Database);
		const owner = new PrismaPersonalMemoryOperationCatalogUnitOfWork(_Database, fixture.principalId);
		await expect(owner.apply(fixture.event, fixture.recordedAt)).resolves.toMatchObject({ outcome: PersonalMemoryOperationAuthorizedCatalogApplyOutcomes.Applied });
		expect(await _Observer.memoryFactCatalog.findUniqueOrThrow({ where: { id: fixture.operationId } })).toMatchObject({ datasetId: fixture.datasetId, cogneeExternalId: fixture.documentId, state: MemoryFactState.Active });
		expect(await _Observer.personalMemoryOperation.findUniqueOrThrow({ where: { id: fixture.operationId } })).toMatchObject({ phase: PersonalMemoryOperationPhase.Completed, revision: 6 });
	});

	it("saves recovery after membership revocation without publishing a fact", async function _MembershipRevoked()
	{
		const fixture = await _CatalogFixture(_Database);
		await _Observer.orgMembership.update({ where: { clusterTenant_subject: { clusterTenant: fixture.principalId, subject: fixture.principalId } }, data: { status: OrgMemberStatus.Suspended } });
		const owner = new PrismaPersonalMemoryOperationCatalogUnitOfWork(_Database, fixture.principalId);
		await expect(owner.apply(fixture.event, fixture.recordedAt)).resolves.toMatchObject({ outcome: PersonalMemoryOperationAuthorizedCatalogApplyOutcomes.AuthorityEnded });
		await _ExpectAuthorityEnded(fixture.operationId);
	});

	it("saves grant revocation once and leaves an existing recovery phase unchanged", async function _GrantRevoked()
	{
		const fixture = await _CatalogFixture(_Database);
		await _Observer.authorizationGrant.update({ where: { id: fixture.grantId }, data: { revokedAt: fixture.recordedAt } });
		const owner = new PrismaPersonalMemoryOperationCatalogUnitOfWork(_Database, fixture.principalId);
		await expect(owner.apply(fixture.event, fixture.recordedAt)).resolves.toMatchObject({ outcome: PersonalMemoryOperationAuthorizedCatalogApplyOutcomes.AuthorityEnded });
		await _ExpectAuthorityEnded(fixture.operationId);
		await expect(owner.apply({ ...fixture.event, expectedRevision: 6 }, fixture.recordedAt)).resolves.toMatchObject({ outcome: PersonalMemoryOperationAuthorizedCatalogApplyOutcomes.AuthorityEnded, persistence: { outcome: PersonalMemoryOperationPersistenceOutcomes.Retry } });
		await _ExpectAuthorityEnded(fixture.operationId);
	});

	it("keeps a conflicting fact intact and records a catalog conflict once", async function _CatalogConflict()
	{
		const fixture = await _CatalogFixture(_Database);
		const existingId = randomUUID();
		await _Database.memoryFactCatalog.create({ data: { id: existingId, datasetId: fixture.datasetId, cogneeExternalId: fixture.documentId, contentDigest: `sha256:${"b".repeat(64)}`, consentState: MemoryConsentState.Explicit, sensitivity: "personal", provenance: { sourceKind: MemoryFactProvenanceSourceKinds.Message }, sourceMessageId: randomUUID(), recordedBy: fixture.principalId } });
		const owner = new PrismaPersonalMemoryOperationCatalogUnitOfWork(_Database, fixture.principalId);
		await owner.apply(fixture.event, fixture.recordedAt);
		const operation = await _Observer.personalMemoryOperation.findUniqueOrThrow({ where: { id: fixture.operationId } });
		expect(operation).toMatchObject({ phase: PersonalMemoryOperationPhase.RecoveryRequired, recoveryPhase: PersonalMemoryOperationPhase.CatalogCommitPending, revision: 6, failureCode: PersonalMemoryOperationFailureCode.CatalogConflict });
		expect(await _Observer.memoryFactCatalog.findMany({ where: { datasetId: fixture.datasetId } })).toMatchObject([{ id: existingId, contentDigest: `sha256:${"b".repeat(64)}`, state: MemoryFactState.Active }]);
		await owner.apply({ ...fixture.event, expectedRevision: 6 }, fixture.recordedAt);
		expect(await _Observer.personalMemoryOperation.findUniqueOrThrow({ where: { id: fixture.operationId } })).toEqual(operation);
		expect(await _Observer.memoryFactCatalog.count({ where: { datasetId: fixture.datasetId } })).toBe(1);
	});

	it("rolls back real catalog and lifecycle writes when the transaction fails after applying them", async function _Rollback()
	{
		const fixture = await _CatalogFixture(_Database);
		const apply = PrismaPersonalMemoryOperationRepository.prototype.apply;
		let applied = false;
		const failingApply = vi.spyOn(PrismaPersonalMemoryOperationRepository.prototype, "apply").mockImplementation(async function _FailAfterRealWrites(this: PrismaPersonalMemoryOperationRepository, event, recordedAt)
		{
			await apply.call(this, event, recordedAt);
			applied = true;
			throw new Error("synthetic failure after catalog writes");
		});
		try
		{
			const owner = new PrismaPersonalMemoryOperationCatalogUnitOfWork(_Database, fixture.principalId);
			await expect(owner.apply(fixture.event, fixture.recordedAt)).rejects.toThrow("synthetic failure after catalog writes");
			expect(applied).toBe(true);
			await _ExpectPending(fixture.operationId);
		}
		finally { failingApply.mockRestore(); }
	});
});
