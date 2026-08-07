import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("independent target acceptance fixtures", function ()
{
  it("covers every approved Phase C product boundary", function ()
  {
    const fixturePath = join(process.cwd(), "../../docs/design/personal-agent-platform-phase-c-acceptance-fixtures.json");
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { source: string; cases: { id: string }[] };
    const caseIds = fixture.cases.map(testCase => testCase.id);

    expect(fixture.source).toBe("target-product-intent");
    expect(caseIds).toEqual(expect.arrayContaining([
      "persona-first-session-approved",
      "persona-first-session-denied-without-approval",
      "cross-functional-project-membership",
      "equal-priority-deny-wins",
      "signed-membership-replay-rejected",
      "signed-membership-expiry-fails-closed",
      "managed-agent-personal-boundary",
      "durable-storage-contract",
      "runtime-scratch-contract",
      "future-update-readiness",
    ]));
  });
});
