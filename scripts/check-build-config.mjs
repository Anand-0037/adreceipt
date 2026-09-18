#!/usr/bin/env node
/**
 * Fail CI if build-entry config files contain executable injection.
 * Runs before npm ci so a poisoned PostCSS/Vite config cannot execute first.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();

const configNames = new Set([
  "postcss.config.js",
  "postcss.config.cjs",
  "postcss.config.mjs",
  "postcss.config.ts",
  "vite.config.js",
  "vite.config.ts",
  "webpack.config.js",
  "babel.config.js",
  "babel.config.cjs",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
]);

const skipDir = new Set([
  "node_modules",
  ".git",
  "artifacts",
  "cache",
  "typechain-types",
  "coverage",
  "dist",
  ".next",
]);

/** Patterns that do not belong in a CSS/bundler config. */
const forbidden = [
  { name: "eval()", re: /\beval\s*\(/ },
  { name: "Function()", re: /\bFunction\s*\(/ },
  { name: "child_process", re: /child_process/ },
  { name: "spawn()", re: /\bspawn\s*\(/ },
  { name: "obfuscated hex ident", re: /\b_0x[0-9a-fA-F]{4,}\b/ },
  { name: "known payload marker", re: /A8-7844-2/ },
];

const maxPostcssBytes = 2048;

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (skipDir.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (configNames.has(name)) acc.push(full);
  }
  return acc;
}

const files = walk(root);
if (files.length === 0) {
  console.error("check-build-config: no config files found");
  process.exit(1);
}

let failed = false;
for (const file of files) {
  const rel = relative(root, file);
  const buf = readFileSync(file);
  const text = buf.toString("utf8");
  const isPostcss = /postcss\.config\./.test(rel);

  if (isPostcss && buf.length > maxPostcssBytes) {
    console.error(
      `${rel}: PostCSS config is ${buf.length} bytes (limit ${maxPostcssBytes}). Executable payloads are often appended after the real export.`,
    );
    failed = true;
  }

  for (const { name, re } of forbidden) {
    if (re.test(text)) {
      console.error(`${rel}: forbidden ${name}`);
      failed = true;
    }
  }
}

if (failed) {
  console.error(
    "check-build-config: reject this revision. Do not npm/vite it. Restore a known-good commit.",
  );
  process.exit(1);
}

console.log(
  `check-build-config: ok (${files.map((f) => relative(root, f)).join(", ")})`,
);
