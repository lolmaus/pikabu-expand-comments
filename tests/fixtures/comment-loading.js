// Synthetic Pikabu page behavior for the offline browser suite.
const container = document.querySelector(".comments__container");
const branch = container.querySelector(".comment-toggle-children");
const batch = container.querySelector(".comment__more");
let nextBatch = 1;

async function loadComment(destination, before, action) {
  const comment = document.createElement("div");
  comment.className = "comment comment_loading-hidden";
  const body = document.createElement("div");
  body.className = "comment__body";
  comment.append(body);
  destination.insertBefore(comment, before);

  const response = await fetch("/ajax/comments_actions.php", { method: "POST", body: action });
  body.textContent = await response.text();
  comment.classList.remove("comment_loading-hidden");
}

branch?.addEventListener("click", (event) => {
  event.preventDefault();
  branch.classList.remove("comment-toggle-children_collapse");
  const children = container.querySelector(".comment__children");
  children.hidden = false;
  void loadComment(children, null, "branch");
});

batch?.addEventListener("click", () => {
  void loadComment(container, batch, `batch-${nextBatch}`);
  if (nextBatch === 2) {
    batch.remove();
  } else {
    batch.querySelector(".comments__more-count").textContent = "1 комментарий";
  }
  nextBatch += 1;
});
