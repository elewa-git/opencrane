import { ConversationAssetProvenance, ConversationAssetState } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import { PrismaConversationMessageAttachmentRepository } from "../prisma-conversation-message-attachment-repository";

const _PORTS = vi.hoisted(function _Ports() { return { access: vi.fn(), admit: vi.fn(), resolve: vi.fn() }; });
vi.mock("../conversation-asset-product-authorization", function _Authority()
{
	return { PrismaConversationAssetProductAuthorizationRepository: class
	{
		canAccess(...args: unknown[]) { return _PORTS.access(...args); }
		admit(...args: unknown[]) { return _PORTS.admit(...args); }
	} };
});
vi.mock("@opencrane/backend/server/agents/artifacts", function _Lineage()
{
	return { PrismaScannedPdfTextRepository: class { resolve(...args: unknown[]) { return _PORTS.resolve(...args); } } };
});

const _COMMAND = { caller: { siloId: "silo", subjectId: "user", principalId: "principal" }, conversationId: "conversation", messageId: "message", canonicalAssetIds: ["asset"], payloadCreated: true };

/** Participant-owned file after clean scan and completed conversion. */
function _Asset()
{
	return { id: "asset", siloId: "silo", conversationId: "conversation", artifactId: "pdf", revisionId: "pdf-1", state: ConversationAssetState.Ready,
		provenance: ConversationAssetProvenance.ParticipantUpload, createdByUserId: "user", messageId: null, mediaType: "application/pdf", byteLength: 20n, displayName: "Brief.pdf" };
}

/** Bound rows include every state; requested rows are checked separately for current eligibility. */
function _Harness(bound: readonly { id: string }[] = [], assets: readonly unknown[] = [_Asset()])
{
	const findMany = vi.fn().mockResolvedValueOnce(bound).mockResolvedValueOnce(assets);
	const updateMany = vi.fn().mockResolvedValue({ count: 1 });
	const repository = new PrismaConversationMessageAttachmentRepository({ conversationAsset: { findMany, updateMany } } as never);
	return { repository, findMany, updateMany };
}

describe("conversation message attachment admission", function _Suite()
{
	beforeEach(function _Reset()
	{
		vi.resetAllMocks();
		_PORTS.access.mockResolvedValue(true);
		_PORTS.admit.mockResolvedValue(true);
		_PORTS.resolve.mockResolvedValue({ sourceByteLength: 20 });
	});

	it("binds exact source coordinates after current authority and complete lineage checks", async function _Bind()
	{
		const harness = _Harness();
		await expect(harness.repository.bindOrVerify(_COMMAND)).resolves.toEqual({ attachments: [{ assetId: "asset", artifactId: "pdf", artifactRevisionId: "pdf-1", name: "Brief.pdf", mediaType: "application/pdf" }] });
		expect(harness.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ messageId: null, siloId: "silo", createdByUserId: "user", revisionId: "pdf-1" }), data: { messageId: "message" } }));
		expect(_PORTS.access).toHaveBeenCalledExactlyOnceWith(_COMMAND.caller, { kind: ProductAuthorizationResourceKinds.Artifact, id: "pdf" }, ProductAuthorizationActions.Read);
		expect(_PORTS.resolve).toHaveBeenCalledExactlyOnceWith("silo", "pdf", "pdf-1");
	});

	it("preserves an empty saved set and rejects changed retries in either direction", async function _SavedSets()
	{
		await expect(_Harness().repository.bindOrVerify({ ..._COMMAND, payloadCreated: false, canonicalAssetIds: [] })).resolves.toEqual({ attachments: [] });
		await expect(_Harness().repository.bindOrVerify({ ..._COMMAND, payloadCreated: false })).rejects.toThrow("idempotency");
		await expect(_Harness([{ id: "asset" }]).repository.bindOrVerify({ ..._COMMAND, payloadCreated: false, canonicalAssetIds: [] })).rejects.toThrow("idempotency");
		await expect(_Harness([{ id: "other" }]).repository.bindOrVerify({ ..._COMMAND, payloadCreated: false })).rejects.toThrow("idempotency");
	});

	it("verifies exact replay without rebinding and includes non-current rows in historical equality", async function _Replay()
	{
		const harness = _Harness([{ id: "asset" }], [{ ..._Asset(), messageId: "message" }]);
		await expect(harness.repository.bindOrVerify({ ..._COMMAND, payloadCreated: false })).resolves.not.toBeNull();
		expect(harness.updateMany).not.toHaveBeenCalled();
		expect(harness.findMany).toHaveBeenNthCalledWith(1, { where: { siloId: "silo", conversationId: "conversation", messageId: "message" }, select: { id: true } });
		await expect(_Harness([{ id: "asset" }], [{ ..._Asset(), messageId: "message", state: ConversationAssetState.Removed }]).repository.bindOrVerify({ ..._COMMAND, payloadCreated: false })).resolves.toBeNull();
	});

	it("denies changed owner, state, message, media or source facts before any binding", async function _WrongAsset()
	{
		for (const patch of [{ createdByUserId: "other" }, { state: ConversationAssetState.Processing }, { state: ConversationAssetState.Failed },
			{ messageId: "other" }, { artifactId: null }, { revisionId: null }, { mediaType: "text/html" }, { byteLength: 21n }])
		{
			const harness = _Harness([], [{ ..._Asset(), ...patch }]);
			await expect(harness.repository.bindOrVerify(_COMMAND)).resolves.toBeNull();
			expect(harness.updateMany).not.toHaveBeenCalled();
		}
	});

	it("denies revoked authority or incomplete lineage and aborts a lost binding race", async function _Rejects()
	{
		_PORTS.access.mockResolvedValueOnce(false);
		await expect(_Harness().repository.bindOrVerify(_COMMAND)).resolves.toBeNull();
		_PORTS.resolve.mockResolvedValueOnce(null);
		await expect(_Harness().repository.bindOrVerify(_COMMAND)).resolves.toBeNull();
		_PORTS.admit.mockResolvedValueOnce(false);
		await expect(_Harness().repository.bindOrVerify(_COMMAND)).resolves.toBeNull();
		const harness = _Harness();
		harness.updateMany.mockResolvedValueOnce({ count: 0 });
		await expect(harness.repository.bindOrVerify(_COMMAND)).rejects.toThrow("before commit");
	});
});
