import { $ } from "bun";
import packageJson from "../package.json";
import { mkdir } from "fs/promises";

const VERSION = packageJson.version;

console.log(`Building btca v${VERSION}`);

// Create dist directory if it doesn't exist
await mkdir("dist", { recursive: true });

// Step 1: Compile TypeScript to dist/
console.log("Compiling TypeScript...");
await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  target: "bun",
  define: {
    __VERSION__: JSON.stringify(VERSION),
  },
});

// Step 2: Build platform binaries
const targets = [
  "bun-darwin-arm64",
  "bun-darwin-x64",
  "bun-linux-x64",
  "bun-linux-arm64",
  "bun-windows-x64",
] as const;

const outputNames: Record<(typeof targets)[number], string> = {
  "bun-darwin-arm64": "btca-darwin-arm64",
  "bun-darwin-x64": "btca-darwin-x64",
  "bun-linux-x64": "btca-linux-x64",
  "bun-linux-arm64": "btca-linux-arm64",
  "bun-windows-x64": "btca-windows-x64.exe",
};

console.log("Building platform binaries...");

// Build all binary targets in parallel
const buildPromises = targets.map((target) => {
  const outfile = `dist/${outputNames[target]}`;
  return $`bun build src/index.ts --compile --target=${target} --outfile=${outfile} --define __VERSION__='"${VERSION}"'`;
});

try {
  await Promise.all(buildPromises);
  console.log("✅ TypeScript compilation completed");
  console.log("✅ All platform binaries built successfully");
  console.log(`✅ Done building btca v${VERSION}`);
} catch (error) {
  console.error("❌ Build failed:", error);
  process.exit(1);
}
