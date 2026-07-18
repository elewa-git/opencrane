/** Minimal access-token persistence surface used by shared authentication middleware. */
export interface AccessTokenReader
{
  /** Database adapter for token lookup and last-used updates. */
  accessToken: {
    /** Find a matching active token. */
    findFirst(args: unknown): Promise<{ id: string } | null>;
    /** Persist token usage metadata. */
    update(args: unknown): Promise<unknown>;
  };
}
