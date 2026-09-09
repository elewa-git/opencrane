import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PRODUCT_AUTHORIZATION_CATALOG_DIGEST, PRODUCT_AUTHORIZATION_CATALOG_ID } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";
import { describe, expect, it } from "vitest";

/** The reviewed fresh-install baseline that seeds the catalogue every grant references. */
const _BASELINE = resolve(import.meta.dirname, "../../prisma/bootstrap/target-baseline.sql");

/** Pull the seeded digest and capability payload for one catalogue id out of the baseline SQL. */
function _SeededCatalogue(catalogId: string): { readonly digest: string; readonly capabilities: unknown }
{
	const sql = readFileSync(_BASELINE, "utf8");
	const seed = new RegExp(`'${catalogId}',\\s*\\n\\s*1,\\s*\\n\\s*'(sha256:[0-9a-f]{64})',\\s*\\n\\s*'(\\[.*?\\])'::jsonb,`, "u").exec(sql);
	if (seed === null)
		throw new Error(`target baseline does not seed catalogue ${catalogId}`);
	return { digest: seed[1], capabilities: JSON.parse(seed[2].replaceAll("''", "'")) };
}

describe("product authorization catalogue seed", function _Suite()
{
	it("seeds the exact capabilities and digest the TypeScript catalogue declares", function _MatchesCode()
	{
		const seeded = _SeededCatalogue(PRODUCT_AUTHORIZATION_CATALOG_ID);
		// The code constant is the canonical digest of the TypeScript catalogue, so matching it proves
		// the seeded payload carries the same capabilities and the seeded digest is honest.
		expect(seeded.digest).toBe(PRODUCT_AUTHORIZATION_CATALOG_DIGEST);
		expect(___DigestCanonicalJson(seeded.capabilities as JsonValue)).toBe(PRODUCT_AUTHORIZATION_CATALOG_DIGEST);
	});
});
