import { describe, expect, it } from "vitest";

import { _ProvidersOpenapiPaths } from "../openapi.js";

describe("provider API contract", () =>
{
	it("does not publish the retired plaintext provider-key routes", () =>
	{
		const retiredRoute = ["/providers", "keys"].join("/");
		expect(_ProvidersOpenapiPaths).not.toHaveProperty(retiredRoute);
		expect(_ProvidersOpenapiPaths).not.toHaveProperty(`${retiredRoute}/{provider}`);
	});
});
