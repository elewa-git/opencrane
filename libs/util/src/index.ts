/**
 * `@opencrane/util` — the shared primitives every OpenCrane package may depend on.
 *
 * Deliberately tiny and dependency-light: RFC 8785 canonical JSON and the digest built on it,
 * a parse-then-validate boundary helper, and a couple of lodash replacements. It must stay
 * importable from both a Node service and a browser bundle, so nothing here may use a
 * Node-only API.
 * @see https://www.rfc-editor.org/rfc/rfc8785
 */
export * from "./collections";
export * from "./canonical-json-digest";
export * from "./digest";
export * from "./json";
export * from "./json-canonicalization";
export * from "./json-canonicalization.types";
