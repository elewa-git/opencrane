import { deflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { ___ParseZipPackage } from "../zip-package";

/** One source file used to construct a minimal regular ZIP archive. */
interface _ZipSource
{
	/** Archive-relative file-name bytes. */
	readonly path: string | Buffer;
	/** Uncompressed file contents. */
	readonly contents: string;
	/** Whether the entry uses raw DEFLATE. */
	readonly deflated?: boolean;
	/** Whether the entry is marked as encrypted. */
	readonly encrypted?: boolean;
	/** Optional compression method used to exercise unsupported entries. */
	readonly compressionMethod?: number;
	/** Optional declared expanded size used to exercise package-wide bounds. */
	readonly declaredUncompressedSize?: number;
	/** Optional UNIX mode stored in central-directory external attributes. */
	readonly unixMode?: number;
	/** Whether DOS attributes mark the entry as a directory. */
	readonly directory?: boolean;
}

/** Build a minimal central-directory ZIP archive for parser boundary coverage. */
function _BuildZip(sources: readonly _ZipSource[], comment = Buffer.alloc(0)): Buffer
{
	const localEntries: Buffer[] = [];
	const centralEntries: Buffer[] = [];
	let offset = 0;
	for (const source of sources)
	{
		const name = typeof source.path === "string" ? Buffer.from(source.path, "utf8") : source.path;
		const plain = Buffer.from(source.contents, "utf8");
		const method = source.compressionMethod ?? (source.deflated ? 8 : 0);
		const contents = source.deflated ? deflateRawSync(plain) : plain;
		const flags = source.encrypted ? 1 : 0;
		const declaredUncompressedSize = source.declaredUncompressedSize ?? plain.byteLength;
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(flags, 6);
		local.writeUInt16LE(method, 8);
		local.writeUInt32LE(contents.byteLength, 18);
		local.writeUInt32LE(declaredUncompressedSize, 22);
		local.writeUInt16LE(name.byteLength, 26);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(source.unixMode === undefined ? 20 : (3 << 8) | 20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(flags, 8);
		central.writeUInt16LE(method, 10);
		central.writeUInt32LE(contents.byteLength, 20);
		central.writeUInt32LE(declaredUncompressedSize, 24);
		central.writeUInt16LE(name.byteLength, 28);
		central.writeUInt32LE((((source.unixMode ?? 0) << 16) | (source.directory ? 0x10 : 0)) >>> 0, 38);
		central.writeUInt32LE(offset, 42);
		localEntries.push(local, name, contents);
		centralEntries.push(central, name);
		offset += local.byteLength + name.byteLength + contents.byteLength;
	}
	const directory = Buffer.concat(centralEntries);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(sources.length, 8);
	end.writeUInt16LE(sources.length, 10);
	end.writeUInt32LE(directory.byteLength, 12);
	end.writeUInt32LE(offset, 16);
	end.writeUInt16LE(comment.byteLength, 20);
	return Buffer.concat([...localEntries, directory, end, comment]);
}

/** Find the real end record in a test archive that may carry a comment. */
function _EndOffset(archive: Buffer): number
{
	return archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
}

describe("___ParseZipPackage", function _ZipPackageSuite()
{
	it("lists and reads regular stored and DEFLATE files", function _ReadsRegularFiles()
	{
		const archive = _BuildZip([{ path: "oci-layout", contents: "layout" }, { path: "index.json", contents: "index", deflated: true }]);
		const parsed = ___ParseZipPackage(archive);
		expect(parsed?.entries.map(function _Path(entry) { return entry.path; })).toEqual(["oci-layout", "index.json"]);
		expect(parsed?.read(parsed.entries[1], 10)?.toString("utf8")).toBe("index");
	});

	it("rejects archive paths that escape the image layout root", function _RejectsUnsafePath()
	{
		const archive = _BuildZip([{ path: "../index.json", contents: "index" }]);
		expect(___ParseZipPackage(archive)).toBeNull();
	});

	it("rejects encrypted entries and refuses reads over the explicit limit", function _RejectsUnsupportedOrUnboundedContent()
	{
		const encrypted = _BuildZip([{ path: "index.json", contents: "index", encrypted: true }]);
		const bounded = _BuildZip([{ path: "index.json", contents: "index", deflated: true }]);
		expect(___ParseZipPackage(encrypted)).toBeNull();
		const parsed = ___ParseZipPackage(bounded);
		expect(parsed?.read(parsed.entries[0], 4)).toBeNull();
	});

	it("rejects too many entries and excessive declared expanded bytes", function _RejectsPackageScaleAttacks()
	{
		const tooMany = _BuildZip([{ path: "index.json", contents: "index" }]);
		const end = _EndOffset(tooMany);
		tooMany.writeUInt16LE(4_097, end + 8);
		tooMany.writeUInt16LE(4_097, end + 10);
		const expanded = _BuildZip([{ path: "layer.tar", contents: "x", declaredUncompressedSize: (256 * 1024 * 1024) + 1 }]);
		expect(___ParseZipPackage(tooMany)).toBeNull();
		expect(___ParseZipPackage(expanded)).toBeNull();
	});

	it("accepts a real end record and rejects split or trailing directory records", function _ValidatesEndRecord()
	{
		const commented = _BuildZip([{ path: "index.json", contents: "index" }], Buffer.from([0x50, 0x4b, 0x05, 0x06, 0x61, 0x62, 0x63]));
		expect(___ParseZipPackage(commented)?.entries).toHaveLength(1);
		const split = _BuildZip([{ path: "index.json", contents: "index" }]);
		split.writeUInt16LE(1, _EndOffset(split) + 4);
		expect(___ParseZipPackage(split)).toBeNull();
		const trailing = Buffer.concat([_BuildZip([{ path: "index.json", contents: "index" }]), Buffer.from("junk", "utf8")]);
		expect(___ParseZipPackage(trailing)).toBeNull();
	});

	it("rejects invalid UTF-8 paths, control characters, directories and UNIX links", function _RejectsNonRegularEntries()
	{
		expect(___ParseZipPackage(_BuildZip([{ path: Buffer.from([0xc3, 0x28]), contents: "x" }]))).toBeNull();
		expect(___ParseZipPackage(_BuildZip([{ path: "bad\0name", contents: "x" }]))).toBeNull();
		expect(___ParseZipPackage(_BuildZip([{ path: "folder", contents: "x", directory: true }]))).toBeNull();
		expect(___ParseZipPackage(_BuildZip([{ path: "link", contents: "target", unixMode: 0o120777 }]))).toBeNull();
		expect(___ParseZipPackage(_BuildZip([{ path: "file", contents: "safe", unixMode: 0o100644 }]))?.entries).toHaveLength(1);
	});

	it("rejects unsupported compression and entry data that overlaps the directory", function _RejectsUnsafeEntryStorage()
	{
		expect(___ParseZipPackage(_BuildZip([{ path: "index.json", contents: "index", compressionMethod: 99 }]))).toBeNull();
		const overlapping = _BuildZip([{ path: "index.json", contents: "index" }]);
		const end = _EndOffset(overlapping);
		const directoryOffset = overlapping.readUInt32LE(end + 16);
		overlapping.writeUInt32LE(directoryOffset, 18);
		overlapping.writeUInt32LE(directoryOffset, directoryOffset + 20);
		expect(___ParseZipPackage(overlapping)).toBeNull();
	});
});
