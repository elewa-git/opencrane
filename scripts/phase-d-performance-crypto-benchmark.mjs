import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import { performance } from "node:perf_hooks";

const WARMUP_ITERATIONS = 200;
const SAMPLE_COUNT = 21;

/** Returns the lower median of one sorted numeric sample. */
function _Median(values)
{
	const sorted = [...values].sort((first, second) => first - second);
	return sorted[Math.floor(sorted.length / 2)];
}

/** Returns the nearest-rank percentile used by the D11 baseline report. */
function _NearestRank(values, percentile)
{
	const sorted = [...values].sort((first, second) => first - second);
	return sorted[Math.ceil(percentile * sorted.length) - 1];
}

/** Measures synchronous work as microseconds per operation after a fixed warm-up. */
function _Measure(name, iterationsPerSample, operation)
{
	for (let iteration = 0; iteration < WARMUP_ITERATIONS; iteration += 1) operation();
	const samplesMicroseconds = [];
	for (let sample = 0; sample < SAMPLE_COUNT; sample += 1)
	{
		const startedAt = performance.now();
		for (let iteration = 0; iteration < iterationsPerSample; iteration += 1) operation();
		samplesMicroseconds.push((performance.now() - startedAt) * 1_000 / iterationsPerSample);
	}
	return {
		name,
		iterationsPerSample,
		samplesMicroseconds,
		medianMicroseconds: _Median(samplesMicroseconds),
		p95Microseconds: _NearestRank(samplesMicroseconds, 0.95),
	};
}

// Generate each key once outside the timed portions. The fixed message and precomputed
// signatures make verify measurements distinguish signature work from key generation/signing.
const message = Buffer.from("opencrane phase d hot path benchmark message ".repeat(20), "utf8");
const es256 = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const es256Signature = sign("sha256", message, { key: es256.privateKey, dsaEncoding: "ieee-p1363" });
const ed25519 = generateKeyPairSync("ed25519");
const ed25519Signature = sign(null, message, ed25519.privateKey);
const smallHashInput = Buffer.alloc(4 * 1_024, 0x61);
const largeHashInput = Buffer.alloc(1_024 * 1_024, 0x61);

const result = {
	benchmark: "phase-d-performance-crypto",
	measuredAt: new Date().toISOString(),
	node: process.version,
	platform: process.platform,
	architecture: process.arch,
	method: {
		warmupIterations: WARMUP_ITERATIONS,
		sampleCount: SAMPLE_COUNT,
		percentile: "nearest-rank: ceil(percentile * sampleCount) - 1 after ascending sort",
		unit: "microseconds per operation",
		messageBytes: message.byteLength,
	},
	measurements: [
		_Measure("ES256 verify", 1_000, function _verifyEs256()
		{
			if (!verify("sha256", message, { key: es256.publicKey, dsaEncoding: "ieee-p1363" }, es256Signature)) throw new Error("ES256 verification failed");
		}),
		_Measure("Ed25519 verify", 1_000, function _verifyEd25519()
		{
			if (!verify(null, message, ed25519.publicKey, ed25519Signature)) throw new Error("Ed25519 verification failed");
		}),
		_Measure("Ed25519 sign", 1_000, function _signEd25519()
		{
			sign(null, message, ed25519.privateKey);
		}),
		_Measure("SHA-256 4KiB", 10_000, function _hashSmall()
		{
			createHash("sha256").update(smallHashInput).digest();
		}),
		_Measure("SHA-256 1MiB", 100, function _hashLarge()
		{
			createHash("sha256").update(largeHashInput).digest();
		}),
	],
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
