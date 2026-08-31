# @opencrane/backend/server/infra/agent-runtime-continuation — checkpoint encryption

> [OpenCrane](../../../../../README.md) › [backend](../../../README.md) › [server](../../README.md) › [infra](../README.md) › agent runtime continuation

## What it owns

An agent runtime is the process that runs an agent's model loop. When that process waits for an
outside tool or a person's answer, OpenCrane saves the loop state so another runtime can continue
after the original Pod disappears. This package encrypts and decrypts that saved state.

```text
 runtime pause state
        │ plaintext, only in server memory
        ▼
 ┌────────────────────────────────────┐
 │ continuation encryption  ◄── HERE   │  current Secret key + exact row coordinates
 └──────────────────┬─────────────────┘
                    │ ciphertext only
                    ▼
          runtime checkpoint row
```

**In this flow:** [runtime protocol](../../../agents/execution/protocol/README.md) ·
[agent runtime stream](../agent-runtime-stream/README.md)

## Public surface

- `MountedRuntimeContinuationCipher` encrypts with AES-256-GCM and reads the mounted keyring again
  for every operation, so the active key can rotate without restarting the server.
- `RuntimeContinuationCipher` is the small port used by the durable protocol adapter.
- `RuntimeContinuationAssociatedData` names the exact row coordinates authenticated with the
  ciphertext.
- `SealedRuntimeContinuation` carries the key identifier, nonce, ciphertext, and authentication
  tag without exposing plaintext.

## Boundary

The keyring is a JSON file with `activeKeyId` and a `keys` map of base64-encoded 32-byte keys. Old
keys remain in the map until no database row refers to them. The package keeps no key or plaintext
on the class and writes neither to logs.

Each ciphertext authenticates its version, run, attempt, input generation, and revision. Moving a
row to different coordinates or changing any encrypted byte makes decryption fail closed. A missing,
malformed, or incomplete keyring also fails the request; it never falls back to plaintext.

## Dependency direction

The execution protocol depends on this infrastructure adapter through `RuntimeContinuationCipher`.
This package depends only on Node's file and cryptography APIs; it does not import Prisma, runtime
dispatch, or an application composition root.

## Runtime & config

The server receives the absolute keyring path through `AGENT_RUNTIME_CONTINUATION_KEYRING_PATH`.
Helm mounts the `keyring.json` key from the configured Secret as a read-only file. Rotation changes
`activeKeyId` for new writes while retaining every key still named by a saved continuation.

## See also

- Parent index: [server infrastructure](../README.md)
- Wire contract: [contracts](../../../../contracts/README.md)
