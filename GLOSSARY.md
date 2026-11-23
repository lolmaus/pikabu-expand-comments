# Pikabu Expand Comments

A tool that automatically expands all unloaded comments on Pikabu.ru post pages so readers can view and search the full discussion without repeated manual clicking.

## Language

**Post Page**:
A desktop or mobile Pikabu.ru story page hosting a post and its comment tree.
_Avoid_: Story page, article, thread page

**Comment Batch**:
A page of unloaded top-level comments revealed by a pagination loader at the end of the comment list.
_Avoid_: Chunk, group, page

**Reply Branch**:
A nested sub-tree of unloaded replies to a comment, revealed by a branch-loader control.
_Avoid_: Sub-thread, child comments, nested batch

**Expansion Run**:
A single active pass that repeatedly triggers Comment Batch and Reply Branch loaders until no unloaded comments remain or the run is stopped.
_Avoid_: Crawl, job, loop, session

**Auto-Expand on Visit**:
The user preference that starts an Expansion Run automatically upon opening a Post Page, rather than waiting for a manual trigger.
_Avoid_: Autoload, zero-click flag
