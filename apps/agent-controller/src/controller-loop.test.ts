import { describe, expect, it, vi } from "vitest";

import type { AgentControllerDependencies } from "@opencrane/backend/agent-controller";

import { _ReconcileOnce } from "./controller-loop.js";
import type { ControllerLoopLogger, ControllerReadiness } from "./controller-loop.types.js";

/** Builds a complete controller dependency graph which returns no current desired Job. */
function _Dependencies(failAuthority = false, failKubernetes = false): AgentControllerDependencies
{
	return {
		policy: { runtimeNamespace: "opencrane-runtime", runtimeServiceAccountName: "agent-runtime", runtimeImage: "ghcr.io/opencrane/agent-runtime@sha256:abc" },
		desiredJobs: { async readNext() { if (failAuthority) throw new Error("authority unavailable"); return null; } },
		jobs: {
			async check() { if (failKubernetes) throw new Error("Kubernetes unavailable"); },
			async get() { return null; },
			async createSuspended() { throw new Error("unexpected create"); },
			async delete() {},
			async unsuspend() {},
			async firstPodUid() { return null; },
		},
		status: {
			async rejectDesired() {},
			async recordJob() { return { bootstrapReady: false }; },
			async recordPod() {},
		},
	};
}

/** Builds observable probe readiness and structured logger doubles. */
function _Fixture(): { readonly readiness: ControllerReadiness; readonly logger: ControllerLoopLogger; readonly info: ReturnType<typeof vi.fn>; readonly warn: ReturnType<typeof vi.fn> }
{
	const info = vi.fn();
	const warn = vi.fn();
	return { readiness: { markReady: vi.fn(), markUnready: vi.fn() }, logger: { info, warn }, info, warn };
}

describe("controller reconciliation readiness", function _describeLoop()
{
	it("becomes ready only after a complete successful reconciliation", async function _marksReadyAfterSuccess()
	{
		const fixture = _Fixture();
		await _ReconcileOnce(_Dependencies(), fixture.readiness, fixture.logger);

		expect(fixture.readiness.markReady).toHaveBeenCalledOnce();
		expect(fixture.readiness.markUnready).not.toHaveBeenCalled();
	});

	it("withdraws readiness after a reconciliation failure without throwing from the loop", async function _withdrawsReadiness()
	{
		const fixture = _Fixture();
		await expect(_ReconcileOnce(_Dependencies(true), fixture.readiness, fixture.logger)).resolves.toBeUndefined();

		expect(fixture.readiness.markReady).not.toHaveBeenCalled();
		expect(fixture.readiness.markUnready).toHaveBeenCalledOnce();
		expect(fixture.warn).toHaveBeenCalledOnce();
	});

	it("withdraws readiness when idle authority polling cannot prove Kubernetes Job-list access", async function _withdrawsReadinessOnKubernetesFailure()
	{
		const fixture = _Fixture();
		await expect(_ReconcileOnce(_Dependencies(false, true), fixture.readiness, fixture.logger)).resolves.toBeUndefined();

		expect(fixture.readiness.markReady).not.toHaveBeenCalled();
		expect(fixture.readiness.markUnready).toHaveBeenCalledOnce();
	});
});
