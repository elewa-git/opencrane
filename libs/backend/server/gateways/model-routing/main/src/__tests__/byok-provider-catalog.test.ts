import { describe, expect, it } from "vitest";

import catalogArtifact from "../../byok-provider-catalog.json" with { type: "json" };
import { _BYOK_PROVIDER_CATALOG } from "../index";

describe("public BYOK provider catalogue", function _Suite()
{
	it("backs the typed production catalogue with the public artifact", function _SharedAuthority()
	{
		expect(_BYOK_PROVIDER_CATALOG).toEqual(catalogArtifact);
	});
});
