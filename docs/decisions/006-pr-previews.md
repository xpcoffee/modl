# 006: Each pull request publishes a preview to GitHub Pages

**Status**: accepted · **Date**: 2026-08-03

## Context

Reviewing a whiteboard from a diff does not work. The reviewer needs to click the thing. Asking them to pull the branch and run it locally is friction that turns into "looks fine".

The constraint was to use the repo's own GitHub infrastructure rather than an external hosting service.

## Decision

Two workflows, first-party actions only.

`verify.yml` runs typecheck, unit tests, and the browser suite on every pull request and on pushes to `main`, uploading the Playwright report when it fails.

`pr-preview.yml` builds the PR and publishes it to this repository's GitHub Pages site under `/pr-<number>/`, then keeps a single comment on the PR pointing at it. Closing the PR deletes the directory.

## How it works

GitHub Pages serves one site per repository. Per-PR previews come from putting each build in its own directory on the branch Pages serves.

1. **Build.** `actions/checkout` and `actions/setup-node` (reading `.nvmrc`), then `npm ci` and `npm run build`. Vite's `base` comes from `BASE_PATH`, set to `/modl/pr-<number>/`, so the built asset URLs resolve under the subdirectory rather than the domain root.
2. **Publish.** The job adds a `git worktree` for the `gh-pages` branch, creating it as an orphan the first time, copies `packages/app/dist` into `pr-<number>/`, and pushes. A worktree keeps the source checkout untouched, so the build and the publish do not interfere.
3. **Link.** A step queries the PR's comments for one starting with an HTML marker, then edits it or posts a new one. Editing keeps a push from stacking up comments.
4. **Clean up.** The `closed` event removes the directory and pushes again.

Repository settings: Pages is configured to serve the `gh-pages` branch from `/`. The workflow needs `contents: write` to push the branch and `pull-requests: write` to comment. `concurrency` is keyed by PR number so two pushes cannot race on the same branch.

## Consequences

A pull request from a fork gets a read-only `GITHUB_TOKEN`, so the preview step fails there. Fine for branches on this repository.

Preview builds accumulate on `gh-pages` until their PR closes.

The preview is a static page with no server, which is what the app is anyway.

## Rejected

**A third-party preview service.** Another account, another secret, and the requirement was to stay on GitHub.

**`actions/upload-pages-artifact` with `actions/deploy-pages`.** The official pair deploys one site per run, replacing what is there. Per-PR directories need the branch.

**Building on `main` only.** The reviewer is the person who needs to click it.

## What would reverse this

Wanting previews on fork PRs, which needs `pull_request_target` and the care that comes with running workflows against untrusted code.

## Amended by #8: the permanent site

Pushes to `main` now deploy to the root of the same Pages site (`deploy-main.yml`), so the latest main is always at the bare project URL. The root replace skips the `pr-<number>/` directories, and the previews never touch the root, so the two coexist on one branch. A merge fires the main deploy and the preview cleanup in the same instant and both push `gh-pages`; the main deploy rebases and retries rather than failing on the race.
