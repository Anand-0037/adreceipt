const { chmodSync, copyFileSync, existsSync, mkdirSync } = require("node:fs");
const { resolve } = require("node:path");
const { execFileSync } = require("node:child_process");

const repositoryRoot = resolve(__dirname, "../..");
const runtimeBin = resolve(__dirname, "../runtime-bin");

for (const [executable, versionArgs] of [
  ["cre", ["version"]],
  ["bun", ["--version"]],
]) {
  const source = resolve(repositoryRoot, ".render/bin", executable);
  if (!existsSync(source)) continue;
  mkdirSync(runtimeBin, { recursive: true });
  const target = resolve(runtimeBin, executable);
  copyFileSync(source, target);
  chmodSync(target, 0o755);
  execFileSync(target, versionArgs, { stdio: "inherit" });
}
