import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const manifest = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { name: string; version: string };
const builtUserscript = readFileSync(
  new URL("../../dist/userscript/pikabu-expand-comments.user.js", import.meta.url),
  "utf8",
);
const builtMetadata = readFileSync(
  new URL("../../dist/userscript/pikabu-expand-comments.meta.js", import.meta.url),
  "utf8",
);

test("emits userscript metadata matching package.json with an ISO-8601 UTC @build timestamp", () => {
  const headerMatch = builtUserscript.match(
    /^\/\/ ==UserScript==\n[\s\S]*?\n\/\/ ==\/UserScript==\n/,
  );
  expect(headerMatch).not.toBeNull();
  const header = headerMatch![0];
  expect(builtMetadata).toBe(header);

  const buildMatch = header.match(/^\/\/ @build (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)$/m);
  expect(buildMatch).not.toBeNull();
  const buildTimestamp = buildMatch![1]!;
  expect(Number.isFinite(Date.parse(buildTimestamp))).toBe(true);

  const releaseUrl = `https://github.com/lolmaus/${manifest.name}/releases/latest/download`;
  expect(header).toBe(
    [
      "// ==UserScript==",
      "// @name Pikabu Expand Comments",
      `// @namespace https://github.com/lolmaus/${manifest.name}`,
      `// @version ${manifest.version}`,
      `// @build ${buildTimestamp}`,
      "// @match https://pikabu.ru/story/*",
      "// @noframes",
      "// @run-at document-end",
      "// @inject-into content",
      "// @grant GM.getValue",
      "// @grant GM.setValue",
      `// @updateURL ${releaseUrl}/${manifest.name}.meta.js`,
      `// @downloadURL ${releaseUrl}/${manifest.name}.user.js`,
      "// ==/UserScript==",
      "",
    ].join("\n"),
  );
});
