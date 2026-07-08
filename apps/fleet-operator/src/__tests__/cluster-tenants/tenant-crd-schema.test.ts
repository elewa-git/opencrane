import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import * as k8s from "@kubernetes/client-node";
import { describe, expect, it } from "vitest";

/**
 * Guards the Tenant CRD's STATUS schema against field pruning — the twin of
 * crd-schema.test.ts for the fields the silo TenantOperator writes. A structural schema
 * prunes undeclared status fields silently, which disables the writers that depend on
 * them: an unpruned `observedConfigChecksum` is what lets the reconcile-skip guard re-arm
 * on operator-config changes (#134), and `Degraded`/`degradedReason` carry the fail-safe
 * reconcile outcome (#144). Pruning either re-creates the endless MODIFIED→reconcile loop
 * the observedGeneration description warns about.
 */
const _CRD_PATH = fileURLToPath(new URL("../../../../fleet-platform/crds/tenant.opencrane.io_tenants.yaml", import.meta.url));

interface _CrdSchemaProps
{
  type?: string;
  // `@kubernetes/client-node`'s loadYaml renames the reserved `enum` key to `_enum`.
  _enum?: string[];
  properties?: Record<string, _CrdSchemaProps>;
  "x-kubernetes-preserve-unknown-fields"?: boolean;
}

function _loadTenantStatusSchema(): _CrdSchemaProps
{
  const crd = k8s.loadYaml(readFileSync(_CRD_PATH, "utf8")) as {
    spec: { versions: Array<{ schema: { openAPIV3Schema: _CrdSchemaProps } }> };
  };
  const status = crd.spec.versions[0].schema.openAPIV3Schema.properties?.status;
  if (!status) throw new Error("Tenant CRD has no status schema");
  return status;
}

describe("Tenant CRD structural schema — status fields the operator writes", function _suite()
{
  it("declares the Degraded phase and degradedReason (#144 fail-safe reconcile)", function ()
  {
    const status = _loadTenantStatusSchema();

    expect(status.properties?.phase?._enum, "status.phase enum must include Degraded or the API server rejects the fail-safe status patch").toContain("Degraded");
    expect(status.properties?.degradedReason?.type, "status.degradedReason must be a declared string or it is pruned").toBe("string");
  });

  it("declares observedConfigChecksum (#134 config-change re-reconcile guard)", function ()
  {
    const status = _loadTenantStatusSchema();

    // Pruned checksum never equals the operator's checksum ⇒ the guard never short-circuits
    // and every Running tenant re-reconciles (and re-writes status) on every watch event.
    expect(status.properties?.observedConfigChecksum?.type, "status.observedConfigChecksum must be declared or the reconcile-skip guard is defeated by pruning").toBe("string");
    expect(status.properties?.observedGeneration?.type, "status.observedGeneration must stay declared (same pruning rule)").toBe("integer");
  });
});
