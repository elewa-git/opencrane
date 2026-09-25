import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { _CreateMountedPublicKeySource } from "../mounted-public-key";

describe("_CreateMountedPublicKeySource", function _suite()
{
  it("reloads a newly projected key without restarting", function _test()
  {
    const directory = mkdtempSync(join(tmpdir(), "opencrane-mounted-key-"));
    const path = join(directory, "public-key.pem");
    writeFileSync(path, "first-key");
    const source = _CreateMountedPublicKeySource(path);
    expect(source.read()).toBe("first-key");

    writeFileSync(path, "second-key");
    expect(source.read()).toBe("second-key");
  });

  it("fails closed for a relative or absent mounted key", function _test()
  {
    expect(function _relative() { return _CreateMountedPublicKeySource("relative.pem"); }).toThrow("must be absolute");
    expect(function _absent() { return _CreateMountedPublicKeySource(join(tmpdir(), "opencrane-absent-key.pem")); }).toThrow();
  });
});
