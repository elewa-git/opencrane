# @opencrane/util — environment-neutral pure helpers

> [OpenCrane](../../README.md) › util

## What it owns

The smallest shared library in the platform: a handful of **pure, environment-neutral helpers** used
across domain packages. "Pure" means every function returns a value computed only from its
arguments — no database, no network, no clock, no global state — so the results are identical every
time and safe to call anywhere.

It owns five things:

- **Collection helpers** — `___SortBy` (stable sort by an optional key), `___SomeArray` and
  `___SomeRecord` (typed "does any element/value match?" checks). Small, but shared so the same
  behaviour is used everywhere rather than re-implemented.
- **JSON trust-boundary parsing** — `___ParseAndValidateJson` parses raw JSON as `unknown`, then
  immediately delegates to a caller-owned validator that produces the generic result type. Optional
  validator arguments carry contextual constraints without one-off parsing wrappers. Configuration
  readers and HTTP adapters use this same parser after enforcing any transport-specific byte limit;
  tolerant JSONL/rendering heuristics remain local because malformed fragments are part of their
  best-effort protocol rather than an exceptional domain boundary.
- **Canonical JSON and digest grammar** — `___CanonicalizeJson` serialises a JSON value to the one
  canonical string
  form defined by RFC 8785 (JSON Canonicalization Scheme): object keys sorted, whitespace and number
  formatting fixed. Two values that are equal produce byte-identical text, which is what makes a
  stable hash possible. `___DigestCanonicalJson` hashes those bytes with SHA-256 using the same
  synchronous implementation in Node and browser bundles, so callers get one `sha256:<hex>` result
  without importing a runtime-specific crypto module. `___CloneCanonicalJson` round-trips through that form to produce a detached,
  JSON-equivalent value; callers must canonicalise again when deterministic bytes or key order matter.
  The type `CanonicalJsonSha256Digest` is the template-literal string type
  `` `sha256:${string}` `` — an explicitly encoded digest, so a hash of canonical bytes is never
  confused with an arbitrary string.
- **Digest grammar** — `___IsSha256Digest` accepts only `sha256:` plus 64 lowercase hexadecimal
  characters, keeping digests exchanged between authorities in one fail-closed spelling.
- **Declarative shape validation** — `___ParseShape` validates an untrusted candidate against a
  declared field-parser map, returns only the declared fields, and names the exact `source.field`
  path in every failure diagnostic. `___RequireField` builds a field parser from any type predicate,
  and `___ShapeFields` ships the identifier, positive-integer, and UTC-millisecond-instant parsers
  (backed by `___IsBoundedIdentifier`, `___IsPositiveInteger`, and `___IsMillisecondInstant`) that
  internal HTTP adapters share instead of re-declaring per-package predicates and one opaque
  malformed-response error.

Widely used where a **deterministic** result matters — most importantly the authorization model,
which digests capability catalogues and request arguments so a signature can bind to exact bytes.
Cross-cutting exports carry the `___` (triple-underscore) prefix to mark them as intentional
platform-wide API. Invariant: purity and determinism — no hidden inputs, same output every time.

## Public surface

- `___SortBy`, `___SomeArray`, `___SomeRecord` — collection helpers.
- `___ParseAndValidateJson` — parse untrusted JSON and return only the caller-validated generic type.
- `___CanonicalizeJson` — RFC 8785 canonical JSON serialisation.
- `___DigestCanonicalJson` — browser- and Node-safe SHA-256 digest of canonical JSON.
- `___CloneCanonicalJson` — detached deep copy through the canonical JSON representation.
- `___IsSha256Digest` — strict validator for the platform's lowercase SHA-256 digest grammar.
- `___ParseShape`, `___RequireField`, `___ShapeFields` — declarative untrusted-object validation.
- `___IsBoundedIdentifier`, `___IsPositiveInteger`, `___IsMillisecondInstant` — boundary predicates.
- `___Shape`, `___ShapeFieldParser`, `___ParsedShape` — shape validation types.
- `JsonValue`, `JsonPrimitive`, `CanonicalJsonSha256Digest` — JSON and digest types.

## Boundary

Pure and environment-neutral: it imports no OpenCrane package and does no I/O. It owns the one
shared implementation of canonical JSON hashing, but does not decide what a digest means or persist
it; those authority decisions remain with the owning domain.

## Dependency direction

Tagged `scope:shared`: it may never import from a domain package or an app — the leaf everything else
is allowed to depend on.

## See also

- Parent index: [OpenCrane](../../README.md)
- Siblings: [observability](../observability/README.md) · [contracts](../contracts/README.md)
