import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const packageName = packageJson.name || "@topogram/extractor-bpmn-workflows";
const track = "workflows";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveTopogramInvocation() {
  const override = process.env.TOPOGRAM_CLI || process.env.TOPOGRAM_BIN;
  if (override) {
    return override.endsWith(".js")
      ? { command: process.execPath, baseArgs: [override] }
      : { command: override, baseArgs: [] };
  }
  const localCli = path.join(root, "node_modules", "@topogram", "cli", "src", "cli.js");
  if (fs.existsSync(localCli)) {
    return { command: process.execPath, baseArgs: [localCli] };
  }
  throw new Error("Topogram CLI not found. Run npm install, or set TOPOGRAM_CLI=/path/to/topogram/engine/src/cli.js.");
}

const topogram = resolveTopogramInvocation();

function run(args, options = {}) {
  const result = childProcess.spawnSync(topogram.command, [...topogram.baseArgs, ...args], {
    cwd: options.cwd || root,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
    maxBuffer: 1024 * 1024 * 10
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    throw new Error(`Command failed: ${[topogram.command, ...topogram.baseArgs, ...args].join(" ")}`);
  }
  return result.stdout;
}

function snapshotFixture() {
  const fixtureRoot = path.join(root, "fixtures", "basic-source");
  const files = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push([path.relative(fixtureRoot, absolute), fs.readFileSync(absolute, "utf8")]);
    }
  }
  visit(fixtureRoot);
  return JSON.stringify(files.sort());
}

run(["extractor", "check", "."]);

const before = snapshotFixture();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "topogram-extractor-smoke."));
const policyPath = path.join(tmp, "topogram.extractor-policy.json");
fs.writeFileSync(policyPath, JSON.stringify({
  version: "0.1",
  allowedPackageScopes: [],
  allowedPackages: [packageName],
  pinnedVersions: { [packageName]: "1" },
  enabledPackages: []
}, null, 2) + "\n", "utf8");

const extracted = path.join(tmp, "extracted");
run([
  "extract",
  path.join(root, "fixtures", "basic-source"),
  "--out",
  extracted,
  "--from",
  track,
  "--extractor",
  ".",
  "--extractor-policy",
  policyPath,
  "--json"
]);
run(["extract", "plan", extracted, "--json"]);
run(["query", "extract-plan", path.join(extracted, "topo"), "--json"]);
run(["adopt", "--list", extracted, "--json"]);

const after = snapshotFixture();
if (after !== before) {
  throw new Error("Extractor smoke mutated fixture source files.");
}

console.log(`Extractor package smoke passed for ${packageName}.`);
