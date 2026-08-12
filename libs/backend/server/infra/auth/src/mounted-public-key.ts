import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

import type { MountedPublicKeySource } from "./mounted-public-key.types.js";

/**
 * Create a reader for one public key that Kubernetes mounts into this container as a file.
 *
 * The file is re-read on every use rather than cached, because Kubernetes swaps a mounted
 * Secret file in one step: re-reading means a rotated key takes effect on the next
 * verification, instead of the old key staying trusted until the process restarts.
 *
 * The path must be absolute, so that a change of working directory cannot point trust at a
 * different file, and the file is read once here so that missing key material fails at
 * startup rather than on the first real request.
 *
 * Called by: libs/backend/server/iam/membership/main/src/fleet-membership-evidence.factory.ts
 *.
 *
 * @param publicKeyPath - Absolute path of the mounted public-key file.
 * @returns A reader whose `read()` returns the file contents as it is now.
 * @throws When the path is not absolute, and when the file cannot be read at creation time
 *         or on any later read — a key that cannot be read must fail, never verify.
 * @see https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/
 *      — projected volumes, whose atomic file replacement is what makes re-reading correct.
 */
export function _CreateMountedPublicKeySource(publicKeyPath: string): MountedPublicKeySource
{
  // 1. Accept only explicit absolute paths so process working-directory changes cannot redirect trust.
  if (!isAbsolute(publicKeyPath)) throw new Error("mounted public-key path must be absolute");

  /** Reads the currently projected key so rotations take effect on the next verification. */
  function _read(): string
  {
    return readFileSync(publicKeyPath, "utf8");
  }

  // 2. Read eagerly so missing trust material fails process composition, not the first live request.
  _read();

  return { read: _read };
}
