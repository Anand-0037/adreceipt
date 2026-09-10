const { chmodSync, copyFileSync, existsSync, mkdirSync } = require("node:fs");
const { resolve } = require("node:path");

const repositoryRoot = resolve(__dirname, "../..");
const runtimeBin = resolve(__dirname, "../runtime-bin");

for (const executable of ["cre", "bun"]) {
  const source = resolve(repositoryRoot, ".render/bin", executable);
  if (!existsSync(source)) continue;
  mkdirSync(runtimeBin, { recursive: true });
  const target = resolve(runtimeBin, executable);
  copyFileSync(source, target);
  chmodSync(target, 0o755);
}
