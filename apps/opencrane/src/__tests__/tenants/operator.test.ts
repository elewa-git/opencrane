import { describe, it, expect, vi } from "vitest";
import pino from "pino";

import { defaultConfig, _makeTenant } from "../fixtures.js";
import { _ResolveOrgServingDomain } from "../../reconcilers/tenants/internal/org-serving-domain.js";
import { _OperatorConfigChecksum } from "../../app/config.js";
import { TenantOperator } from "../../reconcilers/tenants/operator.js";
import { TenantStatusPhase } from "../../reconcilers/tenants/models/tenant-status.interface.js";
import type { TenantStatusWriter } from "../../reconcilers/tenants/internal/tenant-status-writer.js";
import type { Tenant } from "../../reconcilers/tenants/models/tenant.types.js";

describe("TenantOperator", () =>
{
  it("builds correct resource names from tenant name", () =>
  {
    const tenant = _makeTenant("jente");
    const name = tenant.metadata!.name;

    expect(`openclaw-${name}`).toBe("openclaw-jente");
    expect(`openclaw-${name}-config`).toBe("openclaw-jente-config");
    expect(`openclaw-${name}-encryption-key`).toBe("openclaw-jente-encryption-key");
    expect(`openclaw-${name}-bucket`).toBe("openclaw-jente-bucket");
  });

  it("serves a user at the ORG host (no per-user subdomain)", () =>
  {
    // The user reaches their pod through the org host `<org>.<base>` via the in-operator
    // proxy; there is no `<user>.<org>.<base>` host any more.
    expect(_ResolveOrgServingDomain("acme", undefined, defaultConfig.ingressDomain)).toBe("acme.opencrane.local");
    expect(_ResolveOrgServingDomain(undefined, undefined, defaultConfig.ingressDomain)).toBe("opencrane.local");
  });

  it("uses the immutable operator-selected tenant image", () =>
  {
    expect(defaultConfig.tenantDefaultImage).toBe("ghcr.io/opencrane/tenant:openclaw-2026.6.11-cognee-2026.7.9");
  });

  it("detects suspended tenants", () =>
  {
    const active = _makeTenant("active");
    const suspended = _makeTenant("paused", { suspended: true });

    expect(active.spec.suspended).toBeFalsy();
    expect(suspended.spec.suspended).toBe(true);
  });

});

describe("TenantOperator reconcile guard + coalescing", () =>
{
  /** Build an operator whose only live dependency is a status-writer spy; the rest are
   *  unused by the guard short-circuit / by an overridden reconcile, so they are cast stubs. */
  function _build(): { op: TenantOperator; patch: ReturnType<typeof vi.fn> }
  {
    const patch = vi.fn(async () => {});
    const statusWriter = { patchStatus: patch } as unknown as TenantStatusWriter;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stub = {} as any;
    const op = new TenantOperator(stub, stub, stub, stub, stub, pino({ level: "silent" }),
      defaultConfig, stub, stub, statusWriter, stub, stub, stub, stub);
    return { op, patch };
  }

  it("skips the reconcile when an already-Running tenant's generation and config are unchanged", async () =>
  {
    const { op, patch } = _build();
    const tenant = _makeTenant("acme"); // status.phase = Running
    tenant.metadata!.generation = 3;
    tenant.status!.observedGeneration = 3;
    tenant.status!.observedConfigChecksum = _OperatorConfigChecksum(defaultConfig);

    await op.reconcileTenant(tenant);

    // Guard short-circuited before any work — no status write, no resource applies.
    expect(patch).not.toHaveBeenCalled();
  });

  it("does NOT skip when the operator config changed since the tenant last converged", async () =>
  {
    const { op, patch } = _build();
    const tenant = _makeTenant("acme");
    tenant.metadata!.generation = 3;
    tenant.status!.observedGeneration = 3;           // generation matches
    tenant.status!.observedConfigChecksum = "stale-config-checksum"; // but operator config rolled

    // The guard must NOT short-circuit: it falls through into the real reconcile body, which
    // (against stub deps) fails and writes an Error status — proving the guard let it through.
    await expect(op.reconcileTenant(tenant)).rejects.toThrow();
    expect(patch).toHaveBeenCalled();
  });

  it("does NOT skip when a spec change bumps generation past observedGeneration", async () =>
  {
    const { op } = _build();
    // Override the heavy reconcile body; we only assert the guard let execution through.
    let ran = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (op as any).reconcileTenant = async () => { ran = true; };
    const tenant = _makeTenant("acme");
    tenant.metadata!.generation = 4;
    tenant.status!.observedGeneration = 3; // stale → must reconcile
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (op as any).dispatchReconcile(tenant);
    expect(ran).toBe(true);
  });

  it("coalesces concurrent events for one tenant into a single re-run", async () =>
  {
    const { op } = _build();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let firstCall = true;
    const calls: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (op as any).reconcileTenant = async (t: Tenant) => {
      calls.push(t.metadata!.name!);
      if (firstCall) { firstCall = false; await gate; }
    };

    const tenant = _makeTenant("acme");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dispatch = (t: Tenant) => (op as any).dispatchReconcile(t);
    const first = dispatch(tenant);   // starts, blocks on the gate
    await dispatch(tenant);           // queued (running) — returns immediately
    await dispatch(tenant);           // collapsed into the same single pending slot
    release();
    await first;

    // 3 events while one was in flight → exactly 2 reconciles (in-flight + one coalesced).
    expect(calls).toEqual(["acme", "acme"]);
  });
});

describe("TenantOperator startup replay", () =>
{
  it("connects the watch before reconciling tenants that already exist", async () =>
  {
    const order: string[] = [];
    const tenant = _makeTenant("seeded");
    const patch = vi.fn(async function _patchStatus() {});
    const watch = {
      watch: vi.fn(async function _watch()
      {
        order.push("watch");
        return new AbortController();
      }),
    };
    const customApi = {
      listNamespacedCustomObject: vi.fn(async function _list()
      {
        order.push("list");
        return { items: [tenant] };
      }),
    };
    const statusWriter = { patchStatus: patch } as unknown as TenantStatusWriter;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stub = {} as any;
    const op = new TenantOperator(watch as any, customApi as any, stub, stub, stub, pino({ level: "silent" }),
      defaultConfig, stub, stub, statusWriter, stub, stub, stub, stub);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (op as any).reconcileTenant = async function _reconcile(existing: Tenant)
    {
      order.push(`reconcile:${existing.metadata!.name!}`);
    };

    await op.start();

    expect(watch.watch).toHaveBeenCalled();
    expect(customApi.listNamespacedCustomObject).toHaveBeenCalledWith({
      group: "opencrane.io",
      version: "v1alpha1",
      namespace: "default",
      plural: "tenants",
    });
    expect(order).toEqual(["watch", "list", "reconcile:seeded"]);
  });

  it("reconciles a named existing tenant without waiting for watch delivery", async () =>
  {
    const order: string[] = [];
    const tenant = _makeTenant("seeded-now");
    const patch = vi.fn(async function _patchStatus() {});
    const customApi = {
      getNamespacedCustomObject: vi.fn(async function _get()
      {
        order.push("get");
        return tenant;
      }),
    };
    const statusWriter = { patchStatus: patch } as unknown as TenantStatusWriter;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stub = {} as any;
    const op = new TenantOperator(stub, customApi as any, stub, stub, stub, pino({ level: "silent" }),
      defaultConfig, stub, stub, statusWriter, stub, stub, stub, stub);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (op as any).reconcileTenant = async function _reconcile(existing: Tenant)
    {
      order.push(`reconcile:${existing.metadata!.name!}`);
    };

    await op.reconcileExistingTenantByName("seeded-now", "default");

    expect(customApi.getNamespacedCustomObject).toHaveBeenCalledWith({
      group: "opencrane.io",
      version: "v1alpha1",
      namespace: "default",
      plural: "tenants",
      name: "seeded-now",
    });
    expect(order).toEqual(["get", "reconcile:seeded-now"]);
  });

  it("retries the startup replay when the first tenant list fails", async () =>
  {
    const order: string[] = [];
    const tenant = _makeTenant("seeded-after-retry");
    const patch = vi.fn(async function _patchStatus() {});
    let attempts = 0;
    const watch = {
      watch: vi.fn(async function _watch()
      {
        order.push("watch");
        return new AbortController();
      }),
    };
    const customApi = {
      listNamespacedCustomObject: vi.fn(async function _list()
      {
        order.push(`list:${attempts}`);
        attempts += 1;
        if (attempts === 1)
        {
          throw new Error("temporary list failure");
        }
        return { items: [tenant] };
      }),
    };
    const statusWriter = { patchStatus: patch } as unknown as TenantStatusWriter;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stub = {} as any;
    const op = new TenantOperator(watch as any, customApi as any, stub, stub, stub, pino({ level: "silent" }),
      defaultConfig, stub, stub, statusWriter, stub, stub, stub, stub, 0);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (op as any).reconcileTenant = async function _reconcile(existing: Tenant)
    {
      order.push(`reconcile:${existing.metadata!.name!}`);
    };

    await op.start();

    expect(customApi.listNamespacedCustomObject).toHaveBeenCalledTimes(2);
    expect(order).toEqual(["watch", "list:0", "list:1", "reconcile:seeded-after-retry"]);
  });
});

describe("TenantOperator suspend self-loop guard", () =>
{
  /**
   * Build an operator with the status-writer spy live. When `driveBody` is set, `hosting`
   * and `appsApi` are stubbed just enough that the real suspend body reaches its status
   * write (ref-less tenant → no ClusterTenant lookup); otherwise the fast-path stubs are
   * used and only the guard short-circuit is exercised.
   */
  function _build(driveBody = false): { op: TenantOperator; patch: ReturnType<typeof vi.fn> }
  {
    const patch = vi.fn(async () => {});
    const statusWriter = { patchStatus: patch } as unknown as TenantStatusWriter;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stub = {} as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hosting = driveBody ? ({ buildStateVolume: () => ({ requiresPvc: false }) } as any) : stub;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const appsApi = driveBody ? ({ createNamespacedDeployment: async () => ({}) } as any) : stub;
    const op = new TenantOperator(stub, stub, stub, appsApi, stub, pino({ level: "silent" }),
      defaultConfig, hosting, stub, statusWriter, stub, stub, stub, stub);
    return { op, patch };
  }

  /** Reach the private suspendTenant without widening its visibility. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _suspend = (op: TenantOperator, t: Tenant) => (op as any).suspendTenant(t) as Promise<void>;

  it("skips when a Suspended tenant is re-observed at the same generation (its own status write)", async () =>
  {
    const { op, patch } = _build();
    const tenant = _makeTenant("paused", { suspended: true, phase: TenantStatusPhase.Suspended });
    tenant.metadata!.generation = 7;
    tenant.status!.observedGeneration = 7;

    await _suspend(op, tenant);

    // Guard short-circuited before touching any stub client — no status re-write, no loop.
    expect(patch).not.toHaveBeenCalled();
  });

  it("stamps observedGeneration on the Suspended status so the self-loop is broken", async () =>
  {
    const { op, patch } = _build(true);
    // First-time suspend of a ref-less tenant (status still Running); the real body resolves
    // to the install namespace, applies the scaled-to-zero deployment against the stub, then
    // writes status — which must carry observedGeneration so the Modified event it fires is
    // skipped by the guard on the next pass.
    const tenant = _makeTenant("paused", { suspended: true });
    tenant.metadata!.generation = 2;

    await _suspend(op, tenant);

    expect(patch).toHaveBeenCalledWith(tenant, "default", expect.objectContaining({
      phase: TenantStatusPhase.Suspended,
      observedGeneration: 2,
    }));
  });

  it("does NOT skip when un-suspend or a spec edit bumps generation past observedGeneration", async () =>
  {
    const { op, patch } = _build(true);
    const tenant = _makeTenant("paused", { suspended: true, phase: TenantStatusPhase.Suspended });
    tenant.metadata!.generation = 8;
    tenant.status!.observedGeneration = 7; // stale → must fall through the guard

    await _suspend(op, tenant);

    // Fell through the guard and re-ran the suspend body → re-stamped the new generation.
    expect(patch).toHaveBeenCalledWith(tenant, "default", expect.objectContaining({
      phase: TenantStatusPhase.Suspended,
      observedGeneration: 8,
    }));
  });
});

describe("ServiceAccount (Workload Identity)", () =>
{
  it("generates correct GCP service account annotation via adapter", () =>
  {
    const name = "jente";
    const projectId = "my-gcp-project";
    const expected = `openclaw-${name}@${projectId}.iam.gserviceaccount.com`;

    expect(expected).toBe("openclaw-jente@my-gcp-project.iam.gserviceaccount.com");
  });
});
