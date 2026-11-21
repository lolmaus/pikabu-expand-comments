import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { createPostPageAdapter } from "./post-page.ts";

test("waits for placeholders and rescans the Post Page in DOM order", async () => {
  const html = readFileSync("tests/fixtures/post-page.html", "utf8");
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
  const container = document.querySelector<HTMLElement>(".comments__container")!;
  const branch = container.querySelector<HTMLElement>(".comment-toggle-children")!;
  const children = container.querySelector<HTMLElement>(".comment__children")!;
  const batch = container.querySelector<HTMLButtonElement>(".comment__more")!;
  const replyPlaceholder = document.createElement("div");
  replyPlaceholder.className = "comment comment_loading-hidden";
  const batchPlaceholder = replyPlaceholder.cloneNode() as HTMLElement;

  branch.addEventListener("click", (event) => {
    event.preventDefault();
    branch.classList.remove("comment-toggle-children_collapse");
    children.hidden = false;
    children.append(replyPlaceholder);
  });
  batch.addEventListener("click", () => {
    batch.before(batchPlaceholder);
    batch.remove();
  });

  const postPage = createPostPageAdapter(container);
  expect(postPage.read()).toEqual({
    loadedCommentsCount: 1,
    remainingLoadersCount: 2,
    isHydrating: false,
  });

  const reportedCounts: number[] = [];
  const report = () => reportedCounts.push(postPage.read().loadedCommentsCount);
  const reply = postPage.expandNext(report);
  expect(postPage.read()).toMatchObject({ isHydrating: true, remainingLoadersCount: 1 });
  replyPlaceholder.classList.remove("comment_loading-hidden");
  expect(await reply).toBe(true);
  expect(reportedCounts).toEqual([1, 2]);

  const batchLoad = postPage.expandNext(report);
  expect(postPage.read()).toMatchObject({ isHydrating: true, remainingLoadersCount: 0 });
  batchPlaceholder.classList.remove("comment_loading-hidden");
  expect(await batchLoad).toBe(true);
  expect(postPage.read()).toEqual({
    loadedCommentsCount: 3,
    remainingLoadersCount: 0,
    isHydrating: false,
  });
  expect(await postPage.expandNext(report)).toBe(false);
});
