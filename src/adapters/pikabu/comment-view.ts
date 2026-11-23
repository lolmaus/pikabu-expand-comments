export type CommentTabKind = "all" | "author";

export interface CommentView {
  menu: HTMLElement;
  container: HTMLElement;
  tabKind: CommentTabKind;
}

function isHiddenElement(element: HTMLElement, page: Window) {
  let current: HTMLElement | null = element;
  while (current) {
    if (
      current.hidden ||
      current.style.display === "none" ||
      page.getComputedStyle(current).display === "none"
    ) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function detectTabKind(selected: Element | null, pathname: string): CommentTabKind {
  if (!selected) return /\/author(?:\/|$)/.test(pathname) ? "author" : "all";
  const id = selected.getAttribute("data-id");
  if (id === "author") return "author";
  if (id === "all") return "all";
  const route = selected.getAttribute("data-route") ?? "";
  const href = selected.getAttribute("href") ?? "";
  if (
    selected.getAttribute("data-analytics-type") === "by_author" ||
    /\/author(?:\/|$|#)/.test(route) ||
    /(?:\/author|#author)(?:\/|$|#)/.test(href)
  ) {
    return "author";
  }
  return "all";
}

function findActiveContainer(document: Document, page: Window, tabKind: CommentTabKind) {
  const preferredScope = tabKind === "author" ? ".story-comments__author" : ".story-comments__all";
  const scoped = Array.from(
    document.querySelectorAll<HTMLElement>(`${preferredScope} .comments__container`),
  ).find((container) => !isHiddenElement(container, page));
  if (scoped) return scoped;

  const visible = Array.from(document.querySelectorAll<HTMLElement>(".comments__container")).find(
    (container) => !isHiddenElement(container, page),
  );
  return visible ?? document.querySelector<HTMLElement>(".comments__container");
}

export function mountBottomHost(
  view: Pick<CommentView, "container" | "tabKind">,
  host: HTMLElement,
) {
  if (view.tabKind === "author") {
    const authorSection = view.container.closest<HTMLElement>(".story-comments__author");
    if (authorSection) {
      authorSection.append(host);
      return;
    }
  }
  view.container.after(host);
}

export function findScrollToBottomTarget(
  document: Document,
  page: Window,
  view: Pick<CommentView, "container" | "tabKind">,
  bottomHost?: HTMLElement,
): { element: HTMLElement; block: ScrollLogicalPosition } | undefined {
  const answer = Array.from(
    document.querySelectorAll<HTMLElement>('section[data-role="answer"]'),
  ).find((section) => !isHiddenElement(section, page));
  if (answer) return { element: answer, block: "center" };

  if (bottomHost && bottomHost.isConnected && !bottomHost.hidden) {
    return { element: bottomHost, block: "center" };
  }

  const scope =
    view.tabKind === "author"
      ? (view.container.closest<HTMLElement>(".story-comments__author") ?? view.container)
      : (view.container.closest<HTMLElement>(".story-comments__all") ?? view.container);
  const comments = Array.from(scope.querySelectorAll<HTMLElement>(".comment")).filter(
    (comment) => !comment.closest("[hidden]") && !isHiddenElement(comment, page),
  );
  const lastComment = comments.at(-1);
  if (lastComment) return { element: lastComment, block: "end" };

  return view.container.isConnected ? { element: view.container, block: "end" } : undefined;
}

export function observeCommentView(page: Window, onChange: (view?: CommentView) => void) {
  const { document, location } = page;
  let previous:
    | (CommentView & { path: string; tab: string | null; tabRoute: string | null })
    | undefined;
  let mounted = false;
  let contentsReplaced = false;
  let containerWasMissing = false;

  function unmount() {
    if (!mounted) return;
    mounted = false;
    onChange();
  }

  function check(records: MutationRecord[] = []) {
    const menu = document.querySelector<HTMLElement>(".story-comments__menu");
    if (!menu) {
      unmount();
      previous = undefined;
      contentsReplaced = false;
      return;
    }

    const selected = menu.querySelector(".menu__item_current");
    const tabRoute = selected?.getAttribute("data-route") ?? null;
    const tab =
      selected?.getAttribute("data-id") ?? tabRoute ?? selected?.getAttribute("href") ?? null;
    const path = location.pathname;
    const tabKind = detectTabKind(selected, path);
    const container = findActiveContainer(document, page, tabKind);
    const navigated = previous && previous.path !== path && previous.tabRoute !== path;
    const sameTab = previous?.tab === tab;
    const sameContainer = !containerWasMissing && previous?.container === container;
    const spinner = menu.querySelector<HTMLElement>(".menu__spinner");
    const loading =
      spinner &&
      !spinner.hidden &&
      spinner.style.display !== "none" &&
      page.getComputedStyle(spinner).display !== "none";

    if (!container) {
      containerWasMissing = true;
      if (loading || navigated || !sameTab || previous?.menu !== menu) unmount();
      return;
    }
    containerWasMissing = false;

    if (
      previous &&
      mounted &&
      !loading &&
      !navigated &&
      sameTab &&
      sameContainer &&
      previous.menu === menu
    ) {
      previous.path = path;
      return;
    }

    // The URL can change before Pikabu replaces the old view's comment list.
    contentsReplaced ||= records.some(
      (record) =>
        record.target === container &&
        Array.from(record.removedNodes).some(
          (node) => node instanceof Element && node.matches(".comment"),
        ),
    );
    unmount();
    if (loading || (navigated && sameTab && sameContainer && !contentsReplaced)) return;

    previous = { menu, container, tabKind, path, tab, tabRoute };
    contentsReplaced = false;
    mounted = true;
    onChange(previous);
  }

  // Register before mounting so the view is invalidated before its own hydration observers run.
  const observer = new MutationObserver(check);
  observer.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden", "data-id", "data-route", "href"],
  });
  const onNavigate = () => check();
  page.navigation?.addEventListener("currententrychange", onNavigate);
  page.addEventListener("popstate", onNavigate);
  check();
  return () => {
    observer.disconnect();
    page.navigation?.removeEventListener("currententrychange", onNavigate);
    page.removeEventListener("popstate", onNavigate);
    unmount();
  };
}
