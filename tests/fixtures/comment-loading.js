// Synthetic Pikabu page behavior for the offline browser suite.
const container = document.querySelector(".comments__container");
const batch = container.querySelector(".comment__more");
const collapseClass = "comment-toggle-children_collapse";
const actions = [];
let nextBatch = 1;

function recordAction(action) {
  actions.push(action);
  container.dataset.actions = actions.join(" ");
}

async function loadComment(destination, before, action) {
  const comment = document.createElement("div");
  comment.className = "comment comment_loading-hidden";
  const body = document.createElement("div");
  body.className = "comment__body";
  comment.append(body);
  destination.insertBefore(comment, before);

  const response = await fetch("/ajax/comments_actions.php", { method: "POST", body: action });
  body.textContent = await response.text();
  const nextFloor = { branch: "next-floor-1", "next-floor-1": "next-floor-2" }[action];
  if (nextFloor) {
    comment.insertAdjacentHTML(
      "beforeend",
      `<button type="button" class="comment-toggle-children ${collapseClass} comment-toggle-children_next-floor" data-action="${nextFloor}">раскрыть ветку</button>`,
    );
    comment.insertAdjacentHTML(
      "beforeend",
      '<div class="comment__children comment__children_next-floor" hidden><div class="comment__collapsing-area"></div><div class="comment__close-branch">Закрыть ветку</div></div>',
    );
  }
  comment.classList.remove("comment_loading-hidden");
}

container.addEventListener("click", (event) => {
  const toggle = event.target.closest(".comment-toggle-children");
  const closeControl = event.target.closest(".comment__collapsing-area, .comment__close-branch");
  if (closeControl) {
    const children = closeControl.parentElement;
    const loader = children.previousElementSibling;
    recordAction(`collapse-${loader.dataset.action}`);
    loader.classList.add(collapseClass);
    children.hidden = true;
    return;
  }
  if (!toggle) return;
  event.preventDefault();
  const children = toggle.nextElementSibling;
  const collapsed = toggle.classList.contains(collapseClass);
  recordAction(collapsed ? toggle.dataset.action : `collapse-${toggle.dataset.action}`);
  toggle.classList.toggle(collapseClass, !collapsed);
  children.hidden = !collapsed;
  if (collapsed && !children.querySelector(".comment")) {
    void loadComment(children, null, toggle.dataset.action);
  }
});

batch.addEventListener("click", () => {
  const action = `batch-${nextBatch}`;
  recordAction(action);
  void loadComment(container, batch, action);
  if (nextBatch === 2) {
    batch.remove();
  } else {
    batch.querySelector(".comments__more-count").textContent = "1 комментарий";
  }
  nextBatch += 1;
});

for (const toggle of container.querySelectorAll(".spoiler, .comment__collapse")) {
  toggle.addEventListener("click", () => {
    recordAction("unrelated-toggle");
    toggle.nextElementSibling.hidden = !toggle.nextElementSibling.hidden;
  });
}
