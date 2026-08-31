import { inflateRawSync } from "node:zlib";

/** ZIP end-of-directory marker. */
const _END = 0x06054b50;
/** ZIP central-directory entry marker. */
const _CENTRAL = 0x02014b50;
/** ZIP local-file marker. */
const _LOCAL = 0x04034b50;
/** ZIP stored-file compression method. */
const _STORED = 0;
/** ZIP raw-DEFLATE compression method. */
const _DEFLATE = 8;
/** Largest comment permitted by the ZIP format. */
const _MAX_COMMENT_BYTES = 65_535;
/** Largest number of files accepted from one untrusted package. */
const _MAX_ENTRY_COUNT = 4_096;
/** Largest sum of declared expanded file sizes accepted from one package. */
const _MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
/** ZIP flag that marks encrypted entry data. */
const _ENCRYPTED_FLAG = 0x0001;
/** ZIP flag that moves sizes into a trailing data descriptor. */
const _DATA_DESCRIPTOR_FLAG = 0x0008;
/** UNIX file-type mask stored in central-directory external attributes. */
const _UNIX_FILE_TYPE_MASK = 0o170000;
/** UNIX regular-file marker stored in central-directory external attributes. */
const _UNIX_REGULAR_FILE = 0o100000;
/** UNIX host identifier stored in the high byte of version-made-by. */
const _UNIX_HOST = 3;
/** DOS directory attribute stored in the low byte of external attributes. */
const _DOS_DIRECTORY_ATTRIBUTE = 0x10;

/** One bounded regular file described by the accepted ZIP central directory. */
interface _ZipPackageEntry
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
interface _ZipPackage
{
	/** Immutable entry catalogue; duplicate and unsafe names are rejected during parsing. */
	readonly entries: readonly _ZipPackageEntry[];
	/** Read one declared entry without extracting any other archive content. */
	read(entry: _ZipPackageEntry, maximumBytes: number): Buffer | null;
}

/** Safe coordinates of the one central directory in a non-split ZIP package. */
interface _CentralDirectory
{
	/** Number of regular-file entries described by the directory. */
	readonly entryCount: number;
	/** First byte of the central directory. */
	readonly offset: number;
	/** Declared central-directory byte length. */
	readonly size: number;
}

/** One central-directory record together with the next record offset and local-byte range. */
interface _CentralDirectoryEntry
{
	/** Safe file metadata that callers may later read. */
	readonly entry: _ZipPackageEntry;
	/** First byte after this central-directory record. */
	readonly nextOffset: number;
	/** Inclusive-to-exclusive byte range occupied by the matching local file record. */
	readonly localRange: readonly [number, number];
}

/**
 * Parse a bounded ZIP package without extracting it to disk.
 *
 * Called by: OCI image-layout admission before it reads a named layout object.
 * @returns The safe central-directory catalogue, or `null` for an unsafe or malformed archive.
 */
export function ___ParseZipPackage(bytes: Buffer): _ZipPackage | null
{
	const directory = _ReadCentralDirectory(bytes);
	if (directory === null)
		return null;
	const entries = _ReadCentralDirectoryEntries(bytes, directory);
	if (entries === null)
		return null;
	const catalogue = Object.freeze(entries);
	return {
		entries: catalogue,
		read(entry, maximumBytes)
		{
			return catalogue.includes(entry) ? _ReadEntry(bytes, entry, maximumBytes, directory.offset) : null;
		},
	};
}

/** Read and validate the single, bounded central directory declared by the ZIP end record. */
function _ReadCentralDirectory(bytes: Buffer): _CentralDirectory | null
{
	const end = _FindEnd(bytes);
	if (end < 0 || end + 22 > bytes.byteLength)
		return null;
	const disk = bytes.readUInt16LE(end + 4);
	const directoryDisk = bytes.readUInt16LE(end + 6);
	const diskCount = bytes.readUInt16LE(end + 8);
	const entryCount = bytes.readUInt16LE(end + 10);
	const size = bytes.readUInt32LE(end + 12);
	const offset = bytes.readUInt32LE(end + 16);
	if (disk !== 0 || directoryDisk !== 0 || diskCount !== entryCount || entryCount > _MAX_ENTRY_COUNT || entryCount === 0xffff || size === 0xffffffff || offset === 0xffffffff || offset > end || size !== end - offset)
		return null;
	return { entryCount, offset, size };
}

/** Read every central-directory record while keeping duplicate names and overlapping local bytes out. */
function _ReadCentralDirectoryEntries(bytes: Buffer, directory: _CentralDirectory): _ZipPackageEntry[] | null
{
	const entries: _ZipPackageEntry[] = [];
	const names = new Set<string>();
	const localRanges: Array<readonly [number, number]> = [];
	let expandedBytes = 0;
	let cursor = directory.offset;
	for (let index = 0; index < directory.entryCount; index += 1)
	{
		const parsed = _ReadCentralDirectoryEntry(bytes, cursor, directory.offset);
		if (parsed === null || names.has(parsed.entry.path))
			return null;
		expandedBytes += parsed.entry.uncompressedSize;
		if (!Number.isSafeInteger(expandedBytes) || expandedBytes > _MAX_EXPANDED_BYTES)
			return null;
		if (localRanges.some(function _Overlaps(range): boolean { return parsed.localRange[0] < range[1] && parsed.localRange[1] > range[0]; }))
			return null;
		names.add(parsed.entry.path);
		entries.push(parsed.entry);
		localRanges.push(parsed.localRange);
		cursor = parsed.nextOffset;
	}
	if (cursor !== directory.offset + directory.size)
		return null;
	return entries;
}

/** Read one central-directory record and prove that its local record has the same safe identity. */
function _ReadCentralDirectoryEntry(bytes: Buffer, cursor: number, directoryOffset: number): _CentralDirectoryEntry | null
{
	if (cursor > bytes.byteLength - 46 || bytes.readUInt32LE(cursor) !== _CENTRAL)
		return null;
	const versionMadeBy = bytes.readUInt16LE(cursor + 4);
	const flags = bytes.readUInt16LE(cursor + 8);
	const compressionMethod = bytes.readUInt16LE(cursor + 10);
	const compressedSize = bytes.readUInt32LE(cursor + 20);
	const uncompressedSize = bytes.readUInt32LE(cursor + 24);
	const nameLength = bytes.readUInt16LE(cursor + 28);
	const extraLength = bytes.readUInt16LE(cursor + 30);
	const commentLength = bytes.readUInt16LE(cursor + 32);
	const externalAttributes = bytes.readUInt32LE(cursor + 38);
	const localHeaderOffset = bytes.readUInt32LE(cursor + 42);
	const nextOffset = cursor + 46 + nameLength + extraLength + commentLength;
	if ((flags & _ENCRYPTED_FLAG) !== 0 || !_IsSupportedCompression(compressionMethod) || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff || nextOffset > bytes.byteLength || !_IsRegularFile(versionMadeBy, externalAttributes))
		return null;
	const path = _DecodePath(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
	if (!_IsSafePath(path))
		return null;
	const entry = Object.freeze({ path, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });
	const localEnd = _ValidateLocalEntry(bytes, entry, flags, directoryOffset);
	if (localEnd < 0)
		return null;
	return { entry, nextOffset, localRange: [localHeaderOffset, localEnd] };
}

/** Find the final valid central-directory marker. */
function _FindEnd(bytes: Buffer): number
{
	for (let offset = bytes.byteLength - 22; offset >= Math.max(0, bytes.byteLength - 22 - _MAX_COMMENT_BYTES); offset -= 1)
	{
		if (bytes.readUInt32LE(offset) === _END && bytes.readUInt16LE(offset + 20) === bytes.byteLength - offset - 22)
			return offset;
	}
	return -1;
}

/** Decode a UTF-8 path only when every input byte has a canonical round trip. */
function _DecodePath(bytes: Buffer): string
{
	const path = bytes.toString("utf8");
	return Buffer.from(path, "utf8").equals(bytes) ? path : "";
}

/** Reject paths that can escape a package root or name directories. */
function _IsSafePath(path: string): boolean
{
	return path.length > 0
		&& !path.endsWith("/")
		&& !path.startsWith("/")
		&& !path.includes("\\")
		&& !/[\u0000-\u001f\u007f]/u.test(path)
		&& !path.split("/").some(function _IsTraversal(segment): boolean
		{
			return segment === "" || segment === "." || segment === "..";
		});
}

/** Accept the two compression methods whose readers have explicit output limits. */
function _IsSupportedCompression(method: number): boolean
{
	return method === _STORED || method === _DEFLATE;
}

/** Accept central-directory entries only when their host attributes describe regular files. */
function _IsRegularFile(versionMadeBy: number, externalAttributes: number): boolean
{
	if ((externalAttributes & _DOS_DIRECTORY_ATTRIBUTE) !== 0)
		return false;
	if ((versionMadeBy >> 8) !== _UNIX_HOST)
		return true;
	const fileType = (externalAttributes >>> 16) & _UNIX_FILE_TYPE_MASK;
	return fileType === 0 || fileType === _UNIX_REGULAR_FILE;
}

/** Validate the matching local header and return the exclusive end of its compressed data. */
function _ValidateLocalEntry(bytes: Buffer, entry: _ZipPackageEntry, centralFlags: number, directoryOffset: number): number
{
	if (entry.localHeaderOffset > directoryOffset - 30 || bytes.readUInt32LE(entry.localHeaderOffset) !== _LOCAL)
		return -1;
	const flags = bytes.readUInt16LE(entry.localHeaderOffset + 6);
	const compressionMethod = bytes.readUInt16LE(entry.localHeaderOffset + 8);
	const compressedSize = bytes.readUInt32LE(entry.localHeaderOffset + 18);
	const uncompressedSize = bytes.readUInt32LE(entry.localHeaderOffset + 22);
	const nameLength = bytes.readUInt16LE(entry.localHeaderOffset + 26);
	const extraLength = bytes.readUInt16LE(entry.localHeaderOffset + 28);
	const nameOffset = entry.localHeaderOffset + 30;
	const dataOffset = nameOffset + nameLength + extraLength;
	if (flags !== centralFlags || (flags & _ENCRYPTED_FLAG) !== 0 || compressionMethod !== entry.compressionMethod || dataOffset > directoryOffset)
		return -1;
	const path = _DecodePath(bytes.subarray(nameOffset, nameOffset + nameLength));
	if (path !== entry.path || entry.compressedSize > directoryOffset - dataOffset)
		return -1;
	if ((flags & _DATA_DESCRIPTOR_FLAG) === 0 && (compressedSize !== entry.compressedSize || uncompressedSize !== entry.uncompressedSize))
		return -1;
	return dataOffset + entry.compressedSize;
}

/** Read exactly one entry under the caller's decompression ceiling. */
function _ReadEntry(bytes: Buffer, entry: _ZipPackageEntry, maximumBytes: number, directoryOffset: number): Buffer | null
{
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0 || entry.uncompressedSize > maximumBytes || entry.localHeaderOffset > directoryOffset - 30 || bytes.readUInt32LE(entry.localHeaderOffset) !== _LOCAL)
		return null;
	const flags = bytes.readUInt16LE(entry.localHeaderOffset + 6);
	const compressionMethod = bytes.readUInt16LE(entry.localHeaderOffset + 8);
	const nameLength = bytes.readUInt16LE(entry.localHeaderOffset + 26);
	const extraLength = bytes.readUInt16LE(entry.localHeaderOffset + 28);
	const path = bytes.toString("utf8", entry.localHeaderOffset + 30, entry.localHeaderOffset + 30 + nameLength);
	if ((flags & _ENCRYPTED_FLAG) !== 0 || compressionMethod !== entry.compressionMethod || path !== entry.path)
		return null;
	const offset = entry.localHeaderOffset + 30 + nameLength + extraLength;
	if (offset > directoryOffset || entry.compressedSize > directoryOffset - offset)
		return null;
	try
	{
		const compressed = bytes.subarray(offset, offset + entry.compressedSize);
		const output = entry.compressionMethod === _STORED
			? Buffer.from(compressed)
			: entry.compressionMethod === _DEFLATE
				? inflateRawSync(compressed, { maxOutputLength: maximumBytes })
				: null;
		return output?.byteLength === entry.uncompressedSize ? output : null;
	}
	catch
	{
		return null;
	}
}
