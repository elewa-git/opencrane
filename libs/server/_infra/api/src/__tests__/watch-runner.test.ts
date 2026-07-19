import { describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";

import { _RunWatchLoop } from "../watch-runner.js";

type WatchEventCallback = (type: string, resource: unknown) => void;
type WatchDoneCallback = (err: unknown) => void;
type WatchQuery = Record<string, string | number | boolean | undefined>;

/**
 * Build the minimal logger surface used by the watch runner.
 */
function _Logger(): Logger
{
  return {
    info: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

describe("_RunWatchLoop", () =>
{
  it("waits for a successful watch setup before resolving", async () =>
  {
    const calls: string[] = [];
    const watch = {
      watch: vi.fn(async function _watch(_path: string, _query: WatchQuery, _onEvent: WatchEventCallback, done: WatchDoneCallback)
      {
        calls.push(`watch:${calls.length}`);
        if (calls.length === 1)
        {
          done(new Error("setup failed"));
        }
        return new AbortController();
      }),
    };

    await _RunWatchLoop({
      watch: watch as any,
      path: "/apis/opencrane.io/v1alpha1/namespaces/default/tenants",
      log: _Logger(),
      startMessage: "starting watch",
      reconnectMessage: "watch lost",
      failedMessage: "watch failed",
      retryDelayMs: 0,
      onEvent: vi.fn(async function _onEvent() {}),
    });

    expect(watch.watch).toHaveBeenCalledTimes(2);
    expect(calls).toEqual(["watch:0", "watch:1"]);
  });

  it("reconnects in the background after an established watch closes", async () =>
  {
    let doneCallback!: (err: unknown) => void;
    const watch = {
      watch: vi.fn(async function _watch(_path: string, _query: WatchQuery, _onEvent: WatchEventCallback, done: WatchDoneCallback)
      {
        doneCallback = done;
        return new AbortController();
      }),
    };

    await _RunWatchLoop({
      watch: watch as any,
      path: "/apis/opencrane.io/v1alpha1/namespaces/default/tenants",
      log: _Logger(),
      startMessage: "starting watch",
      reconnectMessage: "watch lost",
      failedMessage: "watch failed",
      retryDelayMs: 0,
      onEvent: vi.fn(async function _onEvent() {}),
    });

    doneCallback(new Error("stream lost"));

    await vi.waitFor(function _waitForReconnect()
    {
      expect(watch.watch).toHaveBeenCalledTimes(2);
    });
  });
});
