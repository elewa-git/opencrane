import type { Logger } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ZitadelReconcileLoop, _ReadZitadelReconcileIntervalMs } from "../../infra/zitadel/zitadel-reconcile-loop.js";
import type { ZitadelReconcileSummary } from "../../routes/admin/zitadel-reconcile.types.js";

/**
 * #126 hardening — the periodic Zitadel reconcile loop's SCHEDULING contract (the reconcile
 * pass itself is covered by the route tests over `_RunZitadelReconcile`). Pinned here:
 *   - interval 0 disables the loop entirely (no immediate run, no timer);
 *   - a tick is skipped (not queued) while the previous run is still in flight;
 *   - a run failure is logged and never throws, so the loop survives to its next tick;
 *   - the env parser defaults to 6h, honours an explicit 0, and rejects garbage.
 */

/** A converged (all-quiet) run summary. */
const _EMPTY_SUMMARY: ZitadelReconcileSummary = { reconciled: [], skipped: [], failed: [], memberAdoption: [], memberAdoptionFailed: [] };

/** Logger stub whose `child` returns itself so the loop's scoped logger stays spyable. */
function _stubLog(): Logger
{
  const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), child: vi.fn() } as unknown as Logger;
  (log.child as ReturnType<typeof vi.fn>).mockReturnValue(log);
  return log;
}

describe("ZitadelReconcileLoop — scheduling contract", function _suite()
{
  afterEach(function _restoreTimers() { vi.useRealTimers(); });

  it("interval 0 disables the loop: no immediate run and no scheduled ticks", async function _disabled()
  {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue(_EMPTY_SUMMARY);
    const loop = new ZitadelReconcileLoop(run, _stubLog(), 0);

    loop.start();
    await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000); // two days of fake time

    expect(run).not.toHaveBeenCalled();
    loop.stop();
  });

  it("skips a tick while the previous run is still in flight (no concurrent passes)", async function _overlap()
  {
    // A run we hold open manually so a second tick arrives mid-flight.
    let release: (() => void) | undefined;
    const gate = new Promise<void>(function _hold(resolve) { release = resolve; });
    const run = vi.fn(async function _slowRun() { await gate; return _EMPTY_SUMMARY; });
    const loop = new ZitadelReconcileLoop(run, _stubLog(), 60_000);

    // First tick starts the run; the second lands while it is in flight and must be SKIPPED.
    const first = loop.tick();
    const second = await loop.tick();
    expect(second).toBe(false);
    expect(run).toHaveBeenCalledOnce();

    // Once the run completes, the next tick executes again — the guard resets.
    release?.();
    await expect(first).resolves.toBe(true);
    await expect(loop.tick()).resolves.toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("logs a run failure and keeps ticking (never throws)", async function _failSoft()
  {
    const log = _stubLog();
    const run = vi.fn().mockRejectedValueOnce(new Error("zitadel down")).mockResolvedValue(_EMPTY_SUMMARY);
    const loop = new ZitadelReconcileLoop(run, log, 60_000);

    await expect(loop.tick()).resolves.toBe(true); // the failed run still counts as executed
    expect(log.warn).toHaveBeenCalledOnce();

    // The failure did not wedge the in-flight guard — the next tick runs normally.
    await expect(loop.tick()).resolves.toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("_ReadZitadelReconcileIntervalMs — env parsing", function _envSuite()
{
  afterEach(function _restoreEnv() { delete process.env.ZITADEL_RECONCILE_INTERVAL_MS; });

  it("defaults to 6 hours when unset or empty", function _default()
  {
    delete process.env.ZITADEL_RECONCILE_INTERVAL_MS;
    expect(_ReadZitadelReconcileIntervalMs()).toBe(21_600_000);
    process.env.ZITADEL_RECONCILE_INTERVAL_MS = "  ";
    expect(_ReadZitadelReconcileIntervalMs()).toBe(21_600_000);
  });

  it("honours an explicit 0 (disabled) and a custom interval", function _explicit()
  {
    process.env.ZITADEL_RECONCILE_INTERVAL_MS = "0";
    expect(_ReadZitadelReconcileIntervalMs()).toBe(0);
    process.env.ZITADEL_RECONCILE_INTERVAL_MS = "3600000";
    expect(_ReadZitadelReconcileIntervalMs()).toBe(3_600_000);
  });

  it("falls back to the default on garbage or negative values (never silently disables)", function _garbage()
  {
    process.env.ZITADEL_RECONCILE_INTERVAL_MS = "six hours";
    expect(_ReadZitadelReconcileIntervalMs()).toBe(21_600_000);
    process.env.ZITADEL_RECONCILE_INTERVAL_MS = "-5";
    expect(_ReadZitadelReconcileIntervalMs()).toBe(21_600_000);
  });
});
