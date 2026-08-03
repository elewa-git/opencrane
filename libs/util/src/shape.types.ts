/** Validates one untrusted field value at `path`, returning the typed value or throwing a diagnostic error. */
export type ___ShapeFieldParser<T> = (value: unknown, path: string) => T;

/** Declarative object shape: one field parser per expected property. */
export type ___Shape = Readonly<Record<string, ___ShapeFieldParser<unknown>>>;

/** Object type produced by parsing shape `S`: each field carries its parser's return type. */
export type ___ParsedShape<S extends ___Shape> = { readonly [K in keyof S]: ReturnType<S[K]> };
