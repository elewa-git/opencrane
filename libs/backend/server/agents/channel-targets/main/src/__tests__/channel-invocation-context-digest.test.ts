import { describe, expect, it } from "vitest";

import { __DigestChannelInvocationContext } from "../channel-invocation-context-digest.js";

describe("channel invocation context digest", function _Suite()
{
	it("produces the canonical raw-bearer SHA-256 lookup key", function _DigestsRawBearer()
	{
		expect(__DigestChannelInvocationContext("context-token")).toBe("sha256:50d68c4d4e2ef6965dd350a7d4a04b6c42252e1f617df8ae2d18221067231636");
	});
});
