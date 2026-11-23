import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, expect, test } from "vitest";

const repoRoot = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as {
  name: string;
  version: string;
};

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

beforeAll(() => {
  execFileSync(process.execPath, ["lib/build.mts", "--target=chrome"], {
    cwd: repoRoot,
    stdio: "pipe",
  });
  execFileSync(process.execPath, ["lib/build.mts", "--target=firefox"], {
    cwd: repoRoot,
    stdio: "pipe",
  });
});

test("emits exact Chrome and Firefox MV3 manifests with zero embedded timestamps and deterministic ZIPs", () => {
  const chromeManifest = JSON.parse(
    readFileSync(resolve(repoRoot, "dist/chrome/manifest.json"), "utf8"),
  ) as Record<string, unknown>;
  const firefoxManifest = JSON.parse(
    readFileSync(resolve(repoRoot, "dist/firefox/manifest.json"), "utf8"),
  ) as Record<string, unknown>;

  for (const manifest of [chromeManifest, firefoxManifest]) {
    expect(manifest["manifest_version"]).toBe(3);
    expect(manifest["version"]).toBe(pkg.version);
    expect(manifest["default_locale"]).toBe("en");
    expect(manifest["permissions"]).toEqual(["storage", "activeTab"]);
    expect(manifest["background"]).toBeUndefined();
    expect(manifest["host_permissions"]).toBeUndefined();
    expect(manifest["key"]).toBeUndefined();
    expect(manifest["icons"]).toEqual({
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png",
      "96": "icons/icon-96.png",
      "128": "icons/icon-128.png",
    });
    expect(manifest["action"]).toEqual({
      default_title: "__MSG_actionTitle__",
      default_popup: "popup.html",
      default_icon: {
        "16": "icons/icon-16.png",
        "32": "icons/icon-32.png",
      },
    });
    expect(manifest["content_scripts"]).toEqual([
      {
        matches: ["https://pikabu.ru/story/*"],
        js: ["content.js"],
        run_at: "document_end",
        all_frames: false,
      },
    ]);
  }

  expect(chromeManifest["browser_specific_settings"]).toBeUndefined();
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

  for (const rel of [
    "dist/chrome/content.js",
    "dist/chrome/assets/popup.js",
    "dist/firefox/content.js",
    "dist/firefox/assets/popup.js",
  ]) {
    expect(existsSync(resolve(repoRoot, rel))).toBe(true);
    expect(readFileSync(resolve(repoRoot, rel), "utf8")).not.toContain("@build");
  }

  const chromeZip = resolve(repoRoot, `dist/${pkg.name}-chrome.zip`);
  const firefoxZip = resolve(repoRoot, `dist/${pkg.name}-firefox.zip`);
  const chromeHash1 = sha256(chromeZip);
  const firefoxHash1 = sha256(firefoxZip);

  execFileSync(process.execPath, ["lib/build.mts", "--target=chrome"], {
    cwd: repoRoot,
    stdio: "pipe",
  });
  execFileSync(process.execPath, ["lib/build.mts", "--target=firefox"], {
    cwd: repoRoot,
    stdio: "pipe",
  });

  expect(sha256(chromeZip)).toBe(chromeHash1);
  expect(sha256(firefoxZip)).toBe(firefoxHash1);
});
