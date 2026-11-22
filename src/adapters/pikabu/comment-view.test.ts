import { expect, test, vi } from "vitest";
import { observeCommentView } from "./comment-view.ts";

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
