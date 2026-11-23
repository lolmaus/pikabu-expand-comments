import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Page } from "@playwright/test";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
export const CHROME_EXTENSION_DIR = resolve(repoRoot, "dist/chrome");
const chromiumExecutable = process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"];

export interface ExtensionContextHandle {
  context: BrowserContext;
  close(): Promise<void>;
}

export async function launchChromeExtensionContext(options?: {
  hasTouch?: boolean;
  isMobile?: boolean;
  viewport?: { width: number; height: number };
}): Promise<ExtensionContextHandle> {
  // Linux AF_UNIX socket paths cap at 108 bytes; keep Chromium's SingletonSocket under a short dir.
  const useShortPosixTmp = process.platform !== "win32" && tmpdir().length > 40;
  const baseTmp = useShortPosixTmp ? "/tmp" : tmpdir();
  const userDataDir = mkdtempSync(join(baseTmp, "pkb-ext-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    chromiumSandbox: false,
    ...(chromiumExecutable ? { executablePath: chromiumExecutable } : {}),
    ...(useShortPosixTmp ? { env: { ...process.env, TMPDIR: "/tmp" } } : {}),
    ...(options?.hasTouch !== undefined ? { hasTouch: options.hasTouch } : {}),
    ...(options?.isMobile !== undefined ? { isMobile: options.isMobile } : {}),
    ...(options?.viewport ? { viewport: options.viewport } : {}),
    args: [
      `--disable-extensions-except=${CHROME_EXTENSION_DIR}`,
      `--load-extension=${CHROME_EXTENSION_DIR}`,
    ],
  });

  return {
    context,
    async close() {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

export async function discoverExtensionId(
  context: BrowserContext,
  page: Page,
  targetUrl: string,
): Promise<string> {
  const cdp = await context.newCDPSession(page);
  let resolvedId: string | undefined;
  const idPromise = new Promise<string>((resolveId) => {
    cdp.on("Runtime.executionContextCreated", ({ context: execContext }) => {
      const origin = execContext.origin ?? "";
      const match = origin.match(/^chrome-extension:\/\/([a-z]{32})$/);
      if (match?.[1] && !resolvedId) {
        resolvedId = match[1];
        resolveId(resolvedId);
      }
    });
  });
  await cdp.send("Runtime.enable");
  await page.goto(targetUrl);
  try {
    return await Promise.race([
      idPromise,
      new Promise<string>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                "Failed to discover Chrome extension ID via CDP (ensure unbranded Chromium with --load-extension).",
              ),
            ),
          10_000,
        ),
      ),
    ]);
  } finally {
    await cdp.detach();
  }
}
