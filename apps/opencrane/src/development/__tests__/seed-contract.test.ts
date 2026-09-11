import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/** Development-only seed applied after the reviewed target baseline. */
const _SEED = readFileSync(new URL("../../../prisma/development/seed.sql", import.meta.url), "utf8");

describe("Tier 2 development seed", function _Suite(): void
{
	it.each(["principals", "org_memberships", "model_definitions", "model_routing_defaults"])("supplies and refreshes the required timestamp for %s", function _Timestamp(table): void
	{
		const statement = _SEED.match(new RegExp(`INSERT INTO ${table} \\([\\s\\S]+?;`, "u"))?.[0] ?? "";
		expect(statement).toContain("updated_at");
		expect(statement).toContain("CURRENT_TIMESTAMP");
		expect(statement).toContain("updated_at = EXCLUDED.updated_at");
	});
});
