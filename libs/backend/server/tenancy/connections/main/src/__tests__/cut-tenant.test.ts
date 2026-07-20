import type * as k8s from "@kubernetes/client-node";
import { describe, expect, it, vi } from "vitest";

import { _CutTenant } from "../core/cut-tenant.js";

describe("_CutTenant", function _suite()
{
	it("force-deletes the single-user runtime pod by tenant label", async function _fullCut()
	{
		const deleteCollectionNamespacedPod = vi.fn().mockResolvedValue({});
		const coreApi = { deleteCollectionNamespacedPod } as unknown as k8s.CoreV1Api;

		const result = await _CutTenant(coreApi, { tenant: "t1", namespace: "tenants" });

		expect(deleteCollectionNamespacedPod).toHaveBeenCalledWith({
			namespace: "tenants",
			labelSelector: "opencrane.io/tenant=t1",
		});
		expect(result).toEqual({ tenant: "t1", podForceDeleted: true });
	});
});
