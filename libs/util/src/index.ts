/**
 * `@opencrane/util` — the shared primitives every OpenCrane package may depend on.
 *
 * Deliberately tiny and dependency-light: RFC 8785 canonical JSON and the digest built on it,
 * a parse-then-validate boundary helper, and a couple of lodash replacements. It must stay
 * importable from both a Node service and a browser bundle, so nothing here may use a
 * Node-only API.
 * @see https://www.rfc-editor.org/rfc/rfc8785
 */
export * from "./collections.js";
export * from "./canonical-json-digest.js";
export * from "./digest.js";
export * from "./json.js";
export * from "./json-canonicalization.js";
export * from "./json-canonicalization.types.js";
