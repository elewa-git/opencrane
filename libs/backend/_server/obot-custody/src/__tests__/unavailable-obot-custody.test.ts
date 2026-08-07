import { describe, expect, it } from "vitest";

import { __UnavailableObotCustodyAdapter, ObotCustodyUnavailableError } from "../unavailable-obot-custody.js";

describe("unavailable Obot custody adapter", function _suite()
{
	it("fails closed without inventing a custody reference", async function _provision()
	{
		const adapter = new __UnavailableObotCustodyAdapter();
		await expect(adapter.provision({ siloId: "silo-1", integrationId: "integration-1", obotCatalogEntryId: "catalogue-1", credential: [{ name: "Authorization", value: "never-persisted" }] })).rejects.toBeInstanceOf(ObotCustodyUnavailableError);
	});
});
