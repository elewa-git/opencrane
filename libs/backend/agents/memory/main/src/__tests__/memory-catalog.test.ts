import { MemoryFactProvenanceSourceKinds } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";

import { __MemoryCatalogCorrectionConflictError } from "../memory-catalog-errors";
import { __RecordMemoryFact } from "../memory-catalog";
import { MemoryCatalogAtomicStatuses, MemoryFactConsentStates } from "../memory-catalog.types";

/** Builds a unit-of-work fake containing one memory catalog repository. */
function _UnitOfWork(status: MemoryCatalogAtomicStatuses = MemoryCatalogAtomicStatuses.Recorded)
{
	const recordFactAtomically = vi.fn().mockResolvedValue({ status });
	return { run: vi.fn(async function _Run(_command, work) { return work({ catalog: { recordFactAtomically } }); }), recordFactAtomically };
}

describe("memory catalog", function _DescribeMemoryCatalog()
{
	it("records provenance metadata without accepting fact content", async function _RecordsMetadata()
	{
		const unitOfWork = _UnitOfWork();
		const result = await __RecordMemoryFact(unitOfWork as never, { datasetId: "dataset-1", cogneeExternalId: "cognee-fact-1", contentDigest: `sha256:${"a".repeat(64)}`, consentState: MemoryFactConsentStates.Explicit, sensitivity: "ordinary", provenance: { questionId: "q1" }, source: { artifactRevisionId: null, messageId: "message-1", explicitUserStatement: false, explicitUserId: null }, supersedesFactId: null, recordedBy: "user-1", idempotencyKey: "fact-1" });
		expect(result).toEqual({ outcome: "recorded", idempotent: false });
		expect(unitOfWork.run).toHaveBeenCalledOnce();
		expect(unitOfWork.recordFactAtomically).toHaveBeenCalledOnce();
	});

	it("rejects ambiguous provenance before the unit of work begins", async function _RejectsAmbiguousProvenance()
	{
		const unitOfWork = _UnitOfWork();
		const result = await __RecordMemoryFact(unitOfWork as never, { datasetId: "dataset-1", cogneeExternalId: "cognee-fact-1", contentDigest: `sha256:${"a".repeat(64)}`, consentState: MemoryFactConsentStates.Explicit, sensitivity: "ordinary", provenance: {}, source: { artifactRevisionId: "artifact-revision-1", messageId: "message-1", explicitUserStatement: false, explicitUserId: null }, supersedesFactId: null, recordedBy: "user-1", idempotencyKey: "fact-1" });
		expect(result).toEqual({ outcome: "denied", reason: MemoryCatalogAtomicStatuses.InvalidCommand });
		expect(unitOfWork.run).not.toHaveBeenCalled();
	});

	it("requires exact authenticated provenance for an explicit user fact", async function _RequiresExplicitProvenance()
	{
		const unitOfWork = _UnitOfWork();
		const result = await __RecordMemoryFact(unitOfWork as never, { datasetId: "dataset-1", cogneeExternalId: "cognee-fact-1", contentDigest: `sha256:${"a".repeat(64)}`, consentState: MemoryFactConsentStates.Explicit, sensitivity: "ordinary", provenance: { user_statement: true, sourceKind: MemoryFactProvenanceSourceKinds.ExplicitUserFact, sourceUserId: "user-2" }, source: { artifactRevisionId: null, messageId: null, explicitUserStatement: true, explicitUserId: "user-1" }, supersedesFactId: null, recordedBy: "user-1", idempotencyKey: "fact-1" });
		expect(result).toEqual({ outcome: "denied", reason: MemoryCatalogAtomicStatuses.InvalidCommand });
		expect(unitOfWork.run).not.toHaveBeenCalled();
	});

	it("returns the declared correction-conflict denial after the unit of work rolls back", async function _DeniesCorrectionConflict()
	{
		const unitOfWork = { run: vi.fn().mockRejectedValue(new __MemoryCatalogCorrectionConflictError(new Error("rolled back"))) };
		const result = await __RecordMemoryFact(unitOfWork as never, { datasetId: "dataset-1", cogneeExternalId: "cognee-fact-1", contentDigest: `sha256:${"a".repeat(64)}`, consentState: MemoryFactConsentStates.Explicit, sensitivity: "ordinary", provenance: { questionId: "q1" }, source: { artifactRevisionId: null, messageId: "message-1", explicitUserStatement: false, explicitUserId: null }, supersedesFactId: "fact-previous", recordedBy: "user-1", idempotencyKey: "fact-1" });
		expect(result).toEqual({ outcome: "denied", reason: MemoryCatalogAtomicStatuses.CorrectionConflict });
	});
});
