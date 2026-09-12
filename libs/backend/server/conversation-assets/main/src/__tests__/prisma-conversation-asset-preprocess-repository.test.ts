import { ConversationAssetProvenance, ConversationAssetState } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PrismaConversationAssetPreprocessRepository } from "../prisma-conversation-asset-preprocess-repository";

const _LINEAGE = vi.hoisted(function _Lineage() { return vi.fn(); });
vi.mock("@opencrane/backend/server/agents/artifacts", function _Artifacts()
{
	return { PrismaScannedPdfTextRepository: class { resolve(...args: unknown[]) { return _LINEAGE(...args); } } };
});

function _Asset()
{
	return { id: "asset", siloId: "silo", artifactId: "source", state: ConversationAssetState.Processing, provenance: ConversationAssetProvenance.ParticipantUpload, mediaType: "application/pdf" };
}

function _Harness(rows: readonly unknown[] = [_Asset()])
{
	const updateMany = vi.fn().mockResolvedValue({ count: 1 });
	const transaction = { conversationAsset: { findMany: vi.fn().mockResolvedValue(rows), updateMany } };
	return { repository: new PrismaConversationAssetPreprocessRepository(transaction as never), updateMany };
}

describe("conversation PDF lifecycle", function _Suite()
{
	beforeEach(function _Reset() { _LINEAGE.mockReset().mockResolvedValue({ artifactRevisionId: "text" }); });

	it("requires complete lineage before marking the original source asset Ready", async function _Completes()
	{
		const harness = _Harness();
		await harness.repository.complete("pdf-1");
		expect(_LINEAGE).toHaveBeenCalledExactlyOnceWith("silo", "source", "pdf-1");
		expect(harness.updateMany).toHaveBeenCalledWith({ where: { id: "asset", revisionId: "pdf-1", state: ConversationAssetState.Processing }, data: { state: ConversationAssetState.Ready, failureCode: null } });
	});

	it("marks terminal failure without making the source Ready or requiring a derivative", async function _Fails()
	{
		const harness = _Harness();
		await harness.repository.fail("pdf-1");
		expect(_LINEAGE).not.toHaveBeenCalled();
		expect(harness.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { state: ConversationAssetState.Failed, failureCode: "preprocessing_failed" } }));
	});

	it("does not invent a conversation asset for general artifact preprocessing", async function _Unlinked()
	{
		const harness = _Harness([]);
		await harness.repository.complete("pdf-1");
		await harness.repository.fail("pdf-1");
		expect(harness.updateMany).not.toHaveBeenCalled();
	});

	it("aborts the surrounding job transition on incomplete lineage or lost compare-and-set", async function _Rollback()
	{
		const incomplete = _Harness();
		_LINEAGE.mockResolvedValueOnce(null);
		await expect(incomplete.repository.complete("pdf-1")).rejects.toThrow("lineage");
		expect(incomplete.updateMany).not.toHaveBeenCalled();
		const changed = _Harness();
		changed.updateMany.mockResolvedValueOnce({ count: 0 });
		await expect(changed.repository.complete("pdf-1")).rejects.toThrow("before preprocessing committed");
	});

	it("refuses ambiguous source associations and already terminal asset states", async function _InvalidAssociation()
	{
		await expect(_Harness([_Asset(), _Asset()]).repository.complete("pdf-1")).rejects.toThrow("one Processing");
		await expect(_Harness([{ ..._Asset(), state: ConversationAssetState.Ready }]).repository.fail("pdf-1")).rejects.toThrow("one Processing");
	});
});
