/** One bounded regular file described by a ZIP central directory. */
export interface ZipPackageEntry
{
	/** Normalized relative path inside the archive. */
	readonly path: string;
	/** ZIP compression method. */
	readonly compressionMethod: number;
	/** Compressed byte count. */
	readonly compressedSize: number;
	/** Decompressed byte count. */
	readonly uncompressedSize: number;
	/** Offset of the corresponding local header. */
	readonly localHeaderOffset: number;
}

/** A validated ZIP package whose entries can be read under explicit byte limits. */
export interface ZipPackage
{
	/** Immutable entry catalogue; duplicate and unsafe names are rejected during parsing. */
	readonly entries: readonly ZipPackageEntry[];
	/** Read one declared entry without extracting any other archive content. */
	read(entry: ZipPackageEntry, maximumBytes: number): Buffer | null;
}
