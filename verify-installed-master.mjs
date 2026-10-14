import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const suiteDirectory = dirname(fileURLToPath(import.meta.url));

const INSTALLED_USAGE =
  "Usage: node verify-installed-master.mjs <installed-or-exported-source-path> | --self-test";

function parseInstalledArguments(arguments_) {
  if (arguments_.length !== 1) {
    throw new Error(INSTALLED_USAGE);
  }
  if (arguments_[0] === "--self-test") {
    return { installedPath: null, selfTestMode: true };
  }
  if (arguments_[0].startsWith("-")) {
    throw new Error(INSTALLED_USAGE);
  }
  return { installedPath: arguments_[0], selfTestMode: false };
}

const { installedPath, selfTestMode } = parseInstalledArguments(
  process.argv.slice(2),
);

function sha256(source) {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

function verifyInstalledSource(manifest, installedSource) {
  const installedHash = sha256(installedSource);
  const registrationCount =
    installedSource.match(/suite\.registerModule\s*\(/g)?.length || 0;

  assert.equal(manifest.schemaVersion, 1, "Unsupported release manifest");
  assert.equal(
    manifest.name,
    "YouTube Master Suite",
    "Unexpected manifest name",
  );
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/, "Invalid manifest version");
  assert.equal(
    manifest.source,
    "youtube-master-suite.user.js",
    "Unexpected manifest source",
  );
  assert.match(manifest.sha256, /^[0-9a-f]{64}$/, "Invalid manifest hash");
  assert(
    Number.isInteger(manifest.registeredModules) &&
      manifest.registeredModules > 0,
    "Manifest module count must be a positive integer",
  );
  assert.equal(
    Buffer.byteLength(installedSource, "utf8"),
    manifest.bytes,
    "Installed source byte length differs from the release manifest",
  );
  assert.equal(
    installedSource.length,
    manifest.characters,
    "Installed source character length differs from the release manifest",
  );
  assert.equal(
    installedHash,
    manifest.sha256,
    "Installed source hash differs from the release manifest",
  );
  assert.equal(
    registrationCount,
    manifest.registeredModules,
    "Installed source module registration count differs from the release manifest",
  );

  return installedHash;
}

function runSelfTests() {
  assert.deepEqual(parseInstalledArguments(["fixture.user.js"]), {
    installedPath: "fixture.user.js",
    selfTestMode: false,
  });
  assert.throws(
    () => parseInstalledArguments(["--self-tset"]),
    /Usage: node verify-installed-master\.mjs/,
  );
  assert.throws(
    () => parseInstalledArguments(["first.user.js", "second.user.js"]),
    /Usage: node verify-installed-master\.mjs/,
  );

  const validSource = 'suite.registerModule("fixture");\n';
  const fixtureManifest = {
    schemaVersion: 1,
    name: "YouTube Master Suite",
    version: "0.0.0",
    source: "youtube-master-suite.user.js",
    sha256: sha256(validSource),
    bytes: Buffer.byteLength(validSource, "utf8"),
    characters: validSource.length,
    registeredModules: 1,
  };
  verifyInstalledSource(fixtureManifest, validSource);
  assert.throws(
    () =>
      verifyInstalledSource(
        fixtureManifest,
        validSource.replace("fixture", "fikture"),
      ),
    /Installed source hash differs from the release manifest/,
    "Installed-source corruption must be rejected",
  );
  console.log("Verified installed-source corruption safeguards");
}

if (selfTestMode) {
  runSelfTests();
  process.exit(0);
}

const manifest = JSON.parse(
  readFileSync(resolve(suiteDirectory, "release-manifest.json"), "utf8"),
);
const installedSource = readFileSync(resolve(installedPath), "utf8");
verifyInstalledSource(manifest, installedSource);

console.log(
  `Verified installed YouTube Master Suite v${manifest.version} ` +
    `(${manifest.sha256})`,
);
