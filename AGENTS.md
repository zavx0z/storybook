# @zavx0z/storybook agent rules

## Workspace boundary

- The canonical primary checkout is `/Users/zavx0z/repozitarium/storybook`.
- Related canonical checkouts are `/Users/zavx0z/repozitarium/engine`,
  `/Users/zavx0z/repozitarium/layout`, `/Users/zavx0z/repozitarium/ui`,
  `/Users/zavx0z/repozitarium/node`, and
  `/Users/zavx0z/repozitarium/metafor`.
- Never use `/Users/zavx0z/production` or another archival checkout.
- Preserve every supplied branch, dirty worktree, listener, browser target, and
  unrelated file. Do not create branches, clones, or worktrees without a new
  explicit owner request.

## Architecture process

- Start read-only. Before implementation, audit every existing Storybook and
  present one evidence-backed owner law and a staged migration plan.
- Node is a comparison candidate, not an assumed reference implementation.
- `@zavx0z/storybook` is shared dev infrastructure. It does not become a
  central owner of other repositories' stories.
- A repository or package with a real catalog/lifecycle/delivery boundary owns
  its own stories, preview state, routes, process, static build, and acceptance.
- Production packages never import Storybook. Storybook dependencies remain in
  private development applications or explicit dev-only boundaries.
- Import exact owners directly. Do not add compatibility aliases, `paths`,
  wrappers, root barrels, generated copies, or compatibility re-exports.
- Preserve one resolved identity for Engine, Layout, UI, and other linked
  packages in every browser bundle.

## Delivery safety

- Do not push, create a pull request, deploy Pages, dispatch workflows, or
  create a GitHub repository without a separate explicit owner request.
- Do not stop an existing Storybook merely to inspect it. Resolve exact process
  ownership first and preserve the UI Storybook at port 4017 through migration
  until an approved cutover can leave its replacement running.
- Automated captures are evidence candidates, not owner acceptance.
- TypeScript and JavaScript changes use no trailing semicolons unless syntax
  requires one.
