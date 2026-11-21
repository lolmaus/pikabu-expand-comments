import type { PostPageAdapter } from "../../core/expansion-run.ts";

const collapsedReplyBranch = ".comment-toggle-children.comment-toggle-children_collapse";
const commentBatch = ".comment__more";
const placeholder = ".comment_loading-hidden";
const hidden = `[hidden], ${placeholder}`;
const hydrationTimeoutMs = 15_000;

export function createPostPageAdapter(initialContainer: HTMLElement): PostPageAdapter {
  // Pikabu can replace the comment list while keeping the surrounding view.
  const view = initialContainer.closest(".story-comments__all") ?? initialContainer.parentElement;

  function currentContainer() {
    return view ? view.querySelector(".comments__container") : initialContainer;
  }

  function visibleElements(selector: string) {
    return Array.from(currentContainer()?.querySelectorAll<HTMLElement>(selector) ?? []).filter(
      (element) => !element.closest(hidden),
    );
  }

  function loaders() {
    return visibleElements(`${collapsedReplyBranch}, ${commentBatch}`).filter(
      (element) => !element.matches(":disabled"),
    );
  }

  function loadedCommentsCount() {
    return visibleElements(".comment").length;
  }

  function isHydrating() {
    const container = currentContainer();
    return !container || container.querySelector(placeholder) !== null;
  }

  function observeChanges(onChange: () => void) {
    const observer = new MutationObserver(() => onChange());
    observer.observe(view ?? initialContainer, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "hidden", "disabled"],
    });
    return () => observer.disconnect();
  }

  function observeUntil(settled: () => boolean, onChange: () => void, click?: () => void) {
    return new Promise<void>((resolve, reject) => {
      const disconnect = observeChanges(check);
      const timeout = setTimeout(() => {
        disconnect();
        reject(new Error("Pikabu comment hydration timed out."));
      }, hydrationTimeoutMs);

      function check() {
        onChange();
        if (settled()) {
          disconnect();
          clearTimeout(timeout);
          resolve();
        }
      }

      click?.();
      check();
    });
  }

  return {
    observeChanges,

    read() {
      return {
        loadedCommentsCount: loadedCommentsCount(),
        remainingLoadersCount: loaders().length,
        isHydrating: isHydrating(),
      };
    },

    async waitForHydration(onChange) {
      if (isHydrating()) await observeUntil(() => !isHydrating(), onChange);
    },

    async expandNext(onChange) {
      const loader = loaders()[0];
      if (!loader) return false;
      const previousCount = loadedCommentsCount();
      const isReplyBranch = loader.matches(collapsedReplyBranch);

      await observeUntil(
        () =>
          !isHydrating() &&
          (!isReplyBranch || !loader.matches(collapsedReplyBranch)) &&
          loadedCommentsCount() > previousCount,
        onChange,
        () => loader.click(),
      );
      return true;
    },
  };
}
