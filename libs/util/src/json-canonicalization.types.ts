/** JSON primitive accepted by RFC 8785 canonicalization. */
export type JsonPrimitive = string | number | boolean | null;

/**
 * A value that can be canonicalized under RFC 8785: a primitive, an array, or a plain object.
 *
 * `readonly` throughout, because {@link ___CanonicalizeJson} rejects anything a JSON parser could
 * not have produced — a class instance, a getter, or a symbol key will not satisfy it at runtime
 * even where TypeScript allows the assignment.
 * @see https://www.rfc-editor.org/rfc/rfc8785
 */
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** A `sha256:` prefixed lowercase hex digest of RFC 8785 canonical JSON. Produce it with {@link ___DigestCanonicalJson}; check an untrusted string with `___IsSha256Digest`. @see https://www.rfc-editor.org/rfc/rfc8785 */
export type CanonicalJsonSha256Digest = `sha256:${string}`;
