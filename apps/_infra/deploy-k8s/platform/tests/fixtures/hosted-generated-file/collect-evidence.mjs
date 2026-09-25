import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Retain only the public proof files; the fixture directory also holds temporary credentials. */
export async function collectHostedEvidence(runDirectory, outputDirectory)
{
  const destination = join(resolve(outputDirectory), basename(resolve(runDirectory)));
  await mkdir(destination, { recursive: true });
  for (const name of ["hosted-generated-file.json", "protocol.json"])
  {
    const source = join(runDirectory, "evidence", name);
    if (await _isRegularFile(source))
      await copyFile(source, join(destination, name), constants.COPYFILE_EXCL);
  }
  const archivePath = join(runDirectory, "oci-archive-evidence.json");
  if (await _isRegularFile(archivePath))
  {
    const { archiveDigest, archiveByteLength, imageDigest } = JSON.parse(await readFile(archivePath, "utf8"));
    if (!/^sha256:[a-f0-9]{64}$/u.test(archiveDigest) || !/^sha256:[a-f0-9]{64}$/u.test(imageDigest)
        || !Number.isSafeInteger(archiveByteLength) || archiveByteLength < 1)
      throw new Error("Hosted archive evidence has invalid byte coordinates");
    await writeFile(join(destination, "oci-image.json"), `${JSON.stringify({ archiveDigest, archiveByteLength, imageDigest }, null, 2)}\n`, { flag: "wx" });
  }
}

/** Missing evidence is expected after an early failure; links must never pull another file into CI. */
async function _isRegularFile(path)
{
  try
  {
    const status = await lstat(path);
    if (!status.isFile())
      throw new Error("Hosted evidence must be a regular file");
    return true;
  }
  catch (error)
  {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
{
  if (process.argv.length !== 4) throw new Error("Hosted evidence collection requires run and output directories");
  await collectHostedEvidence(process.argv[2], process.argv[3]);
}
