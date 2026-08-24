import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { _CheckDurableBoundary } from "../durable-boundary-check.mjs";

/** Repository root used to prove every review pipeline runs this check. */
const _ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Create one disposable repository-shaped directory for a boundary test. */
function _Fixture()
{
	const root = mkdtempSync(join(tmpdir(), "opencrane-durable-boundary-"));
	const workflows = join(root, "libs/backend/server/infra/workflows");
	mkdirSync(join(workflows, "infra_absurd"), { recursive: true });
	mkdirSync(join(workflows, "kit"), { recursive: true });
	return { root, workflows };
}

/** Remove a temporary fixture after each isolated assertion. */
function _Remove(root)
{
	rmSync(root, { recursive: true, force: true });
}

test("allows absurd-sdk only in the Absurd adapter", function _AllowsAdapterImport()
{
	const fixture = _Fixture();
	try
	{
		writeFileSync(join(fixture.workflows, "infra_absurd", "adapter.ts"), "import { Absurd } from \"absurd-sdk\";\nvoid Absurd;\n");
		assert.deepEqual(_CheckDurableBoundary(fixture.root), []);
	}
	finally
	{
		_Remove(fixture.root);
	}
});

test("rejects engine imports outside the adapter and domain imports inside workflows", function _RejectsBoundaryCrossing()
{
	const fixture = _Fixture();
	try
	{
		writeFileSync(join(fixture.workflows, "kit", "engine.ts"), "import { Absurd } from \"absurd-sdk\";\nimport { _Anything } from \"@opencrane/backend/agents/example\";\nvoid Absurd;\nvoid _Anything;\n");
		const violations = _CheckDurableBoundary(fixture.root);
		assert.equal(violations.length, 2);
		assert.match(violations[0], /absurd-sdk/u);
		assert.match(violations[1], /domain package/u);
	}
	finally
	{
		_Remove(fixture.root);
	}
});

test("keeps pull-request and nightly CI on the durable boundary check", function _VerifiesPipeline()
{
	for (const path of [".github/workflows/docker.yml", ".github/workflows/nightly.yml"])
	{
		const source = readFileSync(join(_ROOT, path), "utf8");
		assert.match(source, /check:durable-boundary/u, path);
		assert.match(source, /test:durable-boundary/u, path);
	}
});
