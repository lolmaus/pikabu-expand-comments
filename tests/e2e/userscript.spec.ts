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

async function preparePostPage(page: Page, alreadyExpanded = false, extraBody = "") {
  await page.route("**/*", (route) => route.abort());
  await page.route("https://pikabu.ru/fixture.js", (route) =>
    route.fulfill({ path: fixtureScript, contentType: "text/javascript" }),
  );
  await page.route(postUrl, (route) => {
    const post = alreadyExpanded
      ? expandedHtml
      : html
          .replace("</head>", `${fixtureScriptTag}</head>`)
          .replace("</body>", `${extraBody}</body>`);
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
}

async function openPostPage(page: Page, alreadyExpanded = false) {
  await preparePostPage(page, alreadyExpanded);
  await page.goto(postUrl);
}

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Настройки" }).click();
  return page.getByRole("checkbox", { name: "Раскрывать комментарии при открытии поста" });
}

function setVisibility(visibility: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { value: visibility, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
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

test("saves the preference for the next visit and keeps it enabled after Stop", async ({
  page,
}) => {
  await openPostPage(page);
  const checkbox = await openSettings(page);
  const storedPreference = () => page.evaluate(() => localStorage.getItem("autoExpandOnVisit"));
  const status = page.getByRole("status");
  const start = page.getByRole("button", { name: "Раскрыть все комментарии" });
  const stop = page.getByRole("button", { name: "Остановить" });

  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  await expect.poll(storedPreference).toBe("true");
  await expect(start).toBeVisible();

  const releaseResponse = Promise.withResolvers<void>();
  const requests = await mockCommentLoads(page, releaseResponse.promise);
  try {
    await page.reload();
    await expect.poll(() => requests).toEqual(["branch"]);
    await openSettings(page);
    await expect(checkbox).toBeChecked();

    await checkbox.uncheck();
    await expect.poll(storedPreference).toBe("false");
    await expect(stop).toBeVisible();

    await checkbox.check();
    await expect.poll(storedPreference).toBe("true");
    await stop.click();
    await expect(status).toHaveText(/Раскрытие остановлено/);
    expect(await storedPreference()).toBe("true");
  } finally {
    releaseResponse.resolve();
  }

  await expect(status).toHaveText("Раскрытие остановлено. Сейчас видно 4.");
  await page.reload();
  await expect(status).toHaveText("Все комментарии раскрыты.");
});

test("waits for both a complete document and a present comments container", async ({ page }) => {
  await preparePostPage(page, false, '<img src="/hold-load.svg" alt="">');
  await page.addInitScript(() => localStorage.setItem("autoExpandOnVisit", "true"));
  const releaseImage = Promise.withResolvers<void>();
  await page.route("**/hold-load.svg", async (route) => {
    await releaseImage.promise;
    await route.fulfill({ status: 204 });
  });
  const requests = await mockCommentLoads(page, Promise.resolve());
  const container = page.locator(".comments__container");
  const start = page.getByRole("button", { name: "Раскрыть все комментарии" });
  let detachedContainer;
  try {
    await page.goto(postUrl, { waitUntil: "domcontentloaded" });
    await expect(await openSettings(page)).toBeChecked();
    await expect(start).toBeVisible();
    expect(await page.evaluate(() => document.readyState)).toBe("interactive");
    expect(requests).toEqual([]);
    detachedContainer = await container.evaluateHandle((element) => {
      element.remove();
      return element;
    });
  } finally {
    releaseImage.resolve();
  }

  await page.waitForLoadState("load");
  await expect(start).toBeVisible();
  expect(requests).toEqual([]);
  await detachedContainer.evaluate((element) =>
    document.getElementById("comments")!.append(element),
  );
  await expect(page.getByRole("status")).toHaveText("Все комментарии раскрыты.");
});

test("defers auto-expansion while hidden and finishes once started", async ({ page }) => {
  await preparePostPage(page);
  await page.addInitScript(() => localStorage.setItem("autoExpandOnVisit", "true"));
  await page.addInitScript(setVisibility, "hidden" as const);
  const releaseResponse = Promise.withResolvers<void>();
  const requests = await mockCommentLoads(page, releaseResponse.promise);

  try {
    await page.goto(postUrl);
    await expect(await openSettings(page)).toBeChecked();
    await expect(page.getByRole("button", { name: "Раскрыть все комментарии" })).toBeVisible();
    expect(requests).toEqual([]);

    await page.evaluate(setVisibility, "visible" as const);
    await expect.poll(() => requests).toEqual(["branch"]);
    await expect(page.getByRole("button", { name: "Остановить" })).toBeVisible();
    await page.evaluate(setVisibility, "hidden" as const);
  } finally {
    releaseResponse.resolve();
  }

  await expect(page.getByRole("status")).toHaveText("Все комментарии раскрыты.");
});

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
  await page.clock.runFor(67_500);

  await expect(status).toHaveText(
    "Не удалось загрузить часть комментариев. Можно попробовать ещё раз.",
  );
  expect((await warning).text()).toContain("Pikabu Comment Batch hydration timed out.");
});

test("retries a stalled AJAX request while its loader stays clickable", async ({ page }) => {
  await page.clock.install();
  await openPostPage(page, true);
  const releaseStall = Promise.withResolvers<void>();
  const requested: number[] = [];
  await page.route("**/ajax/comments_actions.php", async (route) => {
    const attempt = requested.length + 1;
    requested.push(attempt);
    if (attempt === 1) {
      await releaseStall.promise;
      await route.abort();
      return;
    }
    await route.fulfill({ contentType: "text/plain", body: "Тестовый комментарий" });
  });
  await page.locator(".comments__container").evaluate((container) => {
    const batch = document.createElement("button");
    batch.className = "comment__more";
    batch.textContent = "Загрузить ещё";
    container.append(batch);
    const comment = document.createElement("div");
    comment.className = "comment comment_loading-hidden";
    batch.addEventListener("click", async () => {
      batch.before(comment);
      try {
        const response = await fetch("/ajax/comments_actions.php", { method: "POST" });
        comment.textContent = await response.text();
        comment.classList.remove("comment_loading-hidden");
        batch.remove();
      } catch {
        // The failed request leaves the loader available.
      }
    });
  });

  try {
    await page.getByRole("button", { name: "Раскрыть все комментарии" }).click();
    await expect.poll(() => requested).toEqual([1]);
    await page.clock.runFor(16_100);
    await expect.poll(() => requested).toEqual([1, 2]);
    await page.clock.runFor(200);
    await expect(page.getByRole("status")).toHaveText("Все комментарии раскрыты.");
  } finally {
    releaseStall.resolve();
  }
});

test("skips a silent drop, halts on three AJAX failures, and resumes via Retry", async ({
  page,
}) => {
  const now = new Date("2026-01-01T00:00:00Z");
  await page.clock.install({ time: now });
  await openPostPage(page, true);
  await page.clock.pauseAt(new Date(now.getTime() + 60_000));
  let recovered = false;
  const requested: string[] = [];
  await page.route("**/ajax/comments_actions.php", async (route) => {
    const id = route.request().postData()!;
    requested.push(id);
    await route.fulfill({ status: id === "drop" || recovered ? 204 : 429 });
  });
  const container = page.locator(".comments__container");
  await container.evaluate((element) => {
    const collapse = "comment-toggle-children_collapse";
    for (const id of ["drop", "one", "two", "three", "later"]) {
      const root = document.createElement("div");
      root.className = "comment";
      root.dataset["id"] = id;
      root.innerHTML = `<button class="comment-toggle-children ${collapse}">${id}</button>
        <div class="comment__children" hidden></div>`;
      const control = root.querySelector("button")!;
      const children = root.querySelector<HTMLElement>(".comment__children")!;
      control.addEventListener("click", async () => {
        control.classList.remove(collapse);
        children.hidden = false;
        const response = await fetch("/ajax/comments_actions.php", { method: "POST", body: id });
        if (!response.ok) {
          control.classList.add(collapse);
          children.hidden = true;
        } else if (id !== "drop") {
          children.insertAdjacentHTML("beforeend", '<div class="comment">Ответ</div>');
        }
      });
      element.append(root);
    }
  });

  await page.getByRole("button", { name: "Раскрыть все комментарии" }).evaluate((button) => {
    (button as HTMLButtonElement).click();
  });
  await expect.poll(() => requested).toEqual(["drop"]);
  await page.clock.runFor(15_150);
  for (const id of ["one", "two", "three"]) {
    const loader = container.getByRole("button", { name: id, exact: true });
    for (const [attempt, interval] of [16_000, 17_000, 19_000, 15_150].entries()) {
      await expect.poll(() => requested.filter((step) => step === id).length).toBe(attempt + 1);
      await expect(loader).toHaveClass(/comment-toggle-children_collapse/);
      await page.clock.runFor(interval);
    }
  }
  const status = page.getByRole("status");
  await expect(status).toHaveText(
    "Не удалось загрузить часть комментариев. Можно попробовать ещё раз.",
  );
  expect(requested).not.toContain("later");

  recovered = true;
  // Pikabu can replace a dropped branch control with a collapsed one for the same comment.
  await container.getByRole("button", { name: "drop", exact: true }).evaluate((button) => {
    const replacement = button.cloneNode(true) as Element;
    replacement.classList.add("comment-toggle-children_collapse");
    button.replaceWith(replacement);
  });
  const retry = page.getByRole("button", { name: "Повторить" });
  await expect(retry).toBeVisible();
  await retry.evaluate((button) => (button as HTMLButtonElement).click());
  for (const id of ["one", "two", "three", "later"]) {
    await expect(container.locator(`[data-id="${id}"] .comment__children`)).toHaveText("Ответ");
    await page.clock.runFor(150);
  }
  await expect(status).toHaveText("Одну ветку не удалось раскрыть.");
  expect(requested.slice(13)).toEqual(["one", "two", "three", "later"]);
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
