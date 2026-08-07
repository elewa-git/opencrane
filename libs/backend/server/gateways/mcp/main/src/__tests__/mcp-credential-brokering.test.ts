import { describe, expect, it } from "vitest";

import { _NormalizeCredentialInput } from "../core/mcp-servers.logic.js";

describe("_NormalizeCredentialInput", function _suite()
{
  it("persists OBO-only credential metadata without a static secret", function _oboOnly()
  {
    expect(_NormalizeCredentialInput("srv_1", { displayName: "GitHub OBO" })).toEqual({
      mcpServerId: "srv_1",
      displayName: "GitHub OBO",
    });
  });
});
