import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
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

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

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

test("emits compliant Chrome and Firefox MV3 manifests with zero timestamps and deterministic ZIPs", () => {
  const chromeManifest = JSON.parse(
    readFileSync(new URL("../../dist/chrome/manifest.json", import.meta.url), "utf8"),
  ) as Record<string, unknown>;
  const firefoxManifest = JSON.parse(
    readFileSync(new URL("../../dist/firefox/manifest.json", import.meta.url), "utf8"),
  ) as Record<string, unknown>;

  for (const [label, extManifest] of [
    ["chrome", chromeManifest],
    ["firefox", firefoxManifest],
  ] as const) {
    expect(extManifest["manifest_version"], label).toBe(3);
    expect(extManifest["version"], label).toBe(manifest.version);
    expect(extManifest["default_locale"], label).toBe("en");
    expect(extManifest["permissions"], label).toEqual(["storage", "activeTab"]);
    expect(extManifest["background"], `${label} must have no background worker`).toBeUndefined();
    expect(
      extManifest["host_permissions"],
      `${label} must have no host_permissions`,
    ).toBeUndefined();
    expect(extManifest["key"], `${label} must omit key`).toBeUndefined();
    expect(extManifest["icons"], label).toEqual({
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png",
      "96": "icons/icon-96.png",
      "128": "icons/icon-128.png",
    });
    expect(extManifest["action"], label).toEqual({
      default_title: "__MSG_actionTitle__",
      default_popup: "popup.html",
      default_icon: {
        "16": "icons/icon-16.png",
        "32": "icons/icon-32.png",
      },
    });
    expect(extManifest["content_scripts"], label).toEqual([
      {
        matches: ["https://pikabu.ru/story/*"],
        js: ["content.js"],
        run_at: "document_end",
        all_frames: false,
      },
    ]);
  }

  // Chrome omits browser_specific_settings.
  expect(chromeManifest["browser_specific_settings"]).toBeUndefined();

  // Firefox includes gecko + gecko_android + zero-data-collection consent.
  expect(firefoxManifest["browser_specific_settings"]).toEqual({
    gecko: {
      id: "pikabu-expand-comments@lolmaus.github.io",
      strict_min_version: "140.0",
      data_collection_permissions: {
        required: ["none"],
      },
    },
    gecko_android: {
      strict_min_version: "142.0",
    },
  });

  // Extension bundles must never embed @build wall-clock timestamps.
  for (const path of [
    "../../dist/chrome/content.js",
    "../../dist/chrome/assets/popup.js",
    "../../dist/firefox/content.js",
    "../../dist/firefox/assets/popup.js",
  ]) {
    const content = readFileSync(new URL(path, import.meta.url), "utf8");
    expect(content).not.toContain("@build");
  }

  // Rebuilding Firefox produces a byte-for-byte identical ZIP (deterministic timestamps & ordering).
  const firefoxZip = fileURLToPath(
    new URL("../../dist/pikabu-expand-comments-firefox.zip", import.meta.url),
  );
  const chromeZip = fileURLToPath(
    new URL("../../dist/pikabu-expand-comments-chrome.zip", import.meta.url),
  );
  const sourceZip = fileURLToPath(
    new URL("../../dist/pikabu-expand-comments-firefox-source.zip", import.meta.url),
  );
  expect(existsSync(chromeZip)).toBe(true);
  expect(existsSync(firefoxZip)).toBe(true);
  expect(existsSync(sourceZip)).toBe(true);
  // AMO source archive limit is 200 MB; ours should stay tiny (< 5 MB).
  expect(statSync(sourceZip).size).toBeLessThan(5 * 1024 * 1024);

  const chromeHashBefore = sha256File(chromeZip);
  const firefoxHashBefore = sha256File(firefoxZip);
  execFileSync(process.execPath, ["lib/build.mts", "--target=chrome"], {
    cwd: repoRoot,
    stdio: "pipe",
  });
  execFileSync(process.execPath, ["lib/build.mts", "--target=firefox"], {
    cwd: repoRoot,
    stdio: "pipe",
  });
  expect(sha256File(chromeZip)).toBe(chromeHashBefore);
  expect(sha256File(firefoxZip)).toBe(firefoxHashBefore);
});

test("dist/firefox passes web-ext lint with --warnings-as-errors", () => {
  const output = execFileSync(
    "pnpm",
    ["exec", "web-ext", "lint", "--source-dir", "dist/firefox", "--warnings-as-errors"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  expect(output).toContain("errors");
});
