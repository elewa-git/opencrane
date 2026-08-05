/**
 * Minimal structural view of the application-owned Prisma client for the health probe. The
 * infrastructure library depends only on the one method it uses, not the generated package.
 */
export interface DbHealthProbe
{
  /** Tagged-template raw query used to execute `SELECT 1`. */
  $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
}
