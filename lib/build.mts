import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import manifest from "../package.json" with { type: "json" };
import {
  collectDirectoryZipEntries,
  createDeterministicZip,
  writeDeterministicZipFromDir,
  type ZipEntryInput,
} from "./zip.mts";

type BuildTarget = "all" | "userscript" | "chrome" | "firefox" | "source";

const root = fileURLToPath(new URL("../", import.meta.url));
const name = manifest.name;
const extensionVersion = manifest.version;

function parseTarget(argv: readonly string[]): BuildTarget {
  const flag = argv.find((arg) => arg.startsWith("--target="));
  const value = flag?.slice("--target=".length) ?? "all";
  if (
    value === "all" ||
    value === "userscript" ||
    value === "chrome" ||
    value === "firefox" ||
    value === "source"
  ) {
    return value;
  }
  throw new Error(
    `Unsupported --target value "${value}". Expected one of: all, userscript, chrome, firefox, source.`,
  );
}

function assertNumericSemver(version: string) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(
      `Extension version "${version}" must be strict numeric MAJOR.MINOR.PATCH for CWS and AMO.`,
    );
  }
}

async function buildUserscript() {
  const buildTimestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const release = `https://github.com/lolmaus/${name}/releases/latest/download`;
  const directives = [
    ["name", "Pikabu Expand Comments"],
    ["namespace", `https://github.com/lolmaus/${name}`],
    ["version", manifest.version],
    ["build", buildTimestamp],
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
      emptyOutDir: true,
      minify: false,
      rolldownOptions: {
        input: "src/targets/userscript/main.ts",
        output: {
          format: "iife",
          codeSplitting: false,
          entryFileNames: `${name}.user.js`,
          postBanner: metadata,
        },
      },
    },
  });

  await writeFile(new URL(`../dist/userscript/${name}.meta.js`, import.meta.url), metadata);
}

function createExtensionManifest(browser: "chrome" | "firefox") {
  assertNumericSemver(extensionVersion);
  const base = {
    manifest_version: 3,
    name: "__MSG_extensionName__",
    description: "__MSG_extensionDescription__",
    version: extensionVersion,
    default_locale: "en",
    permissions: ["storage", "activeTab"],
    icons: {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png",
      "96": "icons/icon-96.png",
      "128": "icons/icon-128.png",
    },
    action: {
      default_title: "__MSG_actionTitle__",
      default_popup: "popup.html",
      default_icon: {
        "16": "icons/icon-16.png",
        "32": "icons/icon-32.png",
      },
    },
    content_scripts: [
      {
        matches: ["https://pikabu.ru/story/*"],
        js: ["content.js"],
        run_at: "document_end",
        all_frames: false,
      },
    ],
  };

  if (browser === "chrome") {
    return base;
  }

  return {
    ...base,
    browser_specific_settings: {
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
    },
  };
}

async function buildExtensionBundle(stagingDir: string) {
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });

  // Pass 1: Extension content script as a single-file non-minified IIFE (deterministic, no hashes).
  await build({
    configFile: false,
    root,
    build: {
      outDir: stagingDir,
      emptyOutDir: true,
      minify: false,
      rolldownOptions: {
        input: resolve(root, "src/targets/extension/content.ts"),
        output: {
          format: "iife",
          codeSplitting: false,
          entryFileNames: "content.js",
        },
      },
    },
  });

  // Pass 2: Extension popup HTML/CSS/TS emitted flat at extension root.
  await build({
    configFile: false,
    root: resolve(root, "src/targets/extension/popup"),
    base: "./",
    build: {
      outDir: stagingDir,
      emptyOutDir: false,
      minify: false,
      modulePreload: false,
      rolldownOptions: {
        input: resolve(root, "src/targets/extension/popup/popup.html"),
        output: {
          entryFileNames: "assets/[name].js",
          chunkFileNames: "assets/[name].js",
          assetFileNames: "assets/[name][extname]",
        },
      },
    },
  });

  // Copy static localized strings and pre-exported PNG icons.
  cpSync(resolve(root, "src/targets/extension/_locales"), join(stagingDir, "_locales"), {
    recursive: true,
  });
  const iconsDest = join(stagingDir, "icons");
  mkdirSync(iconsDest, { recursive: true });
  for (const size of [16, 32, 48, 96, 128]) {
    cpSync(resolve(root, `assets/icons/icon-${size}.png`), join(iconsDest, `icon-${size}.png`));
  }
}

function emitBrowserPackage(stagingDir: string, browser: "chrome" | "firefox") {
  const outDir = resolve(root, "dist", browser);
  rmSync(outDir, { recursive: true, force: true });
  cpSync(stagingDir, outDir, { recursive: true });
  const manifestJson = `${JSON.stringify(createExtensionManifest(browser), null, 2)}\n`;
  writeFileSync(join(outDir, "manifest.json"), manifestJson, "utf8");
  writeDeterministicZipFromDir(outDir, resolve(root, "dist", `${name}-${browser}.zip`));
}

function buildFirefoxSourceArchive() {
  const distDir = resolve(root, "dist");
  mkdirSync(distDir, { recursive: true });

  const allowedRootFiles = new Set([
    ".nvmrc",
    "AMO_BUILD.md",
    "GLOSSARY.md",
    "PRIVACY.md",
    "README.md",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
    "tsconfig.browser.json",
    "tsconfig.json",
    "tsconfig.node.json",
    "tsconfig.playwright.json",
    "tsconfig.vitest.json",
  ]);
  const allowedDirPrefixes = ["assets/icons/", "lib/", "src/"];
  const isBuildSourcePath = (rel: string): boolean => {
    if (allowedRootFiles.has(rel)) return true;
    if (rel.endsWith(".test.ts")) return false;
    return allowedDirPrefixes.some((prefix) => rel.startsWith(prefix));
  };

  let relPaths: string[] | undefined;
  if (existsSync(resolve(root, ".git"))) {
    try {
      const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
        .split("\0")
        .filter((p) => p.length > 0 && isBuildSourcePath(p) && existsSync(resolve(root, p)));
      if (tracked.length > 0 && tracked.includes("src/targets/extension/content.ts")) {
        relPaths = tracked;
      }
    } catch {
      // Fall back to deterministic directory collection if git is unavailable.
    }
  }

  const entries: ZipEntryInput[] = [];
  if (relPaths) {
    for (const rel of relPaths) {
      entries.push({ path: posix.normalize(rel), data: readFileSync(resolve(root, rel)) });
    }
  } else {
    for (const rel of allowedRootFiles) {
      const abs = resolve(root, rel);
      if (existsSync(abs)) {
        entries.push({ path: rel, data: readFileSync(abs) });
      }
    }
    for (const dir of ["assets/icons", "lib", "src"]) {
      const absDir = resolve(root, dir);
      if (!existsSync(absDir)) continue;
      for (const entry of collectDirectoryZipEntries(absDir, dir)) {
        if (entry.path.endsWith(".test.ts")) continue;
        entries.push({ path: posix.normalize(entry.path), data: entry.data });
      }
    }
  }

  writeFileSync(resolve(distDir, `${name}-firefox-source.zip`), createDeterministicZip(entries));
}

const target = parseTarget(process.argv.slice(2));
const needsExtension = target === "all" || target === "chrome" || target === "firefox";

if (target === "all" || target === "userscript") {
  await buildUserscript();
}

if (needsExtension) {
  const stagingDir = resolve(root, "dist/.extension-staging");
  try {
    await buildExtensionBundle(stagingDir);
    if (target === "all" || target === "chrome") {
      emitBrowserPackage(stagingDir, "chrome");
    }
    if (target === "all" || target === "firefox") {
      emitBrowserPackage(stagingDir, "firefox");
    }
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

if (target === "all" || target === "source") {
  buildFirefoxSourceArchive();
}
