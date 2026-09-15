import { _ConversationAssetsOpenapiPaths } from "@opencrane/backend/server/conversation-assets";
import { spec } from "@opencrane/backend/server/api-spec";
import { describe, expect, it } from "vitest";

import { _CreatePublicOpenapiSpec } from "../openapi-composition";

describe("public OpenAPI profile", function _Suite(): void
{
	it("omits exactly the conversation-file paths unavailable in Tier 2", function _OmitsDevelopmentFiles(): void
	{
		const localSpec = _CreatePublicOpenapiSpec(false);
		const unavailablePaths = Object.keys(_ConversationAssetsOpenapiPaths);
		const retainedPathCount = Object.keys(spec.paths).length - unavailablePaths.length;

		for (const path of unavailablePaths)
			expect(Object.hasOwn(localSpec.paths, path)).toBe(false);

		expect(Object.keys(localSpec.paths)).toHaveLength(retainedPathCount);
		expect(localSpec).not.toBe(spec);
	});

	it("keeps the complete production document as the generated-client authority", function _KeepsProductionSpec(): void
	{
		expect(_CreatePublicOpenapiSpec(true)).toBe(spec);
	});
});
