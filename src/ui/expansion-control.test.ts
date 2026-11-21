import { expect, test, vi } from "vitest";
import { mountExpansionControl } from "./expansion-control.ts";

test("presents the Russian action and status inside the comments menu", () => {
  document.body.innerHTML = '<section class="story-comments__menu"></section>';
  const menu = document.querySelector<HTMLElement>(".story-comments__menu")!;
  const start = vi.fn();
  const stop = vi.fn();
  const render = mountExpansionControl(
    menu,
    { start, stop, saveAutoExpandOnVisit: async () => true },
    Promise.resolve(false),
  );
  const shadowRoot = menu.firstElementChild!.shadowRoot!;
  const button = shadowRoot.querySelector("button")!;
  const status = shadowRoot.querySelector('[role="status"]')!;
  const metrics = {
    loadedCommentsCount: 3,
    expandedStepsCount: 0,
    remainingLoadersCount: 0,
    skippedCount: 0,
    initiallyEmpty: false,
  };

  render({ ...metrics, state: "idle" });
  expect(button.textContent).toBe("Раскрыть все комментарии");
  expect(button.hidden).toBe(false);
  button.click();
  expect(start).toHaveBeenCalledOnce();

  render({ ...metrics, state: "running" });
  expect(status.textContent).toBe("Раскрываем комментарии… Сейчас видно 3.");
  expect(button.textContent).toBe("Остановить");
  expect(button.hidden).toBe(false);
  button.click();
  expect(stop).toHaveBeenCalledOnce();

  render({ ...metrics, state: "stopped" });
  expect(status.textContent).toBe("Раскрытие остановлено. Сейчас видно 3.");
  expect(button.textContent).toBe("Продолжить");
  expect(button.hidden).toBe(false);
  button.click();
  expect(start).toHaveBeenCalledTimes(2);

  render({ ...metrics, state: "completed" });
  expect(status.textContent).toBe("Все комментарии раскрыты.");
  expect(button.hidden).toBe(true);
  render({ ...metrics, state: "completed", initiallyEmpty: true });
  expect(status.textContent).toBe("Все комментарии уже раскрыты.");
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
  const checkbox = shadow.querySelector<HTMLInputElement>("input")!;
  const label = checkbox.closest("label")!;
  expect(settings.textContent).toBe("Настройки");
  expect(settings.getAttribute("aria-expanded")).toBe("false");
  expect(label.hidden).toBe(true);

  settings.click();
  await savedPreference;
  expect(settings.getAttribute("aria-expanded")).toBe("true");
  expect(label.hidden).toBe(false);
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
  expect(label.hidden).toBe(true);
});
