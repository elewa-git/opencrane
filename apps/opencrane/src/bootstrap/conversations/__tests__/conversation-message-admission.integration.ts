import { createHash, randomUUID } from "node:crypto";

import { KurrentDBClient } from "@kurrent/kurrentdb-client";
import { AuthorizationBoundaryCoverage, AuthorizationBoundaryKind, AuthorizationEffect, AuthorizationSubjectKind, PrismaClient } from "@prisma/client";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { ArtifactPreprocessPipelineVersions, ArtifactPreprocessTaskNames } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";
import { PrismaConversationMessageAttachmentRepository } from "@opencrane/backend/server/conversation-assets";
import { ConversationComputerHistory } from "@opencrane/backend/server/conversations/computers";
import { AesGcmConversationPrivatePayloadCipher, ConversationHistoryAuthority, ConversationHistoryModes, ConversationHistoryReader } from "@opencrane/backend/server/conversations/history";
import { ConversationMessageActivations, ConversationMessageAdmissionOutcomes, PrismaConversationMessageAdmissionUnitOfWork } from "@opencrane/backend/server/conversations";
import { _KurrentHistoryStore, HistoryExpectedRevisions, type HistoryAtomicAppend, type HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { ComputerLeaseStates, ConversationComputerStates, ConversationEntryKinds, ConversationMessageContentBlockKinds } from "@opencrane/contracts";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";

import { _SeedConversationToolProposalSqlFixture } from "./conversation-tool-proposal.sql-fixture";

const _KURRENT_URL = process.env["KURRENTDB_INTEGRATION_URL"];
const _DATABASE_URL = process.env["DATABASE_URL"];
const _RUN_REAL_PROOFS = _KURRENT_URL !== undefined && _DATABASE_URL !== undefined;
const _CIPHER = new AesGcmConversationPrivatePayloadCipher("integration-key", { "integration-key": Buffer.alloc(32, 17).toString("base64url") });
const _MESSAGE_TEXT = "Use the selected PDF as reference material.";
const _LOST_RESPONSE = "simulated lost KurrentDB message acknowledgement";

const _KurrentClients: KurrentDBClient[] = [];
const _PrismaClients: PrismaClient[] = [];

it.skipIf(_RUN_REAL_PROOFS)("skips the real message admission recovery proofs because PostgreSQL or KurrentDB is unset", function _Skipped()
{
	expect(_KURRENT_URL === undefined || _DATABASE_URL === undefined).toBe(true);
});

describe.skipIf(!_RUN_REAL_PROOFS)("conversation message admission across PostgreSQL and KurrentDB", function _Suite()
{
	afterAll(async function _Disconnect()
	{
		await Promise.all(_KurrentClients.map(client => client.dispose()));
		await Promise.all(_PrismaClients.map(client => client.$disconnect()));
	});

	it("recovers the first attachment append after KurrentDB commits and drops its response", async function _LostAppendResponse()
	{
		const history = _ConnectHistory();
		const fixture = await _Fixture(history);
		const firstPrisma = _ConnectPrisma();
		const uncertain = _LoseOneAppendResponse(history);
		const command = _Command(fixture.assetId);
		await expect(_Admission(firstPrisma, uncertain).post(fixture.caller, fixture.conversationId, command)).rejects.toThrow(_LOST_RESPONSE);

		const committed = await firstPrisma.conversationPrivatePayload.findMany({ where: { conversationId: fixture.conversationId, idempotencyKey: command.idempotencyKey } });
		const bound = await firstPrisma.conversationAsset.findUniqueOrThrow({ where: { id: fixture.assetId } });
		expect(committed).toHaveLength(1);
		expect(bound.messageId).toBe(command.idempotencyKey);

		const recoveryPrisma = _ConnectPrisma();
		await expect(_Admission(recoveryPrisma, _ConnectHistory()).post(fixture.caller, fixture.conversationId, command)).resolves.toEqual({ outcome: ConversationMessageAdmissionOutcomes.Idempotent, position: "1" });
		const recoveredPayloads = await recoveryPrisma.conversationPrivatePayload.findMany({ where: { conversationId: fixture.conversationId, idempotencyKey: command.idempotencyKey } });
		expect(recoveredPayloads).toEqual(committed);
		expect((await recoveryPrisma.conversationAsset.findUniqueOrThrow({ where: { id: fixture.assetId } })).messageId).toBe(command.idempotencyKey);
		const recoveredHistory = _ConnectHistory();
		await _ExpectOneAttachmentEntry(recoveredHistory, fixture, command.idempotencyKey, fixture.assetId);
		expect(await recoveredHistory.readHead(`computer-activations-${fixture.siloId}`)).toEqual({ streamName: `computer-activations-${fixture.siloId}`, revision: 0n });
	});

	it("lets one participant own a concurrently reused browser UUID and leaves the other PDF unbound", async function _CrossAuthorUuid()
	{
		const seedHistory = _ConnectHistory();
		const fixture = await _Fixture(seedHistory);
		const setup = _ConnectPrisma();
		const other = await _AddParticipant(setup, fixture);
		const otherAssetId = await _SeedReadyPdf(setup, fixture.siloId, fixture.conversationId, other.principalId);
		const idempotencyKey = randomUUID();
		const firstPrisma = _ConnectPrisma();
		const secondPrisma = _ConnectPrisma();
		const lock = await _LockPayloadTableUntilReadersWait();
		const first = _Admission(firstPrisma, _ConnectHistory()).post(fixture.caller, fixture.conversationId, { ..._Command(fixture.assetId), idempotencyKey });
		const second = _Admission(secondPrisma, _ConnectHistory()).post(other.caller, fixture.conversationId, { ..._Command(otherAssetId), idempotencyKey });
		const resultsPromise = Promise.allSettled([first, second]);
		await lock.releaseAfterBlockedReaders(2);
		const results = await resultsPromise;

		const accepted = results.filter(result => result.status === "fulfilled");
		const rejected = results.filter(result => result.status === "rejected");
		expect(accepted).toHaveLength(1);
		expect(accepted[0]).toMatchObject({ value: { outcome: ConversationMessageAdmissionOutcomes.Accepted, position: "1" } });
		expect(rejected).toHaveLength(1);
		expect((rejected[0] as PromiseRejectedResult).reason).toEqual(expect.objectContaining({ message: expect.stringContaining("different participant") }));

		const payloads = await setup.conversationPrivatePayload.findMany({ where: { conversationId: fixture.conversationId, idempotencyKey } });
		expect(payloads).toHaveLength(1);
		const winner = payloads[0]!.authorSubject;
		const assets = await setup.conversationAsset.findMany({ where: { id: { in: [fixture.assetId, otherAssetId] } }, orderBy: { id: "asc" } });
		expect(assets.filter(asset => asset.messageId === idempotencyKey)).toHaveLength(1);
		expect(assets.find(asset => asset.createdByUserId === winner)?.messageId).toBe(idempotencyKey);
		expect(assets.find(asset => asset.createdByUserId !== winner)?.messageId).toBeNull();
		const winnerAssetId = assets.find(asset => asset.createdByUserId === winner)!.id;
		await _ExpectOneAttachmentEntry(_ConnectHistory(), fixture, idempotencyKey, winnerAssetId);
	});
});

function _ConnectHistory(): _KurrentHistoryStore
{
	const client = KurrentDBClient.connectionString(_KURRENT_URL ?? "");
	_KurrentClients.push(client);
	return new _KurrentHistoryStore(client);
}

function _ConnectPrisma(): PrismaClient
{
	const client = new PrismaClient({ datasourceUrl: _DATABASE_URL });
	_PrismaClients.push(client);
	return client;
}

function _Admission(prisma: PrismaClient, history: Pick<HistoryStore, "append" | "appendAtomic" | "readHead" | "readStream">): PrismaConversationMessageAdmissionUnitOfWork
{
	return new PrismaConversationMessageAdmissionUnitOfWork(prisma, history, { cipher: _CIPHER, computerReader: new ConversationComputerHistory(history) }, new ConversationHistoryAuthority(history), function _Attachments(transaction)
	{
		return new PrismaConversationMessageAttachmentRepository(transaction);
	});
}

function _Command(assetId: string)
{
	return { activation: ConversationMessageActivations.Start, assetIds: [assetId], idempotencyKey: randomUUID(), text: _MESSAGE_TEXT };
}

async function _Fixture(history: _KurrentHistoryStore)
{
	const seeded = await _SeedConversationToolProposalSqlFixture();
	const conversationId = seeded.turn.binding.conversationId;
	const caller = { principalId: seeded.principalId, subjectId: seeded.principalId, siloId: seeded.siloId, externalIssuer: "https://identity.example.test", verifiedAuthenticationAt: new Date().toISOString() };
	await history.append(new ConversationHistoryAuthority(history).genesisAppend({ schemaVersion: 1, siloId: seeded.siloId, conversationId, mode: ConversationHistoryModes.AgentSession, agentServiceId: seeded.turn.binding.agentServiceId, createdByPrincipalId: seeded.principalId, createdAt: new Date().toISOString() }, randomUUID()));
	const now = new Date();
	await new ConversationComputerHistory(history).append({ expectedRevision: HistoryExpectedRevisions.NoStream, eventId: randomUUID(), computer: {
		schemaVersion: 1, id: seeded.turn.computerId, siloId: seeded.siloId, conversationId, agentIdentityId: seeded.turn.binding.agentIdentityId,
		profileRevisionId: `profile-${conversationId}`, state: ConversationComputerStates.Warm, leaseGeneration: 1, workspaceCheckpoint: null,
		createdAt: now.toISOString(), updatedAt: now.toISOString(),
	}, lease: { schemaVersion: 1, id: seeded.turn.lease.leaseId, computerId: seeded.turn.computerId, generation: 1,
		sandboxClaimId: seeded.turn.lease.sandboxClaimId, sandboxId: `sandbox-${conversationId}`, serviceFQDN: `sandbox-${conversationId}.test.svc.cluster.local`,
		state: ComputerLeaseStates.Active, claimedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 300_000).toISOString(), releasedAt: null } });
	const assetId = await _SeedReadyPdf(_ConnectPrisma(), seeded.siloId, conversationId, seeded.principalId);
	return { siloId: seeded.siloId, conversationId, caller, assetId };
}

function _LoseOneAppendResponse(history: _KurrentHistoryStore): Pick<HistoryStore, "append" | "appendAtomic" | "readHead" | "readStream">
{
	let lose = true;
	return {
		append: history.append.bind(history),
		readHead: history.readHead.bind(history),
		readStream: history.readStream.bind(history),
		async appendAtomic(command: HistoryAtomicAppend)
		{
			const receipts = await history.appendAtomic(command);
			if (lose)
			{
				lose = false;
				throw new Error(_LOST_RESPONSE);
			}
			return receipts;
		},
	};
}

async function _AddParticipant(prisma: PrismaClient, fixture: Awaited<ReturnType<typeof _Fixture>>)
{
	const principalId = randomUUID();
	const originalPrincipal = await prisma.principal.findUniqueOrThrow({ where: { id: fixture.caller.principalId } });
	const originalMembership = await prisma.orgMembership.findUniqueOrThrow({ where: { clusterTenant_subject: { clusterTenant: fixture.siloId, subject: fixture.caller.subjectId } } });
	const originalParticipant = await prisma.conversationParticipant.findUniqueOrThrow({ where: { conversationId_userId: { conversationId: fixture.conversationId, userId: fixture.caller.subjectId } } });
	const useCapability = __ProductAuthorizationCapability(ProductAuthorizationResourceKinds.Conversation, ProductAuthorizationActions.Use)!;
	const originalGrant = await prisma.authorizationGrant.findFirstOrThrow({ where: { siloId: fixture.siloId, resourceKind: ProductAuthorizationResourceKinds.Conversation, resourceId: fixture.conversationId, subjectPrincipalId: fixture.caller.principalId, capabilityId: useCapability.capabilityId } });
	await prisma.$transaction([
		prisma.principal.create({ data: { ...originalPrincipal, id: principalId, subject: principalId, email: null, displayName: "Second participant" } }),
		prisma.orgMembership.create({ data: { ...originalMembership, id: randomUUID(), subject: principalId, email: null, displayName: "Second participant" } }),
		prisma.conversationParticipant.create({ data: { ...originalParticipant, userId: principalId } }),
		prisma.authorizationGrant.create({ data: { ...originalGrant, id: randomUUID(), subjectPrincipalId: principalId, boundaryPrincipalId: principalId, createdBy: fixture.caller.principalId } }),
	]);
	return { principalId, caller: { principalId, subjectId: principalId, siloId: fixture.siloId, externalIssuer: "https://identity.example.test", verifiedAuthenticationAt: new Date().toISOString() } };
}

async function _SeedReadyPdf(prisma: PrismaClient, siloId: string, conversationId: string, principalId: string): Promise<string>
{
	const prefix = randomUUID();
	const id = (name: string) => `${prefix}-${name}`;
	const assetId = id("conversation-asset");
	const sourceArtifactId = id("source");
	const sourceRevisionId = id("source-revision");
	const derivedArtifactId = id("derived");
	const derivedRevisionId = id("derived-revision");
	const outputLeaseId = id("output-lease");
	const sourceDigest = _Digest(id("source-bytes"));
	const derivedDigest = _Digest(id("derived-bytes"));
	const completionDigest = _Digest(id("completion"));
	const taskKey = `workflows:artifact-preprocess:${createHash("sha256").update(id("task")).digest("hex")}`;
	const database = new Client({ connectionString: _DATABASE_URL });
	await database.connect();
	try
	{
		await database.query("BEGIN");
		await database.query('SET CONSTRAINTS "artifact_preprocess_output_lease_finalization" DEFERRED');
		await database.query("INSERT INTO artifacts (id, silo_id, owner_principal_id, kind, updated_at) VALUES ($1, $2, $3, 'upload', clock_timestamp()), ($4, $2, $3, 'generated', clock_timestamp())", [sourceArtifactId, siloId, principalId, derivedArtifactId]);
		await database.query("INSERT INTO artifact_revisions (id, artifact_id, revision, content_address, byte_length, media_type, provenance, created_by) VALUES ($1, $2, 1, $3, 42, 'application/pdf', $4::jsonb, $5)", [sourceRevisionId, sourceArtifactId, sourceDigest, JSON.stringify({ source: "integration-fixture" }), principalId]);
		await database.query("UPDATE artifacts SET current_revision_id=$2 WHERE id=$1", [sourceArtifactId, sourceRevisionId]);
		await database.query("INSERT INTO artifact_scan_jobs (id, artifact_revision_id, state, attempt, scanner_version, completed_at, updated_at) VALUES ($1, $2, 'clean', 1, 'integration-scanner', clock_timestamp(), clock_timestamp())", [id("scan"), sourceRevisionId]);
		await database.query("INSERT INTO artifact_preprocess_jobs (id, source_revision_id, pipeline_version, task_key, updated_at) VALUES ($1, $2, $3, $4, clock_timestamp())", [id("preprocess"), sourceRevisionId, ArtifactPreprocessPipelineVersions.PdfToText, taskKey]);
		await database.query("UPDATE artifact_preprocess_jobs SET task_id=$2, task_name=$3 WHERE id=$1", [id("preprocess"), id("task-id"), ArtifactPreprocessTaskNames.Convert]);
		await database.query("UPDATE artifact_preprocess_jobs SET state='claimed', delivery_count=1, claim_fence=$2, profile_name='pdf-preprocessor', claimed_at=clock_timestamp(), claim_expires_at=clock_timestamp() + interval '4 minutes', derived_artifact_id=$3 WHERE id=$1", [id("preprocess"), id("claim"), derivedArtifactId]);
		await database.query("UPDATE artifact_preprocess_jobs SET workload_uid=$2, bootstrap_reference_hash=$3, bootstrap_namespace='opencrane-artifacts' WHERE id=$1", [id("preprocess"), id("workload"), _Digest(id("bootstrap"))]);
		await database.query("UPDATE artifact_preprocess_jobs SET first_pod_uid=$2 WHERE id=$1", [id("preprocess"), id("pod")]);
		await database.query("INSERT INTO artifact_upload_leases (id, artifact_id, silo_id, capability_jti, expected_content_address, expected_byte_length, media_type, expires_at) VALUES ($1, $2, $3, $4, $5, 12, 'text/plain', clock_timestamp() + interval '3 minutes')", [outputLeaseId, derivedArtifactId, siloId, id("capability"), derivedDigest]);
		await database.query("UPDATE artifact_preprocess_jobs SET output_lease_id=$2 WHERE id=$1", [id("preprocess"), outputLeaseId]);
		await database.query("INSERT INTO artifact_revisions (id, artifact_id, revision, content_address, byte_length, media_type, provenance, created_by) VALUES ($1, $2, 1, $3, 12, 'text/plain', $4::jsonb, 'system:artifact-preprocessor')", [derivedRevisionId, derivedArtifactId, derivedDigest, JSON.stringify({ pipelineVersion: ArtifactPreprocessPipelineVersions.PdfToText, sourceRevisionId })]);
		await database.query("UPDATE artifacts SET current_revision_id=$2 WHERE id=$1", [derivedArtifactId, derivedRevisionId]);
		await database.query("INSERT INTO artifact_revision_parents (child_revision_id, parent_revision_id) VALUES ($1, $2)", [derivedRevisionId, sourceRevisionId]);
		await database.query("UPDATE artifact_upload_leases SET state='promoted', promotion_receipt_digest=$2, promoted_content_address=$3, promoted_byte_length=12, promoted_at=clock_timestamp() WHERE id=$1", [outputLeaseId, _Digest(id("promotion")), derivedDigest]);
		await database.query("UPDATE artifact_upload_leases SET state='finalized', finalized_at=clock_timestamp() WHERE id=$1", [outputLeaseId]);
		await database.query("UPDATE artifact_preprocess_jobs SET derived_revision_id=$2, completion_digest=$3 WHERE id=$1", [id("preprocess"), derivedRevisionId, completionDigest]);
		await database.query("UPDATE artifact_preprocess_jobs SET state='completed', completion_consumed_at=clock_timestamp(), completed_at=clock_timestamp() WHERE id=$1", [id("preprocess")]);
		await database.query("INSERT INTO conversation_assets (id, silo_id, conversation_id, artifact_id, revision_id, idempotency_key, provenance, state, display_name, media_type, byte_length, created_by_user_id, updated_at) VALUES ($1, $2, $3, $4, $5, $6, 'participant_upload', 'ready', 'reference.pdf', 'application/pdf', 42, $7, clock_timestamp())", [assetId, siloId, conversationId, sourceArtifactId, sourceRevisionId, id("asset-command"), principalId]);
		await database.query("COMMIT");
	}
	catch (error)
	{
		await database.query("ROLLBACK");
		throw error;
	}
	finally { await database.end(); }
	await Promise.all([ProductAuthorizationActions.Read, ProductAuthorizationActions.Edit].map(action => _Grant(prisma, siloId, principalId, sourceArtifactId, action)));
	return assetId;
}

async function _Grant(prisma: PrismaClient, siloId: string, principalId: string, artifactId: string, action: ProductAuthorizationActions): Promise<void>
{
	const capability = __ProductAuthorizationCapability(ProductAuthorizationResourceKinds.Artifact, action);
	if (capability === null)
		throw new Error(`Missing Artifact ${action} capability`);
	await prisma.authorizationGrant.create({ data: { id: randomUUID(), siloId, subjectKind: AuthorizationSubjectKind.Principal, subjectPrincipalId: principalId,
		boundaryKind: AuthorizationBoundaryKind.Personal, boundaryPrincipalId: principalId, boundaryCoverage: AuthorizationBoundaryCoverage.Exact,
		managerId: "conversation-message-integration", catalogId: capability.catalog.catalogId, catalogRevision: capability.catalog.revision,
		catalogDigest: capability.catalog.digest, capabilityId: capability.capabilityId, resourceKind: ProductAuthorizationResourceKinds.Artifact,
		resourceId: artifactId, effect: AuthorizationEffect.Allow, priority: 0, createdBy: principalId } });
}

async function _ExpectOneAttachmentEntry(history: _KurrentHistoryStore, fixture: Awaited<ReturnType<typeof _Fixture>>, messageId: string, assetId: string): Promise<void>
{
	const result = await new ConversationHistoryReader(history).read({ siloId: fixture.siloId, conversationId: fixture.conversationId });
	expect(result.entries).toHaveLength(1);
	const entry = result.entries[0]!;
	expect(entry).toMatchObject({ id: messageId, kind: ConversationEntryKinds.Message, author: { participantId: expect.any(String) }, blocks: [
		{ kind: ConversationMessageContentBlockKinds.Text },
		{ kind: ConversationMessageContentBlockKinds.Artifact, artifactId: expect.any(String), artifactRevisionId: expect.any(String), name: "reference.pdf", mediaType: "application/pdf" },
	] });
	if (entry.kind !== ConversationEntryKinds.Message)
		throw new Error("Expected one immutable message entry");
	const asset = await _ConnectPrisma().conversationAsset.findUniqueOrThrow({ where: { id: assetId } });
	expect(entry.blocks[1]).toMatchObject({ artifactId: asset.artifactId, artifactRevisionId: asset.revisionId });
}

async function _LockPayloadTableUntilReadersWait()
{
	const locker = new Client({ connectionString: _DATABASE_URL });
	await locker.connect();
	await locker.query("BEGIN");
	await locker.query("LOCK TABLE conversation_private_payloads IN ACCESS EXCLUSIVE MODE");
	let released = false;
	async function _Release(): Promise<void>
	{
		if (released)
			return;
		released = true;
		await locker.query("COMMIT");
		await locker.end();
	}
	return {
		async releaseAfterBlockedReaders(count: number): Promise<void>
		{
			const deadline = Date.now() + 10_000;
			try
			{
				while (Date.now() < deadline)
				{
					const result = await locker.query<{ readonly count: string }>("SELECT count(*)::text AS count FROM pg_locks lock JOIN pg_class relation ON relation.oid=lock.relation WHERE relation.relname='conversation_private_payloads' AND lock.mode='AccessShareLock' AND NOT lock.granted");
					if (Number(result.rows[0]?.count ?? 0) >= count)
					{
						await _Release();
						return;
					}
					await new Promise(resolve => setTimeout(resolve, 10));
				}
				throw new Error("Timed out waiting for concurrent message predicate reads");
			}
			finally { await _Release(); }
		},
	};
}

function _Digest(value: string): string
{
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
