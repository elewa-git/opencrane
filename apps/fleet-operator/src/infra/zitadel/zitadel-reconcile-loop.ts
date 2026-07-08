import type { Logger } from "pino";

import type { ZitadelReconcileSummary } from "../../routes/admin/zitadel-reconcile.types.js";

/** Default interval between periodic Zitadel reconcile runs: 6 hours. */
const _DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Read the periodic-reconcile interval from `ZITADEL_RECONCILE_INTERVAL_MS`.
 *
 * `0` explicitly disables the loop; an unset, empty, or non-numeric value falls back to the
 * 6-hour default so a missing chart value never silently disables the reconcile.
 *
 * @returns The interval in milliseconds (0 = disabled).
 */
export function _ReadZitadelReconcileIntervalMs(): number
{
  const raw = process.env.ZITADEL_RECONCILE_INTERVAL_MS?.trim() ?? "";
  if (!raw)
  {
    return _DEFAULT_INTERVAL_MS;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : _DEFAULT_INTERVAL_MS;
}

/**
 * Periodic Zitadel reconcile loop for the fleet-manager (#126 hardening).
 *
 * The on-demand `POST /api/v1/admin/zitadel/reconcile` heals half-provisioned orgs and adopts
 * Zitadel-Console-invited users as `Member` memberships — but only when someone calls it, so
 * org-user counts lag behind Console-only invites. This loop runs the exact same pass
 * (`_RunZitadelReconcile`, injected as `run`) on a fixed cadence so the fleet converges without
 * a manual trigger.
 *
 * Fail-soft (a run error is logged and the loop continues), overlap-safe (a tick is skipped
 * while the previous run is still in flight — reconcile can outlast a short interval), and
 * disabled by a non-positive interval. Follows the silo's projection-repairer loop pattern.
 */
export class ZitadelReconcileLoop
{
  /** The reconcile pass to execute each tick (the route's extracted core, pre-bound). */
  private readonly _run: () => Promise<ZitadelReconcileSummary>;

  /** Scoped logger. */
  private readonly _log: Logger;

  /** Run interval in milliseconds; 0 (or negative) disables the loop. */
  private readonly _intervalMs: number;

  /** Active interval handle; null when stopped/disabled. */
  private _timer: ReturnType<typeof setInterval> | null = null;

  /** Guards against overlapping runs when one outlasts the interval. */
  private _running = false;

  /**
   * @param run        - The reconcile pass to execute each tick.
   * @param log        - Pino logger; a scoped child is derived.
   * @param intervalMs - Run interval in ms (default 6 hours; 0 disables).
   */
  constructor(run: () => Promise<ZitadelReconcileSummary>, log: Logger, intervalMs = _DEFAULT_INTERVAL_MS)
  {
    this._run = run;
    this._log = log.child({ component: "zitadel-reconcile-loop" });
    this._intervalMs = intervalMs;
  }

  /**
   * Start the periodic loop. A run fires immediately so a freshly-deployed fleet converges
   * without waiting a full interval. A non-positive interval disables the loop entirely.
   */
  start(): void
  {
    if (this._intervalMs <= 0)
    {
      this._log.info("zitadel reconcile loop disabled (interval <= 0)");
      return;
    }
    this._log.info({ intervalMs: this._intervalMs }, "zitadel reconcile loop started");
    const loop = this;
    this._timer = setInterval(function _onTick() { void loop.tick(); }, this._intervalMs);
    void this.tick();
  }

  /** Stop the loop and release the interval handle. */
  stop(): void
  {
    if (this._timer !== null)
    {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * Execute one reconcile run. Skips (returns false) while a previous run is still in flight,
   * so a long reconcile never stacks concurrent passes. Never throws — a run failure is logged
   * and the loop retries on its next tick.
   *
   * @returns True when a run executed; false when skipped because one was already in flight.
   */
  async tick(): Promise<boolean>
  {
    if (this._running)
    {
      this._log.debug("zitadel reconcile tick skipped — previous run still in flight");
      return false;
    }
    this._running = true;
    try
    {
      const summary = await this._run();
      // Only log detail when the run changed or failed something — a converged fleet is quiet.
      const adopted = summary.memberAdoption.reduce(function _sum(n, r) { return n + r.adopted; }, 0);
      if (summary.reconciled.length > 0 || summary.failed.length > 0 || adopted > 0 || summary.memberAdoptionFailed.length > 0)
      {
        this._log.info({ reconciled: summary.reconciled.length, failed: summary.failed.length, adopted, adoptFailed: summary.memberAdoptionFailed.length }, "periodic zitadel reconcile run complete");
      }
    }
    catch (err)
    {
      // A run failure (Zitadel blip, DB hiccup) must not kill the loop — log and retry next tick.
      this._log.warn({ err }, "periodic zitadel reconcile run failed; will retry next interval");
    }
    finally
    {
      this._running = false;
    }
    return true;
  }
}
