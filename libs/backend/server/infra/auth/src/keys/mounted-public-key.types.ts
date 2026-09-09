/**
 * Reloadable source for one public key projected into the server process.
 *
 * The source owns only mounted-file access. Signature meaning and domain trust remain with the
 * backend authority that consumes the key.
 */
export interface MountedPublicKeySource
{
  /** Reads the current projected public-key contents. */
  read(): string;
}
