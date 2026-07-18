/** Filesystem root used exclusively for the ArtifactStore CAS and staging paths. */
export interface FilesystemArtifactStoreOptions
{
  /** Absolute mounted volume root owned by the artifact-service process. */
  readonly rootPath: string;
}
