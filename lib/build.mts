import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import manifest from "../package.json" with { type: "json" };

const root = fileURLToPath(new URL("../", import.meta.url));
const name = manifest.name;
const release = `https://github.com/lolmaus/${name}/releases/latest/download`;
const directives = [
  ["name", "Pikabu Expand Comments"],
  ["namespace", `https://github.com/lolmaus/${name}`],
  ["version", manifest.version],
  ["match", "https://pikabu.ru/story/*"],
  ["noframes", ""],
  ["run-at", "document-end"],
  ["inject-into", "content"],
  ["grant", "GM.getValue"],
  ["grant", "GM.setValue"],
  ["updateURL", `${release}/${name}.meta.js`],
  ["downloadURL", `${release}/${name}.user.js`],
] as const;

const metadata = [
  "// ==UserScript==",
  ...directives.map(([key, value]) => `// @${key}${value ? ` ${value}` : ""}`),
  "// ==/UserScript==",
  "",
].join("\n");

await build({
  configFile: false,
  root,
  build: {
    outDir: "dist/userscript",
    minify: false,
    rolldownOptions: {
      input: "src/targets/userscript/main.ts",
      output: {
        format: "iife",
        entryFileNames: `${name}.user.js`,
        postBanner: metadata,
      },
    },
  },
});

await writeFile(new URL(`../dist/userscript/${name}.meta.js`, import.meta.url), metadata);
