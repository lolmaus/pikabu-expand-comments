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

async function mockCommentLoads(page: Page, response: Promise<void>, heldAction = "branch") {
  const requests: Array<string | null> = [];
  await page.route("**/ajax/comments_actions.php", async (route) => {
    const step = route.request().postData();
    requests.push(step);
    if (step === heldAction) await response;
    await route.fulfill({ contentType: "text/plain; charset=utf-8", body: `Комментарий ${step}` });
  });
  return requests;
}

test("expands all Reply Branch variants in order before repeated Comment Batches", async ({
  page,
}) => {
  await openPostPage(page);
  const releaseFirstResponse = Promise.withResolvers<void>();
  const requests = await mockCommentLoads(page, releaseFirstResponse.promise);

  const status = page.getByRole("status");
  const container = page.locator(".comments__container");
  await page.getByRole("button", { name: "Раскрыть все комментарии" }).click();
  try {
    await expect(status).toHaveText("Раскрываем комментарии… Сейчас видно 3.");
    await expect(container.locator(".comment_loading-hidden")).toHaveCount(1);
    await expect.poll(() => requests).toEqual(["branch"]);
  } finally {
    releaseFirstResponse.resolve();
  }

  await expect(status).toHaveText("Все комментарии раскрыты.");
  await expect(container).toHaveAttribute(
    "data-actions",
    "branch next-floor-1 next-floor-2 only-hidden hydrated batch-1 batch-2",
  );
  await expect(container.locator(".comment:visible")).toHaveCount(10);
  await expect(container.locator(".comment_loading-hidden")).toHaveCount(0);
  await expect(container.locator(".comment-toggle-children_collapse")).toHaveCount(0);
  await expect(container.getByText("Текст спойлера")).toBeHidden();
  await expect(container.getByText("Свёрнутый комментарий")).toBeHidden();
  await expect(page.getByRole("button", { name: "Остановить" })).toBeHidden();
  expect(requests).toEqual([
    "branch",
    "next-floor-1",
    "next-floor-2",
    "only-hidden",
    "batch-1",
    "batch-2",
  ]);
});

test("Stop lets the current step settle and Continue respects a branch the reader collapsed", async ({
  page,
}) => {
  await page.clock.install();
  await openPostPage(page);
  const releaseFirstResponse = Promise.withResolvers<void>();
  const requests = await mockCommentLoads(page, releaseFirstResponse.promise);
  const container = page.locator(".comments__container");
  const readerBranch = container.getByRole("button", { name: "раскрыть загруженную ветку (1)" });
  const status = page.getByRole("status");

  await readerBranch.click();
  await expect(container.getByText("Загруженный ответ")).toBeVisible();
  await page.getByRole("button", { name: "Раскрыть все комментарии" }).click();
  try {
    await expect.poll(() => requests).toEqual(["branch"]);
    await container.locator("#comment_3 > .comment__children > .comment__collapsing-area").click();
    await expect(container.getByText("Загруженный ответ")).toBeHidden();
    await page.getByRole("button", { name: "Остановить" }).click();
    await expect(status).toHaveText("Раскрытие остановлено. Сейчас видно 3.");
    await expect(page.getByRole("button", { name: "Продолжить" })).toBeVisible();
  } finally {
    releaseFirstResponse.resolve();
  }

  await expect(status).toHaveText("Раскрытие остановлено. Сейчас видно 4.");
  await page.clock.runFor(500);
  expect(requests).toEqual(["branch"]);

  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(status).toHaveText("Все комментарии раскрыты.");
  await expect(container.getByText("Загруженный ответ")).toBeHidden();
  await expect(container).toHaveAttribute(
    "data-actions",
    "hydrated branch collapse-hydrated next-floor-1 next-floor-2 only-hidden batch-1 batch-2",
  );
  await expect(container.locator(".comment:visible")).toHaveCount(9);
});

test("continues to the next batch when collapsing a parent removes a loading branch", async ({
  page,
}) => {
  await openPostPage(page);
  const releaseResponse = Promise.withResolvers<void>();
  const requests = await mockCommentLoads(page, releaseResponse.promise, "next-floor-1");
  const container = page.locator(".comments__container");
  const readerBranch = container.locator("#comment_1");
  const toggle = readerBranch.locator(":scope > .comment-toggle-children");

  await page.getByRole("button", { name: "Раскрыть все комментарии" }).click();
  try {
    await expect.poll(() => requests).toEqual(["branch", "next-floor-1"]);
    await toggle.evaluate((control) => {
      // Model Pikabu discarding the nested controls and replacing the parent toggle.
      document.addEventListener("click", (event) => {
        if (event.target !== control) return;
        control.nextElementSibling!.querySelector(".comment")!.remove();
        control.replaceWith(control.cloneNode(true));
      });
    });
    await toggle.click();
    await expect(readerBranch.locator('[data-action="next-floor-1"]')).toHaveCount(0);
  } finally {
    releaseResponse.resolve();
  }

  await expect(page.getByRole("status")).toHaveText("Все комментарии раскрыты.");
  await expect(readerBranch.locator(":scope > .comment__children")).toBeHidden();
  expect(requests).toEqual(["branch", "next-floor-1", "only-hidden", "batch-1", "batch-2"]);
});

test("collapsing the only open root leaves hidden placeholders without blocking batches", async ({
  page,
}) => {
  await page.clock.install();
  await openPostPage(page);
  const releaseResponse = Promise.withResolvers<void>();
  const requests = await mockCommentLoads(page, releaseResponse.promise);
  const container = page.locator(".comments__container");
  await container.evaluate((element) => {
    element.querySelector("#comment_2")!.remove();
    element.querySelector("#comment_3")!.remove();
    const root = element.querySelector("#comment_1")!;
    const children = root.querySelector(":scope > .comment__children")!;
    const toggle = root.querySelector(":scope > .comment-toggle-children")!;
    document.addEventListener("click", (event) => {
      if (event.target !== toggle || !children.hasAttribute("hidden")) return;
      // Pikabu can keep concealed placeholders in a subtree after it closes.
      children.insertAdjacentHTML(
        "beforeend",
        '<div class="comment comment_loading-hidden"></div>',
      );
    });
  });
  const rootToggle = container.locator("#comment_1 > .comment-toggle-children");
  await page.getByRole("button", { name: "Раскрыть все комментарии" }).click();
  try {
    await expect.poll(() => requests).toEqual(["branch"]);
    await rootToggle.click();
    await expect(container.locator(".comment:visible")).toHaveCount(1);
    await page.clock.runFor(500);
    expect(requests).toEqual(["branch"]);
  } finally {
    releaseResponse.resolve();
  }

  await expect(page.getByRole("status")).toHaveText("Все комментарии раскрыты.");
  await expect(container.locator("#comment_1 > .comment__children")).toBeHidden();
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

test("reports which loader timed out when showing Retry", async ({ page }) => {
  await page.clock.install();
  await openPostPage(page, true);
  const status = page.getByRole("status");
  await page.locator(".comments__container").evaluate((container) => {
    container.insertAdjacentHTML(
      "beforeend",
      '<button class="comment__more">Раскрыть <span class="comments__more-count">419 комментариев</span></button>',
    );
  });
  const warning = page.waitForEvent("console", {
    predicate: (message) => message.text().startsWith("[Pikabu Expand Comments]"),
  });

  await page.getByRole("button", { name: "Раскрыть все комментарии" }).click();
  await page.clock.fastForward(16_000);

  await expect(status).toHaveText(
    "Не удалось загрузить часть комментариев. Можно попробовать ещё раз.",
  );
  expect((await warning).text()).toContain("Pikabu Comment Batch hydration timed out.");
});

test("continues after a batch hydrates replies under the same top-level comment", async ({
  page,
}) => {
  await page.clock.install();
  await openPostPage(page, true);
  const container = page.locator(".comments__container");
  await container.evaluate((element) => {
    const root = element.querySelector(".comment")!;
    root.insertAdjacentHTML("beforeend", '<div class="comment__children"></div>');
    element.insertAdjacentHTML(
      "beforeend",
      '<button class="comment__more">Раскрыть <span class="comments__more-count">446 комментариев</span></button>',
    );
    const batch = element.querySelector(".comment__more")!;
    batch.addEventListener(
      "click",
      () => {
        root
          .querySelector(".comment__children")!
          .insertAdjacentHTML(
            "beforeend",
            '<div class="comment comment_placeholder">Тестовый ответ</div>',
          );
      },
      { once: true },
    );
  });

  await page.getByRole("button", { name: "Раскрыть все комментарии" }).click();
  const reply = container.locator(".comment__children .comment");
  await expect(reply).toHaveClass(/comment_placeholder/);
  await expect(page.getByRole("status")).toHaveText("Раскрываем комментарии… Сейчас видно 1.");
  await container.evaluate((element) => {
    const batch = element.querySelector(".comment__more")!;
    batch.addEventListener("click", () => batch.remove(), { once: true });
    element.querySelector(".comment_placeholder")!.classList.remove("comment_placeholder");
  });

  await page.clock.fastForward(16_000);
  await expect(page.getByRole("status")).toHaveText("Все комментарии раскрыты.");
  await expect(container.locator(":scope > .comment")).toHaveCount(1);
});
