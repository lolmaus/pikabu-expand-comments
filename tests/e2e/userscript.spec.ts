import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const html = readFileSync(new URL("../fixtures/post-page.html", import.meta.url), "utf8");
const expandedHtml = readFileSync(
  new URL("../fixtures/post-page-expanded.html", import.meta.url),
  "utf8",
);
const fixtureScript = fileURLToPath(new URL("../fixtures/comment-loading.js", import.meta.url));
const userscript = readFileSync(
  new URL("../../dist/userscript/pikabu-expand-comments.user.js", import.meta.url),
  "utf8",
);
const postUrl = "https://pikabu.ru/story/fixture_1";
const fixtureScriptTag = '<script src="/fixture.js" defer></script>';

async function openPostPage(page: Page, alreadyExpanded = false) {
  await page.route("**/*", (route) => route.abort());
  await page.route("https://pikabu.ru/fixture.js", (route) =>
    route.fulfill({ path: fixtureScript, contentType: "text/javascript" }),
  );
  await page.route(postUrl, (route) => {
    const post = alreadyExpanded
      ? expandedHtml
      : html.replace("</head>", `${fixtureScriptTag}</head>`);
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: post });
  });
  await page.addInitScript({
    content: `globalThis.GM = {
      getValue: async (key) => JSON.parse(localStorage.getItem(key)),
      setValue: async (key, value) => localStorage.setItem(key, JSON.stringify(value)),
    };
    // Simulate a userscript manager that wraps window but leaves window.top unwrapped.
    ((window) => {
      ${userscript}
    })(new Proxy(window, {}));`,
  });
  await page.goto(postUrl);
}

test("one click expands a Reply Branch and repeated Comment Batches to completion", async ({
  page,
}) => {
  await openPostPage(page);
  const requests: Array<string | null> = [];
  const releaseFirstResponse = Promise.withResolvers<void>();
  await page.route("**/ajax/comments_actions.php", async (route) => {
    const step = route.request().postData();
    requests.push(step);
    if (step === "branch") await releaseFirstResponse.promise;
    await route.fulfill({ contentType: "text/plain; charset=utf-8", body: `Комментарий ${step}` });
  });

  const status = page.getByRole("status");
  await page.getByRole("button", { name: "Раскрыть все комментарии" }).click();
  try {
    await expect(status).toHaveText("Раскрываем комментарии… Сейчас видно 1.");
    await expect(page.locator(".comment_loading-hidden")).toHaveCount(1);
    await expect.poll(() => requests).toEqual(["branch"]);
  } finally {
    releaseFirstResponse.resolve();
  }

  await expect(status).toHaveText("Все комментарии раскрыты.");
  await expect(page.locator(".comments__container .comment")).toHaveCount(4);
  await expect(page.locator(".comment_loading-hidden")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Раскрыть все комментарии" })).toBeHidden();
  expect(requests).toEqual(["branch", "batch-1", "batch-2"]);
});

test("an already-expanded Post Page immediately shows the completed status", async ({ page }) => {
  await openPostPage(page, true);
  await expect(page.getByRole("status")).toHaveText("Все комментарии уже раскрыты.");
  await expect(page.getByRole("button", { name: "Раскрыть все комментарии" })).toBeHidden();
});

test("offers expansion when Pikabu inserts a loader after the controls mount", async ({ page }) => {
  await openPostPage(page, true);
  await expect(page.getByRole("status")).toHaveText("Все комментарии уже раскрыты.");

  await page.locator(".comments__container").evaluate((container) => {
    const loader = document.createElement("button");
    loader.type = "button";
    loader.className = "comment__more";
    loader.textContent = "Раскрыть 1 комментарий";
    container.append(loader);
  });

  await expect(page.getByRole("button", { name: "Раскрыть все комментарии" })).toBeVisible();
  await expect(page.getByRole("status")).toBeEmpty();
});

test("finds the batch loader after Pikabu replaces the comment container", async ({ page }) => {
  await openPostPage(page, true);
  await expect(page.getByRole("status")).toHaveText("Все комментарии уже раскрыты.");

  await page.locator(".comments__container").evaluate((container) => {
    const replacement = container.cloneNode(true) as Element;
    replacement.insertAdjacentHTML(
      "beforeend",
      '<button class="comment__more">Раскрыть <span class="comments__more-count">1708 комментариев</span></button>',
    );
    container.replaceWith(replacement);
    const batch = replacement.querySelector(".comment__more")!;
    batch.addEventListener("click", () => {
      batch.insertAdjacentHTML("beforebegin", '<div class="comment">Тестовый комментарий</div>');
      batch.remove();
    });
  });

  await page.getByRole("button", { name: "Раскрыть все комментарии" }).click({ timeout: 2500 });
  await expect(page.getByRole("status")).toHaveText("Все комментарии раскрыты.");
});
