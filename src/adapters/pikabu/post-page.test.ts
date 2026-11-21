import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { createPostPageAdapter } from "./post-page.ts";

const collapseClass = "comment-toggle-children_collapse";

function loadFixture() {
  const html = readFileSync("tests/fixtures/post-page.html", "utf8");
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
  return document.querySelector<HTMLElement>(".comments__container")!;
}

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
