interface CommentView {
  menu: HTMLElement;
  container: HTMLElement;
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
    const container = document.querySelector<HTMLElement>(".comments__container");
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

    previous = { menu, container, path, tab, tabRoute };
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
