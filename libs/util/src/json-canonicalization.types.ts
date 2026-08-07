/** JSON primitive accepted by RFC 8785 canonicalization. */
export type JsonPrimitive = string | number | boolean | null;

/** JSON value accepted by RFC 8785 canonicalization. */
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** Lowercase hexadecimal SHA-256 digest of UTF-8 RFC 8785 canonical JSON. */
export type CanonicalJsonSha256Digest = `sha256:${string}`;
