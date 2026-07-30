import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

import type { MountedPublicKeySource } from "./mounted-public-key.types.js";

/**
 * Creates a reloadable source for one public key projected as a mounted file.
 *
 * Kubernetes replaces projected Secret files atomically. Reading on every use makes an in-place
 * rotation effective without extending old trust until a process restart.
 *
 * @param publicKeyPath - Absolute mounted path containing the public key.
 * @returns A source that fails closed when the current projection cannot be read.
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
