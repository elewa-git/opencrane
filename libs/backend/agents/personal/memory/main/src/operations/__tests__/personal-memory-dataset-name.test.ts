import { ___MemoryGatewayDatasetEnsureRequestSchema } from "@opencrane/contracts";
import { describe, expect, it } from "vitest";

import { __PersonalMemoryProviderDatasetName } from "../personal-memory-dataset-name";

describe("personal-memory provider dataset name", function _DescribeDatasetName()
{
	it("produces a gateway-valid stable name for a short saved catalog id", function _DerivesValidName()
	{
		const datasetId = "cmemorycatalog000000000001";
		const datasetName = __PersonalMemoryProviderDatasetName(datasetId);
		expect(___MemoryGatewayDatasetEnsureRequestSchema.safeParse({ datasetName }).success).toBe(true);
		expect(__PersonalMemoryProviderDatasetName(datasetId)).toBe(datasetName);
		expect(__PersonalMemoryProviderDatasetName("cmemorycatalog000000000002")).not.toBe(datasetName);
		expect(datasetName).not.toContain(datasetId);
	});

	it.each(["", " catalog-id", "catalog-id ", "a".repeat(129)])("refuses a noncanonical catalog id", function _RejectsInvalidId(datasetId)
	{
		expect(function _Derive() { return __PersonalMemoryProviderDatasetName(datasetId); }).toThrow("personal memory dataset identifier cannot form a provider name");
	});
});
