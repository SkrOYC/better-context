import { $ } from "bun";
import packageJson from "../package.json";
import { mkdir } from "fs/promises";

const VERSION = packageJson.version;

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

async function main() {
  await mkdir("dist", { recursive: true });

  const buildPromises = targets.map((target) => {
    const outfile = `dist/${outputNames[target]}`;
    console.log(`Building ${target} -> ${outfile} (v${VERSION})`);
    return $`bun build src/index.ts --compile --target=${target} --outfile=${outfile} --define __VERSION__='"${VERSION}"'`;
  });

  await Promise.all(buildPromises);

  console.log("Done building all targets");
}

main();