import { describe, expect, it } from "vitest";

import { _RenderAwarenessMetrics } from "../core/metrics.js";
import type { AwarenessRolloutState } from "../core/rollout.types.js";
import type { FleetParticipationReport, TenantParticipationStatus } from "../core/participation.types.js";

function _tenant(over: Partial<TenantParticipationStatus>): TenantParticipationStatus
{
	return {
		tenant: "t", lastSeenAt: null, runningContractVersion: null, expectedContractVersion: "awareness/v1alpha1",
		participating: true, drifted: false, policyViolations: 0, severity: "ok", ...over,
	};
}

const _ROLLOUT: AwarenessRolloutState = {
	targetVersion: "awareness/v2alpha1",
	stableVersion: "awareness/v1alpha1",
	waves: ["personal", "project", "department", "org"],
	promotedWaves: ["personal", "project"],
	shadowMode: false,
};

const _REPORT: FleetParticipationReport = {
	total: 3,
	participating: 2,
	drifted: 1,
	critical: 1,
	warning: 1,
	tenants: [
		_tenant({ tenant: "ok", severity: "ok" }),
		_tenant({ tenant: "drift", drifted: true, severity: "warning" }),
		_tenant({ tenant: "bad", policyViolations: 4, severity: "critical" }),
	],
};

describe("_RenderAwarenessMetrics (P4B.6)", function _suite()
{
	const out = _RenderAwarenessMetrics(_REPORT, _ROLLOUT);

	it("emits the fleet gauges with correct values", function _gauges()
	{
		expect(out).toContain("opencrane_awareness_tenants_total 3");
		expect(out).toContain("opencrane_awareness_participating_total 2");
		expect(out).toContain("opencrane_awareness_non_participating_total 1");
		expect(out).toContain("opencrane_awareness_drifted_total 1");
	});

	it("sums policy violations across the fleet (the paging metric)", function _violations()
	{
		expect(out).toContain("opencrane_awareness_policy_violations_total 4");
	});

	it("breaks tenants down by severity (ok = total - critical - warning)", function _severity()
	{
		expect(out).toContain("opencrane_awareness_tenants_by_severity{severity=\"critical\"} 1");
		expect(out).toContain("opencrane_awareness_tenants_by_severity{severity=\"warning\"} 1");
		expect(out).toContain("opencrane_awareness_tenants_by_severity{severity=\"ok\"} 1");
	});

	it("emits rollout frontier + info with escaped version labels", function _rollout()
	{
		expect(out).toContain("opencrane_awareness_rollout_promoted_waves 2");
		expect(out).toContain("opencrane_awareness_rollout_info{target=\"awareness/v2alpha1\",stable=\"awareness/v1alpha1\"} 1");
	});

	it("includes HELP/TYPE lines for scraper compliance", function _exposition()
	{
		expect(out).toContain("# TYPE opencrane_awareness_policy_violations_total gauge");
		expect(out).toContain("# HELP opencrane_awareness_drifted_total");
	});
});
