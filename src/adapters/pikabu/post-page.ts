import type { PostPageAdapter } from "../../core/expansion-run.ts";

const replyBranch = ".comment-toggle-children";
const collapseClass = "comment-toggle-children_collapse";
const collapsedReplyBranch = `${replyBranch}.${collapseClass}`;
const collapseControl = ".comment__collapsing-area, .comment__close-branch";
const commentBatch = ".comment__more";
const placeholder =
  ".comment_loading-hidden, .comment_placeholder, .comment:has(> .comment__placeholder)";
const hidden = `[hidden], ${placeholder}`;
const hydrationTimeoutMs = 15_000;

export function createPostPageAdapter(initialContainer: HTMLElement): PostPageAdapter<HTMLElement> {
  // Pikabu can replace the comment list while keeping the surrounding view.
  const view =
    initialContainer.closest(".story-comments__all") ??
    initialContainer.parentElement ??
    initialContainer;
  const replyIdentities = new Map<string, object>();

  function currentContainer() {
    return view === initialContainer ? view : view.querySelector(".comments__container");
  }

  function visibleElements(selector: string) {
    return Array.from(currentContainer()?.querySelectorAll<HTMLElement>(selector) ?? []).filter(
      (element) => !element.closest(hidden),
    );
  }

  function isHydrating() {
    const container = currentContainer();
    if (!container) return true;
    return Array.from(container.querySelectorAll(placeholder)).some(
      (element) => !element.closest("[hidden]"),
    );
  }

  function observeChanges(onChange: () => void) {
    const observer = new MutationObserver(onChange);
    observer.observe(view, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "hidden", "disabled"],
    });
    return () => observer.disconnect();
  }

  function observeUntil(settled: () => boolean, click?: () => void) {
    return new Promise<boolean>((resolve) => {
      const disconnect = observeChanges(check);
      const timeout = setTimeout(() => finish(false), hydrationTimeoutMs);

      function finish(didSettle: boolean) {
        disconnect();
        clearTimeout(timeout);
        resolve(didSettle);
      }

      function check() {
        if (settled()) finish(true);
      }

      click?.();
      check();
    });
  }

  async function expandReplyBranch(loader: HTMLElement) {
    const observedPlaceholders = new Set<Element>();
    function replyContainer() {
      const children = loader.nextElementSibling;
      return children?.matches(".comment__children") ? children : undefined;
    }
    function hasHydratedReplies() {
      return Boolean(replyContainer()?.querySelector(`.comment:not(${placeholder})`));
    }
    let opened = false;
    let withdrawn = false;

    const settled = await observeUntil(
      () => {
        const collapsed = loader.classList.contains(collapseClass);
        // Collapsing a branch can hide or remove a loading descendant.
        withdrawn =
          !currentContainer()?.contains(loader) ||
          loader.parentElement?.closest("[hidden]") != null ||
          (opened && collapsed);
        opened ||= !collapsed;
        if (!withdrawn) {
          replyContainer()
            ?.querySelectorAll(placeholder)
            .forEach((comment) => {
              if (!comment.closest("[hidden]")) observedPlaceholders.add(comment);
            });
        }
        if (isHydrating()) return false;
        if (!withdrawn) return opened && hasHydratedReplies();
        // Let any observed in-flight replies finish even if a reader hides them.
        return !Array.from(observedPlaceholders).some(
          (comment) => currentContainer()?.contains(comment) && comment.matches(placeholder),
        );
      },
      () => loader.click(),
    );

    if (withdrawn && !isHydrating()) return "withdrawn";
    if (settled) return "expanded";
    if (!loader.classList.contains(collapseClass) && !isHydrating() && !hasHydratedReplies()) {
      return "skipped";
    }
    throw new Error("Pikabu Reply Branch hydration timed out.", {
      cause: {
        commentId: loader.closest(".comment")?.getAttribute("data-id"),
        opened,
        withdrawn,
        collapsed: loader.matches(collapsedReplyBranch),
        connected: loader.isConnected,
        hasReplyContainer: Boolean(replyContainer()),
        hasHydratedReplies: hasHydratedReplies(),
        isHydrating: isHydrating(),
      },
    });
  }

  async function expandCommentBatch(loader: HTMLElement) {
    // A batch can reveal replies below the existing root and reuse the same button.
    const remainingBatchLabel = () => loader.querySelector(".comments__more-count")?.textContent;
    const previousBatchLabel = remainingBatchLabel();
    const previousCount = Number.parseInt(previousBatchLabel ?? "", 10);
    const previousComments = new Set(visibleElements(".comment"));
    const settled = await observeUntil(
      () =>
        !isHydrating() &&
        (!currentContainer()?.contains(loader) ||
          Number.parseInt(remainingBatchLabel() ?? "", 10) < previousCount ||
          visibleElements(".comment").some((comment) => !previousComments.has(comment))),
      () => loader.click(),
    );
    if (!settled) {
      throw new Error("Pikabu Comment Batch hydration timed out.", {
        cause: {
          connected: loader.isConnected,
          visibleCommentsBefore: previousComments.size,
          visibleCommentsAfter: visibleElements(".comment").length,
          previousBatchCount: previousBatchLabel,
          remainingBatchCount: remainingBatchLabel(),
          isHydrating: isHydrating(),
        },
      });
    }
    return loader.isConnected ? "next-batch" : "expanded";
  }

  return {
    observeChanges,

    identify(loader) {
      if (!loader.matches(replyBranch)) return loader;
      const comment = loader.closest(".comment");
      const id = comment?.getAttribute("data-id") || comment?.id;
      if (!id) return loader;

      // A re-render can replace the toggle for the same comment.
      const existing = replyIdentities.get(id);
      if (existing) return existing;
      const identity = {};
      replyIdentities.set(id, identity);
      return identity;
    },

    observeManualCollapses(onCollapse) {
      view.addEventListener(
        "click",
        (event) => {
          // Capture the expanded state before Pikabu's click handler changes it.
          if (!(event.target instanceof Element)) return;
          const close = event.target.closest(collapseControl);
          const loader =
            event.target.closest(replyBranch) ?? close?.parentElement?.previousElementSibling;
          if (
            loader instanceof HTMLElement &&
            loader.matches(replyBranch) &&
            !loader.classList.contains(collapseClass) &&
            currentContainer()?.contains(loader)
          ) {
            onCollapse(loader);
          }
        },
        { capture: true },
      );
    },

    read() {
      return {
        loadedCommentsCount: visibleElements(".comment").length,
        loaders: [
          ...visibleElements(collapsedReplyBranch),
          ...visibleElements(commentBatch),
        ].filter((element) => !element.matches(":disabled")),
        isHydrating: isHydrating(),
      };
    },

    async waitForHydration() {
      if (isHydrating() && !(await observeUntil(() => !isHydrating()))) {
        throw new Error("Pikabu comment hydration timed out.");
      }
    },

    expand(loader) {
      return loader.matches(collapsedReplyBranch)
        ? expandReplyBranch(loader)
        : expandCommentBatch(loader);
    },
  };
}
