import packageJson from "../package.json";

const VERSION = packageJson.version;

console.log(`Building btca v${VERSION}`);

await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  target: "bun",
  define: {
    __VERSION__: JSON.stringify(VERSION),
  },
});

console.log("Done");
