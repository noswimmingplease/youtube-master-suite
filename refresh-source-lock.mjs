import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const suiteDirectory = dirname(fileURLToPath(import.meta.url));
const lockPath = join(suiteDirectory, "sources.lock.json");

const REFRESH_USAGE =
  "Usage: node refresh-source-lock.mjs [--self-test]";

function parseRefreshArguments(arguments_) {
  if (
    arguments_.length > 1 ||
    (arguments_.length === 1 && arguments_[0] !== "--self-test")
  ) {
    throw new Error(REFRESH_USAGE);
  }
  return { selfTestMode: arguments_[0] === "--self-test" };
}

const { selfTestMode } = parseRefreshArguments(process.argv.slice(2));

function sha256(source) {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

function metadata(source, field) {
  const match = source.match(new RegExp(`^//\\s+@${field}\\s+(.+)$`, "m"));
  if (!match) throw new Error(`Missing @${field} metadata`);
  return match[1].trim();
}

function parseDottedVersion(version) {
  if (!/^\d+(?:\.\d+)+$/.test(version)) {
    throw new Error(`Invalid dotted numeric version: ${version}`);
  }
  const parts = version.split(".").map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) {
    throw new Error(`Version component exceeds the safe integer range: ${version}`);
  }
  return parts;
}

function compareDottedVersions(left, right) {
  const leftParts = parseDottedVersion(left);
  const rightParts = parseDottedVersion(right);
  const partCount = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < partCount; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

function assertVersionIncreaseForChangedSource(
  moduleId,
  lockedSource,
  nextVersion,
  nextHash,
) {
  parseDottedVersion(lockedSource.version);
  parseDottedVersion(nextVersion);
  if (
    nextHash !== lockedSource.sha256 &&
    compareDottedVersions(nextVersion, lockedSource.version) <= 0
  ) {
    throw new Error(
      `${moduleId}: canonical source changed without a version increase ` +
        `(locked ${lockedSource.version}, source ${nextVersion})`,
    );
  }
}

function runSelfTests() {
  if (!parseRefreshArguments(["--self-test"]).selfTestMode) {
    throw new Error("Source-lock argument parsing self-test failed");
  }
  for (const invalidArguments of [
    ["--self-tset"],
    ["--self-test", "--self-test"],
  ]) {
    let rejected = false;
    try {
      parseRefreshArguments(invalidArguments);
    } catch (error) {
      rejected = String(error?.message || error) === REFRESH_USAGE;
    }
    if (!rejected) {
      throw new Error(
        `Source-lock argument rejection self-test failed: ${invalidArguments.join(" ")}`,
      );
    }
  }

  if (compareDottedVersions("1.10", "1.9") <= 0) {
    throw new Error("Dotted version ordering self-test failed");
  }
  const lockedSource = {
    version: "2.4",
    sha256: "a".repeat(64),
  };
  assertVersionIncreaseForChangedSource(
    "fixture",
    lockedSource,
    "2.5",
    "b".repeat(64),
  );

  let rejectedUnversionedChange = false;
  try {
    assertVersionIncreaseForChangedSource(
      "fixture",
      lockedSource,
      "2.4",
      "b".repeat(64),
    );
  } catch (error) {
    rejectedUnversionedChange = /without a version increase/.test(
      String(error?.message || error),
    );
  }
  if (!rejectedUnversionedChange) {
    throw new Error("Changed-source version guard self-test failed");
  }

  console.log("Verified source-lock version safeguards");
}

if (selfTestMode) {
  runSelfTests();
  process.exit(0);
}

const sourceLock = JSON.parse(readFileSync(lockPath, "utf8"));

if (sourceLock.schemaVersion !== 2) {
  throw new Error(`Unsupported source-lock schema ${sourceLock.schemaVersion}`);
}

const modules = Object.entries(sourceLock.modules || {});
if (!modules.length) {
  throw new Error("The source lock does not contain any canonical modules");
}

const sourcePaths = new Set();
for (const [moduleId, lockedSource] of modules) {
  if (!/^sources\/modules\/[a-z0-9-]+\.user\.js$/.test(lockedSource.path)) {
    throw new Error(`${moduleId}: invalid canonical source path`);
  }
  if (sourcePaths.has(lockedSource.path)) {
    throw new Error(`${moduleId}: duplicate canonical source path`);
  }
  sourcePaths.add(lockedSource.path);
}

const canonicalSourcePaths = readdirSync(
  join(suiteDirectory, "sources", "modules"),
  { withFileTypes: true },
)
  .filter((entry) => entry.isFile() && entry.name.endsWith(".user.js"))
  .map((entry) => `sources/modules/${entry.name}`)
  .sort();
const lockedSourcePaths = [...sourcePaths].sort();
if (
  canonicalSourcePaths.length !== lockedSourcePaths.length ||
  canonicalSourcePaths.some(
    (sourcePath, index) => sourcePath !== lockedSourcePaths[index],
  )
) {
  throw new Error(
    "Source lock and canonical module directory differ: " +
      `locked [${lockedSourcePaths.join(", ")}], ` +
      `found [${canonicalSourcePaths.join(", ")}]`,
  );
}

const refreshedSources = modules.map(([moduleId, lockedSource]) => {
  const source = readFileSync(join(suiteDirectory, lockedSource.path), "utf8")
    .replace(/\r\n/g, "\n");
  const nextVersion = metadata(source, "version");
  const nextHash = sha256(source);
  assertVersionIncreaseForChangedSource(
    moduleId,
    lockedSource,
    nextVersion,
    nextHash,
  );
  return { lockedSource, nextVersion, nextHash };
});

for (const { lockedSource, nextVersion, nextHash } of refreshedSources) {
  lockedSource.version = nextVersion;
  lockedSource.sha256 = nextHash;
}

writeFileSync(lockPath, `${JSON.stringify(sourceLock, null, 2)}\n`, "utf8");
console.log(`Updated ${lockPath}`);
