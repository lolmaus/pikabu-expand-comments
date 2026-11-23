import { expect, test, vi } from "vitest";
import {
  detectPostPageLayout,
  findScrollToBottomTarget,
  measureStickyTopInset,
  mountBottomHost,
  mountTopHost,
  observeCommentView,
} from "./comment-view.ts";

test("observes the selected tab and replacement menu or comment list", async () => {
  document.body.innerHTML = `
    <section class="story-comments__menu">
      <a class="menu__item_current" href="#comments">Все комментарии</a>
      <a href="#author">Автора</a>
    </section>
    <div class="comments__container"><div class="comment">All comments</div></div>
  `;
  const menu = document.querySelector<HTMLElement>(".story-comments__menu")!;
  const container = document.querySelector<HTMLElement>(".comments__container")!;
  const changed = vi.fn();
  const stop = observeCommentView(window, changed);
  try {
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ menu, container }));

    changed.mockClear();
    container.querySelector(".comment")!.classList.add("comment_highlighted");
    await Promise.resolve();
    expect(changed).not.toHaveBeenCalled();

    menu.querySelector(".menu__item_current")!.classList.remove("menu__item_current");
    menu.querySelector("[href='#author']")!.classList.add("menu__item_current");
    await Promise.resolve();
    expect(changed).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenNthCalledWith(1);
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ menu, container }));

    const newMenu = menu.cloneNode(true) as HTMLElement;
    const newContainer = container.cloneNode(true) as HTMLElement;
    menu.replaceWith(newMenu);
    container.replaceWith(newContainer);
    await Promise.resolve();
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({ menu: newMenu, container: newContainer }),
    );
  } finally {
    stop();
  }
});

test("waits for an in-place comment list replacement and a hidden tab spinner", async () => {
  document.body.innerHTML = `
    <section class="story-comments__menu">
      <a class="menu__item_current" data-route="/story/example">Все комментарии</a>
      <div class="menu__spinner" style="display: none"></div>
    </section>
    <div class="comments__container"><div class="comment">All comments</div></div>
  `;
  const initialUrl = location.href;
  history.replaceState(null, "", "/story/example");
  const spinner = document.querySelector<HTMLElement>(".menu__spinner")!;
  const container = document.querySelector<HTMLElement>(".comments__container")!;
  const changed = vi.fn();
  const stop = observeCommentView(window, changed);
  try {
    changed.mockClear();
    history.pushState(null, "", "/story/example/author#comments");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(changed).toHaveBeenCalledExactlyOnceWith();

    spinner.style.display = "block";
    container.innerHTML = '<div class="comment">Author comments</div>';
    await Promise.resolve();
    expect(changed).toHaveBeenCalledTimes(1);

    spinner.style.display = "none";
    await Promise.resolve();
    expect(changed).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ container }));
  } finally {
    stop();
    history.replaceState(null, "", initialUrl);
  }
});

test("skips a hidden all-comments container on direct SSR Author pages and resolves bottom/scroll targets", () => {
  document.body.innerHTML = `
    <section class="story-comments__menu">
      <a data-id="all" href="/story/example#comments">Все комментарии</a>
      <a data-id="author" class="menu__item_current" href="/story/example/author#comments">Автора</a>
    </section>
    <div class="story-comments__all" style="display: none">
      <section class="comments">
        <div class="comments__container"></div>
      </section>
      <section data-role="answer">Hidden answer form</section>
    </div>
    <section class="story-comments__author">
      <div class="comments">
        <div class="comments__container" id="author-first">
          <div class="comment">Первый комментарий автора</div>
        </div>
      </div>
      <div class="comments">
        <div class="comments__container" id="author-second">
          <div class="comment" id="author-last">Последний комментарий автора</div>
        </div>
      </div>
    </section>
  `;
  const changed = vi.fn();
  const stop = observeCommentView(window, changed);
  try {
    const view = changed.mock.calls.at(-1)?.[0];
    expect(view).toMatchObject({
      tabKind: "author",
      container: document.querySelector("#author-first"),
    });

    const bottomHost = document.createElement("div");
    mountBottomHost(view, bottomHost);
    expect(document.querySelector(".story-comments__author")?.lastElementChild).toBe(bottomHost);

    // Hidden answer section in `.story-comments__all` must be skipped in favor of visible bottom host.
    expect(findScrollToBottomTarget(document, window, view, bottomHost)).toEqual({
      element: bottomHost,
      block: "center",
    });

    // When bottom controls are hidden, fall back to the last visible comment.
    bottomHost.hidden = true;
    expect(findScrollToBottomTarget(document, window, view, bottomHost)).toEqual({
      element: document.querySelector("#author-last"),
      block: "end",
    });
  } finally {
    stop();
  }
});

test("mounts bottom controls inside section.comments after .comments__container and targets visible answer section", () => {
  document.body.innerHTML = `
    <div class="story-comments__all">
      <section class="comments">
        <div class="comments__container">
          <div class="comment">Комментарий</div>
        </div>
      </section>
      <section data-role="answer">Форма ответа</section>
    </div>
  `;
  const container = document.querySelector<HTMLElement>(".comments__container")!;
  const view = { container, tabKind: "all" as const };
  const bottomHost = document.createElement("div");
  mountBottomHost(view, bottomHost);

  expect(document.querySelector("section.comments")?.lastElementChild).toBe(bottomHost);
  expect(container.nextElementSibling).toBe(bottomHost);
  expect(findScrollToBottomTarget(document, window, view, bottomHost)).toEqual({
    element: document.querySelector('section[data-role="answer"]'),
    block: "center",
  });
});

test("detects mobile html.mv layout, mounts top controls after the menu, and measures sticky top chrome", () => {
  document.documentElement.classList.add("mv");
  document.body.innerHTML = `
    <div class="promo-banner" style="position: sticky; top: 0"></div>
    <header class="header" style="position: sticky; top: 56px"></header>
    <div class="story-comments">
      <section class="story-comments__menu">
        <a class="menu__item_current" data-id="all" href="#comments">Все комментарии</a>
      </section>
      <div class="story-comments__all">
        <section class="comments">
          <div class="comments__container"><div class="comment">Комментарий</div></div>
        </section>
      </div>
    </div>
  `;
  const promo = document.querySelector<HTMLElement>(".promo-banner")!;
  const header = document.querySelector<HTMLElement>("header.header")!;
  vi.spyOn(promo, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 390, 56));
  vi.spyOn(header, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 56, 390, 56));

  const changed = vi.fn();
  const stop = observeCommentView(window, changed);
  try {
    expect(detectPostPageLayout(document)).toBe("mobile");
    const view = changed.mock.calls.at(-1)?.[0];
    expect(view).toMatchObject({ layout: "mobile", tabKind: "all" });

    const topHost = document.createElement("div");
    mountTopHost(view, topHost);
    expect(view.menu.contains(topHost)).toBe(false);
    expect(view.menu.nextElementSibling).toBe(topHost);

    expect(measureStickyTopInset(document, window)).toBe(112);

    // Promo banner slides offscreen while header stays sticky at 0..56.
    vi.spyOn(promo, "getBoundingClientRect").mockReturnValue(new DOMRect(0, -56, 390, 56));
    vi.spyOn(header, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 390, 56));
    expect(measureStickyTopInset(document, window)).toBe(56);

    // Non-sticky desktop headers contribute 0 inset.
    header.style.position = "static";
    expect(measureStickyTopInset(document, window)).toBe(0);
  } finally {
    stop();
    document.documentElement.classList.remove("mv");
  }
});
