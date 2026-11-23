import { expect, test, vi } from "vitest";
import { mountExpansionControl } from "./expansion-control.ts";

test("presents the Russian action, counter, scroll button, and status inside the comments menu", () => {
  document.body.innerHTML = '<section class="story-comments__menu"></section>';
  const menu = document.querySelector<HTMLElement>(".story-comments__menu")!;
  const start = vi.fn();
  const stop = vi.fn();
  const scrollToBottom = vi.fn();
  const render = mountExpansionControl(
    menu,
    { start, stop, scrollToBottom, saveAutoExpandOnVisit: async () => true },
    Promise.resolve(false),
  );
  const shadowRoot = menu.firstElementChild!.shadowRoot!;
  const button = shadowRoot.querySelector("button")!;
  const counter = shadowRoot.querySelector('[data-role="counter"]')!;
  const scrollButton = shadowRoot.querySelector<HTMLButtonElement>(
    '[data-role="scroll-to-bottom"]',
  )!;
  const status = shadowRoot.querySelector('[role="status"]')!;
  const metrics = {
    loadedCommentsCount: 3,
    totalCommentsCount: 10,
    expandedStepsCount: 0,
    remainingLoadersCount: 0,
    skippedCount: 0,
    initiallyEmpty: false,
  };

  render({ ...metrics, state: "idle" });
  expect(button.textContent).toBe("Раскрыть все комментарии");
  expect(button.hidden).toBe(false);
  expect(counter.textContent).toBe("3 / 10");
  expect(scrollButton.hidden).toBe(false);
  button.click();
  expect(start).toHaveBeenCalledExactlyOnceWith("top");
  scrollButton.click();
  expect(scrollToBottom).toHaveBeenCalledOnce();

  render({ ...metrics, state: "running" });
  expect(status.textContent).toBe("Раскрываем комментарии…");
  expect(counter.textContent).toBe("3 / 10");
  expect(button.textContent).toBe("Остановить");
  expect(button.hidden).toBe(false);
  button.click();
  expect(stop).toHaveBeenCalledOnce();

  render({ ...metrics, state: "stopped" });
  expect(status.textContent).toBe("Раскрытие остановлено.");
  expect(button.textContent).toBe("Продолжить");
  expect(button.hidden).toBe(false);
  button.click();
  expect(start).toHaveBeenCalledTimes(2);

  render({ ...metrics, state: "error" });
  expect(status.textContent).toBe("Ошибка загрузки комментариев.");
  expect(button.textContent).toBe("Повторить");
  expect(button.hidden).toBe(false);
  button.click();
  expect(start).toHaveBeenCalledTimes(3);

  render({ ...metrics, loadedCommentsCount: 12, state: "completed" });
  expect(status.textContent).toBe("Все комментарии раскрыты.");
  expect(counter.textContent).toBe("12 / 12");
  expect(button.hidden).toBe(true);
  expect(scrollButton.hidden).toBe(false);

  const { totalCommentsCount: _, ...metricsWithoutTotal } = metrics;
  render({
    ...metricsWithoutTotal,
    loadedCommentsCount: 4,
    state: "completed",
    initiallyEmpty: true,
  });
  expect(status.textContent).toBe("Все комментарии уже раскрыты.");
  expect(counter.textContent).toBe("4");
});

test("mirrors controls at the bottom, hides only when initiallyEmpty, and suppresses floating Stop when bottom is visible", async () => {
  document.body.innerHTML =
    '<section class="story-comments__menu"></section><section class="comments"><div class="comments__container"></div></section>';
  const menu = document.querySelector<HTMLElement>(".story-comments__menu")!;
  const container = document.querySelector<HTMLElement>(".comments__container")!;
  const start = vi.fn();
  const stop = vi.fn();
  const save = vi.fn(async () => true);
  let bottomHost: HTMLElement | undefined;

  const render = mountExpansionControl(
    menu,
    { start, stop, scrollToBottom: vi.fn(), saveAutoExpandOnVisit: save },
    Promise.resolve(false),
    undefined,
    (host) => {
      bottomHost = host;
      container.after(host);
    },
  );
  const topHost = menu.firstElementChild as HTMLElement;
  const topShadow = topHost.shadowRoot!;
  const bottomShadow = bottomHost!.shadowRoot!;

  expect(bottomShadow.querySelector('[data-role="scroll-to-bottom"]')).toBeNull();
  expect(bottomShadow.querySelector('[role="status"]')).toBeNull();

  // Hidden when initiallyEmpty
  render({
    state: "completed",
    loadedCommentsCount: 2,
    totalCommentsCount: 2,
    expandedStepsCount: 0,
    remainingLoadersCount: 0,
    skippedCount: 0,
    initiallyEmpty: true,
  });
  expect(bottomHost!.hidden).toBe(true);

  // Clicking bottom Start passes "bottom" source
  render({
    state: "idle",
    loadedCommentsCount: 5,
    totalCommentsCount: 10,
    expandedStepsCount: 0,
    remainingLoadersCount: 1,
    skippedCount: 0,
    initiallyEmpty: false,
  });
  bottomShadow.querySelector("button")!.click();
  expect(start).toHaveBeenCalledExactlyOnceWith("bottom");

  // Visible in idle and running; floating Stop stays hidden while bottom controls are in viewport
  vi.spyOn(topHost, "getBoundingClientRect").mockReturnValue(new DOMRect(0, -100, 200, 50));
  const bottomRect = vi
    .spyOn(bottomHost!, "getBoundingClientRect")
    .mockReturnValue(new DOMRect(0, 400, 600, 40));

  render({
    state: "running",
    loadedCommentsCount: 5,
    totalCommentsCount: 10,
    expandedStepsCount: 1,
    remainingLoadersCount: 1,
    skippedCount: 0,
    initiallyEmpty: false,
  });
  expect(bottomHost!.hidden).toBe(false);
  expect(bottomShadow.querySelector('[data-role="counter"]')?.textContent).toBe("5 / 10");
  expect(topShadow.querySelector<HTMLButtonElement>(".floating-stop")!.hidden).toBe(true);

  // Once bottom scrolls below viewport, floating Stop appears
  bottomRect.mockReturnValue(new DOMRect(0, window.innerHeight + 200, 600, 40));
  window.dispatchEvent(new Event("scroll"));
  expect(topShadow.querySelector<HTMLButtonElement>(".floating-stop")!.hidden).toBe(false);

  // Clicking bottom Stop triggers stop
  bottomShadow.querySelector("button")!.click();
  expect(stop).toHaveBeenCalledOnce();

  // Toggling bottom settings checkbox synchronizes top checkbox
  await Promise.resolve();
  const bottomCheckbox = bottomShadow.querySelector<HTMLInputElement>("input")!;
  const topCheckbox = topShadow.querySelector<HTMLInputElement>("input")!;
  bottomCheckbox.click();
  await Promise.resolve();
  expect(save).toHaveBeenCalledWith(true);
  expect(topCheckbox.checked).toBe(true);
  expect(bottomCheckbox.checked).toBe(true);

  // Stays visible on post-run completed with action button hidden
  render({
    state: "completed",
    loadedCommentsCount: 10,
    totalCommentsCount: 10,
    expandedStepsCount: 3,
    remainingLoadersCount: 0,
    skippedCount: 0,
    initiallyEmpty: false,
  });
  expect(bottomHost!.hidden).toBe(false);
  expect(bottomShadow.querySelector("button")!.hidden).toBe(true);
  expect(bottomShadow.querySelector('[data-role="status"]')?.textContent).toBe(
    "Все комментарии раскрыты.",
  );
});

test("the offscreen shortcut stops the run and returns focus to Continue", () => {
  document.body.innerHTML = "<section></section>";
  const menu = document.querySelector("section")!;
  const snapshot = {
    loadedCommentsCount: 3,
    expandedStepsCount: 0,
    remainingLoadersCount: 1,
    skippedCount: 0,
    initiallyEmpty: false,
  };
  const render = mountExpansionControl(
    menu,
    {
      start: vi.fn(),
      stop: () => render({ ...snapshot, state: "stopped" }),
      saveAutoExpandOnVisit: async () => true,
    },
    Promise.resolve(false),
  );
  const host = menu.firstElementChild!;
  vi.spyOn(host, "getBoundingClientRect").mockReturnValue(new DOMRect(0, -100, 200, 50));
  const shadow = host.shadowRoot!;
  render({ ...snapshot, state: "running" });
  const visibleStopButtons = Array.from(shadow.querySelectorAll("button")).filter(
    (button) => button.textContent === "Остановить" && !button.hidden,
  );
  expect(visibleStopButtons).toHaveLength(2);
  const [inlineStop, shortcut] = visibleStopButtons;
  shortcut!.focus();
  shortcut!.click();
  expect(shortcut!.hidden).toBe(true);
  expect(shadow.activeElement).toBe(inlineStop);
  expect(inlineStop!.textContent).toBe("Продолжить");
});

test.each([
  [1, "Одну ветку не удалось раскрыть."],
  [2, "Не удалось раскрыть 2 ветки."],
  [5, "Не удалось раскрыть 5 веток."],
  [11, "Не удалось раскрыть 11 веток."],
  [21, "Не удалось раскрыть 21 ветку."],
  [24, "Не удалось раскрыть 24 ветки."],
])("pluralizes the completion message for %i skipped Reply Branches", (skippedCount, text) => {
  const menu = document.createElement("section");
  const render = mountExpansionControl(
    menu,
    { start: vi.fn(), stop: vi.fn(), saveAutoExpandOnVisit: async () => true },
    Promise.resolve(false),
  );
  render({
    state: "completed",
    loadedCommentsCount: 3,
    expandedStepsCount: 0,
    remainingLoadersCount: 0,
    skippedCount,
    initiallyEmpty: false,
  });
  expect(menu.firstElementChild?.shadowRoot?.querySelector('[role="status"]')?.textContent).toBe(
    text,
  );
});

test("discloses the saved preference and restores it if saving fails", async () => {
  document.body.innerHTML = '<section class="story-comments__menu"></section>';
  const menu = document.querySelector<HTMLElement>(".story-comments__menu")!;
  const save = Promise.withResolvers<boolean>();
  const savedPreference = Promise.resolve(false);
  mountExpansionControl(
    menu,
    { start: vi.fn(), stop: vi.fn(), saveAutoExpandOnVisit: () => save.promise },
    savedPreference,
  );
  const shadow = menu.firstElementChild!.shadowRoot!;
  const settings = shadow.querySelector<HTMLButtonElement>("[aria-controls]")!;
  const popover = shadow.querySelector<HTMLElement>("#expansion-settings")!;
  const checkbox = shadow.querySelector<HTMLInputElement>("input")!;
  const label = checkbox.closest("label")!;
  expect(settings.getAttribute("aria-label")).toBe("Настройки");
  expect(settings.getAttribute("aria-expanded")).toBe("false");
  expect(popover.hidden).toBe(true);

  settings.click();
  await savedPreference;
  expect(settings.getAttribute("aria-expanded")).toBe("true");
  expect(popover.hidden).toBe(false);
  expect(label.textContent?.trim()).toBe("Раскрывать комментарии при открытии поста");
  expect(checkbox.checked).toBe(false);

  checkbox.click();
  expect(checkbox.checked).toBe(true);
  expect(checkbox.disabled).toBe(true);
  save.resolve(false);
  await save.promise;
  expect(checkbox.disabled).toBe(false);
  expect(checkbox.checked).toBe(false);

  settings.click();
  expect(settings.getAttribute("aria-expanded")).toBe("false");
  expect(popover.hidden).toBe(true);

  settings.click();
  expect(popover.hidden).toBe(false);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(settings.getAttribute("aria-expanded")).toBe("false");
  expect(popover.hidden).toBe(true);
  expect(shadow.activeElement).toBe(settings);
});
