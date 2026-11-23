import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { createPostPageAdapter } from "./post-page.ts";

const collapseClass = "comment-toggle-children_collapse";

function loadFixture() {
  const html = readFileSync("tests/fixtures/post-page.html", "utf8");
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
  return document.querySelector<HTMLElement>(".comments__container")!;
}

test("suppresses native scroll anchoring only on the current container during a run", () => {
  const container = loadFixture();
  container.style.setProperty("overflow-anchor", "auto", "important");
  const postPage = createPostPageAdapter(container);

  postPage.setRunning(true);
  expect(container.style.getPropertyValue("overflow-anchor")).toBe("none");

  const replacement = document.createElement("div");
  replacement.className = "comments__container";
  container.replaceWith(replacement);
  postPage.setRunning(true);
  expect(container.style.getPropertyValue("overflow-anchor")).toBe("auto");
  expect(container.style.getPropertyPriority("overflow-anchor")).toBe("important");
  expect(replacement.style.getPropertyValue("overflow-anchor")).toBe("none");

  postPage.setRunning(false);
  expect(replacement.style.getPropertyValue("overflow-anchor")).toBe("");
});

test("waits for hydration and prioritizes visible Reply Branches over Comment Batches", async () => {
  const container = loadFixture();
  const branch = container.querySelector<HTMLElement>('[data-action="branch"]')!;
  const children = branch.nextElementSibling as HTMLElement;
  const onlyHidden = container.querySelector<HTMLElement>('[data-action="only-hidden"]')!;
  const hydrated = container.querySelector<HTMLElement>('[data-action="hydrated"]')!;
  const batch = container.querySelector<HTMLButtonElement>(".comment__more")!;
  const replyPlaceholder = document.createElement("div");
  replyPlaceholder.className = "comment comment_placeholder";
  replyPlaceholder.innerHTML = `<button class="comment-toggle-children comment-toggle-children_next-floor ${collapseClass}">раскрыть ветку</button>`;
  const nextFloor = replyPlaceholder.querySelector("button")!;

  branch.addEventListener("click", (event) => {
    event.preventDefault();
    branch.classList.remove(collapseClass);
    children.hidden = false;
    children.append(replyPlaceholder);
  });

  const postPage = createPostPageAdapter(container);
  expect(postPage.read()).toEqual({
    loadedCommentsCount: 3,
    totalCommentsCount: 10,
    loaders: [branch, onlyHidden, hydrated, batch],
    isHydrating: false,
  });

  const onSettled = vi.fn();
  const reply = postPage.expand(branch).then(onSettled);
  expect(postPage.read()).toMatchObject({
    isHydrating: true,
    loaders: [onlyHidden, hydrated, batch],
  });
  await Promise.resolve();
  expect(onSettled).not.toHaveBeenCalled();

  replyPlaceholder.classList.remove("comment_placeholder");
  await reply;
  expect(onSettled).toHaveBeenCalledWith("expanded");
  expect(postPage.read()).toEqual({
    loadedCommentsCount: 4,
    totalCommentsCount: 10,
    loaders: [nextFloor, onlyHidden, hydrated, batch],
    isHydrating: false,
  });
});

test("settles a hydrated Reply Branch immediately, even with no change to the visible count", async () => {
  vi.useFakeTimers();
  try {
    const container = loadFixture();
    const branch = container.querySelector<HTMLElement>('[data-action="hydrated"]')!;
    const children = branch.nextElementSibling as HTMLElement;
    branch.addEventListener("click", () => {
      branch.classList.remove(collapseClass);
      children.hidden = false;
      // A separate branch can close while this one is opened.
      container.querySelector<HTMLElement>("#comment_2")!.hidden = true;
    });

    const postPage = createPostPageAdapter(container);
    const countBefore = postPage.read().loadedCommentsCount;
    const onSettled = vi.fn();
    const expansion = postPage.expand(branch).then(onSettled);
    await vi.advanceTimersByTimeAsync(0);
    expect(onSettled).toHaveBeenCalledWith("expanded");
    await expansion;
    expect(postPage.read()).toMatchObject({
      loadedCommentsCount: countBefore,
      isHydrating: false,
    });
    expect(children.hidden).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

test("reports clicks that collapse an open Reply Branch, including clicks on its label", () => {
  const container = loadFixture();
  const branch = container.querySelector<HTMLElement>('[data-action="hydrated"]')!;
  const label = document.createElement("span");
  branch.append(label);
  branch.addEventListener("click", () => branch.classList.toggle(collapseClass));

  const postPage = createPostPageAdapter(container);
  const onCollapse = vi.fn();
  postPage.observeManualCollapses(onCollapse);
  label.click();
  expect(onCollapse).not.toHaveBeenCalled();
  expect(postPage.read().loaders).not.toContain(branch);
  label.click();
  expect(onCollapse).toHaveBeenCalledExactlyOnceWith(branch);
  expect(postPage.read().loaders).toContain(branch);
});

test.each(["comment__collapsing-area", "comment__close-branch"])(
  "associates a click on %s with its open Reply Branch",
  (className) => {
    const container = loadFixture();
    const branch = container.querySelector<HTMLElement>('[data-action="hydrated"]')!;
    branch.classList.remove(collapseClass);
    const children = branch.nextElementSibling as HTMLElement;
    children.hidden = false;
    const close = document.createElement("div");
    close.className = className;
    children.append(close);

    const onCollapse = vi.fn();
    createPostPageAdapter(container).observeManualCollapses(onCollapse);
    close.click();

    expect(onCollapse).toHaveBeenCalledExactlyOnceWith(branch);
  },
);

test("a stalled placeholder inside a closed branch stops blocking after the step timeout", async () => {
  vi.useFakeTimers();
  try {
    const container = loadFixture();
    const branch = container.querySelector<HTMLElement>('[data-action="branch"]')!;
    const children = branch.nextElementSibling as HTMLElement;
    const reply = document.createElement("div");
    reply.className = "comment comment_placeholder";

    branch.addEventListener("click", (event) => {
      event.preventDefault();
      children.hidden = branch.classList.toggle(collapseClass);
      if (!children.hidden) children.append(reply);
    });

    const postPage = createPostPageAdapter(container);
    const onSettled = vi.fn();
    const expanding = postPage.expand(branch).then(onSettled);
    branch.click();
    await vi.advanceTimersByTimeAsync(500);
    expect(onSettled).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    await expanding;
    expect(onSettled).toHaveBeenCalledWith("withdrawn");
    expect(children.hidden).toBe(true);
    expect(postPage.read()).toMatchObject({ loadedCommentsCount: 3, isHydrating: false });
  } finally {
    vi.useRealTimers();
  }
});

test("skips a Reply Branch that opens without ever inserting replies", async () => {
  vi.useFakeTimers();
  try {
    const container = loadFixture();
    const branch = container.querySelector<HTMLElement>('[data-action="only-hidden"]')!;
    branch.addEventListener("click", () => branch.classList.remove(collapseClass));

    const postPage = createPostPageAdapter(container);
    const expanding = postPage.expand(branch);
    await vi.runAllTimersAsync();
    expect(await expanding).toBe("skipped");
  } finally {
    vi.useRealTimers();
  }
});

test("a Reply Branch closed by a failed load times out and remains clickable", async () => {
  vi.useFakeTimers();
  try {
    const container = loadFixture();
    const branch = container.querySelector<HTMLElement>('[data-action="branch"]')!;
    const children = branch.nextElementSibling as HTMLElement;
    branch.addEventListener("click", (event) => {
      event.preventDefault();
      branch.classList.remove(collapseClass);
      children.hidden = false;
      setTimeout(() => {
        branch.classList.add(collapseClass);
        children.hidden = true;
      }, 100);
    });

    const postPage = createPostPageAdapter(container);
    const expanding = postPage.expand(branch);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await expanding).toEqual({
      timeout: expect.objectContaining({ message: "Pikabu Reply Branch hydration timed out." }),
    });
    expect(postPage.read().loaders).toContain(branch);
  } finally {
    vi.useRealTimers();
  }
});

test("recognizes when a Comment Batch reveals existing top-level comments", async () => {
  vi.useFakeTimers();
  try {
    const container = loadFixture();
    const batch = container.querySelector<HTMLElement>(".comment__more")!;
    const concealed = container.querySelector<HTMLElement>("#comment_2")!;
    concealed.hidden = true;
    batch.addEventListener("click", () => {
      concealed.hidden = false;
    });

    const postPage = createPostPageAdapter(container);
    const expansion = expect(postPage.expand(batch)).resolves.toBe("next-batch");
    await vi.runAllTimersAsync();
    await expansion;
  } finally {
    vi.useRealTimers();
  }
});

test("a decreasing Comment Batch count is progress even when replies stay hidden", async () => {
  const container = loadFixture();
  const batch = container.querySelector<HTMLElement>(".comment__more")!;
  const count = batch.querySelector(".comments__more-count")!;
  const children = container.querySelector(".comment__children")!;

  batch.addEventListener("click", () => {
    children.insertAdjacentHTML("beforeend", '<div class="comment">Тестовый ответ</div>');
    count.textContent = "1 комментарий";
  });

  const postPage = createPostPageAdapter(container);
  const initialCount = postPage.read().loadedCommentsCount;
  await expect(postPage.expand(batch)).resolves.toBe("next-batch");
  expect(postPage.read().loadedCommentsCount).toBe(initialCount);
});

test("aborts pending Reply Branch hydration without waiting for the timeout", async () => {
  const container = loadFixture();
  const postPage = createPostPageAdapter(container);
  const loader = container.querySelector<HTMLElement>('[data-action="branch"]')!;
  const signal = new AbortController();
  const expansion = postPage.expand(loader, signal.signal);

  signal.abort();
  await expect(expansion).rejects.toMatchObject({ name: "AbortError" });
});

test("omits totalCommentsCount on the Author tab and reads across multiple author containers", () => {
  document.body.innerHTML = `
    <article class="story" data-comments="1710"></article>
    <section class="story-comments__author">
      <div class="comments">
        <div class="comments__container">
          <div class="comment">Контекст 1</div>
          <div class="comment">Ответ автора 1</div>
        </div>
      </div>
      <div class="comments">
        <div class="comments__container">
          <div class="comment">
            Ответ автора 2
            <button class="comment-toggle-children ${collapseClass}">раскрыть ветку</button>
          </div>
        </div>
      </div>
    </section>
  `;
  const firstContainer = document.querySelector<HTMLElement>(".comments__container")!;
  const postPage = createPostPageAdapter(firstContainer, "author");
  const snapshot = postPage.read();
  expect(snapshot.loadedCommentsCount).toBe(3);
  expect(snapshot.totalCommentsCount).toBeUndefined();
  expect(snapshot.loaders).toHaveLength(1);
});

test("falls back to .story__comments-link-count when article.story[data-comments] is absent", () => {
  document.body.innerHTML = `
    <span class="story__comments-link-count">42</span>
    <div class="story-comments__all">
      <div class="comments__container">
        <div class="comment">Комментарий</div>
      </div>
    </div>
  `;
  const container = document.querySelector<HTMLElement>(".comments__container")!;
  expect(createPostPageAdapter(container, "all").read().totalCommentsCount).toBe(42);
});

test("hydrates mobile Reply Branches with .comment_placeholder SVG skeletons and ignores hidden SSR comments", async () => {
  document.documentElement.classList.add("mv");
  document.body.innerHTML = `
    <article class="story" data-comments="1710"></article>
    <div class="story-comments__all">
      <section class="comments">
        <div class="comments__container">
          <div class="comment" id="comment_1" data-id="1" data-indent="0">
            <div class="comment__body">Первый мобильный комментарий</div>
            <div class="comment-toggle-children ${collapseClass}">раскрыть ветку (2)</div>
            <div class="comment__children" hidden></div>
          </div>
          <div class="comment" id="comment_2" data-id="2" hidden><div class="comment__body">SSR 2</div></div>
          <div class="comment" id="comment_3" data-id="3" hidden><div class="comment__body">SSR 3</div></div>
          <div class="comment" id="comment_4" data-id="4" hidden><div class="comment__body">SSR 4</div></div>
          <div class="comment" id="comment_5" data-id="5" hidden><div class="comment__body">SSR 5</div></div>
          <button type="button" class="comment__more">Раскрыть <span class="comments__more-count">1709 комментариев</span></button>
        </div>
      </section>
    </div>
  `;
  try {
    const container = document.querySelector<HTMLElement>(".comments__container")!;
    const branch = container.querySelector<HTMLElement>(".comment-toggle-children")!;
    const children = branch.nextElementSibling as HTMLElement;
    const skeleton = document.createElement("div");
    skeleton.className = "comment comment_placeholder";
    skeleton.dataset["id"] = "101";
    skeleton.dataset["indent"] = "6";
    skeleton.innerHTML =
      '<div class="comment__placeholder"><svg width="400" height="100"></svg></div>';

    branch.addEventListener("click", () => {
      branch.classList.remove(collapseClass);
      children.hidden = false;
      children.append(skeleton);
    });

    const postPage = createPostPageAdapter(container, "all");
    expect(postPage.read().loadedCommentsCount).toBe(1);
    expect(postPage.read().totalCommentsCount).toBe(1710);

    const onSettled = vi.fn();
    const expanding = postPage.expand(branch).then(onSettled);
    expect(postPage.read().isHydrating).toBe(true);
    await Promise.resolve();
    expect(onSettled).not.toHaveBeenCalled();

    // Hydrate the mobile SVG skeleton into a real comment with a next-floor branch at data-indent="6".
    skeleton.classList.remove("comment_placeholder");
    skeleton.innerHTML = `<div class="comment__body">Ответ 6 уровня</div>
      <div class="comment-toggle-children comment-toggle-children_next-floor ${collapseClass}">раскрыть ветку (5)</div>
      <div class="comment__children comment__children_next-floor" hidden></div>`;
    await expanding;

    expect(onSettled).toHaveBeenCalledWith("expanded");
    const after = postPage.read();
    expect(after.isHydrating).toBe(false);
    expect(after.loadedCommentsCount).toBe(2);
    expect(after.loaders[0]?.classList.contains("comment-toggle-children_next-floor")).toBe(true);
  } finally {
    document.documentElement.classList.remove("mv");
  }
});

test("anchors scroll preservation below a sticky mobile top header instead of y = 0", async () => {
  document.documentElement.classList.add("mv");
  document.body.innerHTML = `
    <header class="header" style="position: sticky; top: 0"></header>
    <div class="story-comments__all">
      <section class="comments">
        <div class="comments__container">
          <div class="comment" id="behind_header" data-id="1">Скрыт под шапкой</div>
          <div class="comment" id="visible_below_header" data-id="2">Виден под шапкой</div>
          <button type="button" class="comment__more">Раскрыть</button>
        </div>
      </section>
    </div>
  `;
  const originalElementsFromPoint = document.elementsFromPoint;
  const originalScrollBy = window.scrollBy;
  try {
    const header = document.querySelector<HTMLElement>("header.header")!;
    const container = document.querySelector<HTMLElement>(".comments__container")!;
    const behind = document.querySelector<HTMLElement>("#behind_header")!;
    const visible = document.querySelector<HTMLElement>("#visible_below_header")!;
    const batch = document.querySelector<HTMLElement>(".comment__more")!;

    vi.spyOn(header, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 390, 56));
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(new DOMRect(0, -40, 390, 800));
    vi.spyOn(behind, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 4, 390, 48));
    let visibleTop = 64;
    vi.spyOn(visible, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(0, visibleTop, 390, 80),
    );
    vi.spyOn(visible, "getClientRects").mockReturnValue([new DOMRect(0, 64, 390, 80)] as never);

    const probedY: number[] = [];
    document.elementsFromPoint = (_x: number, y: number) => {
      probedY.push(y);
      return y >= 56 ? [visible] : [behind];
    };
    const scrollBySpy = vi.fn();
    window.scrollBy = scrollBySpy;

    batch.addEventListener("click", () => {
      visibleTop = 184;
      batch.insertAdjacentHTML("beforebegin", '<div class="comment">Новый</div>');
      batch.remove();
    });

    const postPage = createPostPageAdapter(container, "all");
    postPage.setRunning(true);
    await postPage.expand(batch);

    expect(probedY[0]).toBe(60);
    expect(scrollBySpy).toHaveBeenCalledWith({ top: 120, behavior: "instant" });
    postPage.setRunning(false);
  } finally {
    document.elementsFromPoint = originalElementsFromPoint;
    window.scrollBy = originalScrollBy;
    document.documentElement.classList.remove("mv");
  }
});
