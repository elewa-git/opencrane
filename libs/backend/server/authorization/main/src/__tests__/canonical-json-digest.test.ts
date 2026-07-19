import { describe, expect, it } from "vitest";

import { __DigestCanonicalJson } from "../canonical-json-digest.js";

describe("backend canonical JSON digest", function _suite()
{
	it("hashes UTF-8 RFC 8785 bytes independently of property insertion order", function _digest()
	{
		const expected = "sha256:0c9e1ac1b68e075054a0de68f258f989dc744c99aa179c9b9e9fe7ce6fb59f5a";

		expect(__DigestCanonicalJson({ action: "artifact.write", resource: { id: "artifact-7", kind: "artifact" } })).toBe(expected);
		expect(__DigestCanonicalJson({ resource: { kind: "artifact", id: "artifact-7" }, action: "artifact.write" })).toBe(expected);
	});
});
