# Versioning, builds, and commits

- Never bump the version in `package.json` manually; Release Please manages version bumps and `CHANGELOG.md` from Conventional Commits.
- When handing off the userscript for manual testing, rebuild with `pnpm run build` and report the emitted `@build` timestamp from `dist/userscript/pikabu-expand-comments.meta.js`.
- Write clear, user-facing `feat:` and `fix:` commit subjects because they populate the public changelog. Use `refactor:`, `test:`, `chore:`, `ci:`, or `docs:` for internal work that should not appear in user-facing release notes.
