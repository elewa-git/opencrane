import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { _CheckAuthorizationEnforcement, _FindUninventoriedAuthorizationPatterns, _ValidateAuthorizationEnforcementInventory } from "../authorization-enforcement-check.mjs";

/** Repository root used to qualify the committed inventory. */
const _ROOT = fileURLToPath(new URL("../../", import.meta.url));
/** Exact legacy call used by the fixture inventory. */
const _ANCHOR = "router.post(\"/resource\", _RequireOrgAdmin(), handler);";

/** Build one valid temporary inventory over the supplied fixture source. */
function _Inventory()
{
	return {
		version: 1,
		policy: "Every legacy authorization decision has one exact temporary source anchor and deletion wave.",
		catalogueGaps: [],
		entries: [{
			id: "fixture.resource-create",
			actor: "human",
			resource: "artifact",
			action: "create",
			currentPath: { path: "libs/domain/src/router.ts", anchor: _ANCHOR, expectedOccurrences: 1 },
			targetAuthority: "AuthorizationAuthority.admitDecision",
			lifecycleOwner: "libs/domain",
			receiptClass: "decision",
			migrationState: "temporary-migration",
			removeByWave: "data-and-actions",
			forbiddenPatterns: ["legacy-org-admin-middleware"],
		}],
	};
}

/** Create a disposable repository-shaped tree with one inventoried legacy route. */
function _Fixture()
{
	const root = mkdtempSync(join(tmpdir(), "opencrane-authorization-enforcement-"));
	mkdirSync(join(root, "docs/agents"), { recursive: true });
	mkdirSync(join(root, "libs/domain/src"), { recursive: true });
	writeFileSync(join(root, "libs/domain/src/router.ts"), `${_ANCHOR}\n`);
	return root;
}

/** Remove a complete temporary fixture. */
function _Remove(root)
{
	rmSync(root, { recursive: true, force: true });
}

test("accepts one exact temporary migration binding", function _AcceptsExactBinding()
{
	const root = _Fixture();
	try
	{
		const inventory = _Inventory();
		assert.deepEqual(_ValidateAuthorizationEnforcementInventory(inventory, root), []);
		assert.deepEqual(_FindUninventoriedAuthorizationPatterns(root, inventory), []);
	}
	finally
	{
		_Remove(root);
	}
});

test("rejects malformed, duplicate, stale, and unregistered catalogue data", function _RejectsInventoryDrift()
{
	const root = _Fixture();
	try
	{
		const inventory = _Inventory();
		inventory.entries.push({ ...inventory.entries[0] });
		inventory.entries[0].currentPath.expectedOccurrences = 2;
		inventory.entries[0].resource = "unregistered-resource";
		inventory.entries[0].forbiddenPatterns = ["invented-compatibility-exemption"];
		const errors = _ValidateAuthorizationEnforcementInventory(inventory, root);
		assert.ok(errors.some(function _Duplicate(error) { return error.includes("duplicate id"); }));
		assert.ok(errors.some(function _DuplicateAnchor(error) { return error.includes("duplicate source anchor"); }));
		assert.ok(errors.some(function _Stale(error) { return error.includes("stale anchor"); }));
		assert.ok(errors.some(function _Gap(error) { return error.includes("without a declared gap"); }));
		assert.ok(errors.some(function _Pattern(error) { return error.includes("unknown forbidden pattern"); }));
	}
	finally
	{
		_Remove(root);
	}
});

test("rejects a new forbidden decision outside the exact inventoried anchor", function _RejectsNewBypass()
{
	const root = _Fixture();
	try
	{
		writeFileSync(join(root, "libs/domain/src/second-router.ts"), "router.delete(\"/resource\", _RequireOrgAdmin(), handler);\n");
		const findings = _FindUninventoriedAuthorizationPatterns(root, _Inventory());
		assert.equal(findings.length, 1);
		assert.match(findings[0], /second-router\.ts:1 legacy-org-admin-middleware/u);
	}
	finally
	{
		_Remove(root);
	}
});

test("does not let an adopted entry retain forbidden syntax", function _RejectsPermanentExemption()
{
	const root = _Fixture();
	try
	{
		const inventory = _Inventory();
		inventory.entries[0].migrationState = "authority-adopted";
		inventory.entries[0].removeByWave = null;
		const errors = _ValidateAuthorizationEnforcementInventory(inventory, root);
		assert.ok(errors.some(function _TemporaryOnly(error) { return error.includes("only temporary migrations"); }));
		assert.equal(_FindUninventoriedAuthorizationPatterns(root, inventory).length, 1);
	}
	finally
	{
		_Remove(root);
	}
});

test("keeps the committed enforcement inventory synchronized with production", function _ChecksRepositoryInventory()
{
	assert.deepEqual(_CheckAuthorizationEnforcement(_ROOT), []);
});
