---
name: storybook
description: "Create, launch, restart, build, and verify any repository-owned @scope/storybook package by its exact package name. Use for shared Storybook lifecycle, routes, Workbench, browser evidence, or create-storybook scaffolding; product runtimes remain outside."
---

# Storybook

Use the exact `package.json#name` as the only Storybook identity. Accept names
of the form `@scope/storybook`; never introduce selectors, aliases, port tables,
consumer lifecycle registries, or per-repository copies of this skill.

The package owns its app, pages, stories, preview, fixtures, lab state, static
output and acceptance. `@zavx0z/storybook` owns the shared router, Workbench,
server, Blender-backed shell colors, build, package launcher, automatic port
handshake and scaffold. Consumer CSS may style story content and geometry but
must not set `html`, `body`, root or canvas shell background colors.

## Locate the canonical tools

Set `SKILL_ROOT` to the directory containing this `SKILL.md`, using the exact
path shown by Codex. The one dispatcher resolves its physical source checkout:

```bash
"$SKILL_ROOT/scripts/storybook.sh" status @ui/storybook
```

Do not guess another checkout or copy a tool into the consumer.

## Package lifecycle

Run read-only `status` before the first lifecycle action. Supply the consumer
repository through `--root` only when it is not the current Git repository.

```bash
"$SKILL_ROOT/scripts/storybook.sh" status  @ui/storybook
"$SKILL_ROOT/scripts/storybook.sh" ensure  @ui/storybook
"$SKILL_ROOT/scripts/storybook.sh" restart @ui/storybook
"$SKILL_ROOT/scripts/storybook.sh" stop    @ui/storybook
"$SKILL_ROOT/scripts/storybook.sh" build   @ui/storybook
"$SKILL_ROOT/scripts/storybook.sh" check   @ui/storybook
```

The first `start` or stopped `ensure` opens and activates one exact package
route in Chrome after readiness. The dispatcher records that package target;
`restart` preserves its exact registered pathname while navigating the same tab
to the new automatic-port origin in the background, and must not activate
Chrome or take OS focus. A repeated `ensure` reuses both the running package and
its tab. Use `--no-open` only for an
explicitly internal server-only launch. These commands may remain the foreground
owner of the exact package child; preserve the returned terminal session. The
launcher requests port `0`; the operating system allocates the port and the
package publishes its origin through the runtime protocol. Never choose,
reserve, scan, document, or kill by port.

Status and stop validate package name, checkout realpath, PID, process start,
cwd and HTTP health. A foreign or ambiguous process is a hard stop, not a retry
or adoption signal. An explicit exact stop/restart may terminate only the
recorded child; no SIGKILL escalation is automatic.

After a stable applicable source checkpoint, restart the exact package once
and reload only the routes needed for evidence. Preserve unrelated listeners
and browser targets. Unknown routes fail closed; overview routes end in `/`
and exact leaves do not.

Every registered overview owns a real presentation inside the same Workbench.
A primary overview shows common information and all secondary items with no
secondary or dock selection; a secondary overview shows all variants with no
exact variant selected. Never render the first descendant leaf as hidden
overview content. A `representative` may seed explicit initial selection, but
it does not replace an overview's module, source, controls or readiness state.

## Background browser evidence

The same package name resolves the runtime origin and typed page manifest. Run
`targets` first; open a target only when none exists, and pass an exact target
id whenever more than one package-origin target exists.

```bash
"$SKILL_ROOT/scripts/storybook.sh" browser targets @ui/storybook
"$SKILL_ROOT/scripts/storybook.sh" browser open @ui/storybook --activate
"$SKILL_ROOT/scripts/storybook.sh" browser reload @ui/storybook \
  --route /components/button/basic/contained --target-id "$target_id"
"$SKILL_ROOT/scripts/storybook.sh" browser canvas @ui/storybook \
  --route /components/button/basic/contained --target-id "$target_id" \
  --output /tmp/ui-button.png
```

The browser helper reads origin, routes, readiness, canvas and touch from the
running package. It never reads a consumer registry or port. It serializes
target creation and exact-target operations, enables background frame
scheduling through the owner ready marker and one following presented-frame
boundary, then restores emulation during cleanup. `--activate` selects the exact
tab inside Chrome without taking OS focus from another application.

## Create a package

For a new owner boundary, generate the whole package from the one maintained
template:

```bash
"$SKILL_ROOT/scripts/storybook.sh" create \
  @quantum/storybook quantum/storybook
```

The target must not exist. Never use the generator to update, merge, or adopt
an existing Storybook. Generated packages include the canonical scripts,
typed app, automatic-port server, static build, consumer-owned page, stories,
preview, fixtures, lab state, lazy starter story, shared Workbench and focused
test.

## Acceptance

Run the package's focused tests and typecheck while iterating, then its exact
`check` script. Browser evidence is route-specific: readiness plus console 0
and DOM, SVG, or non-black exact canvas according to the app manifest. Automated
captures remain evidence candidates, not owner acceptance.

Production packages never import Storybook. Import exact lowercase
`@zavx0z/storybook/*` owners in private Storybook packages; do not add root
barrels, aliases, wrappers, generated shared-source copies, or compatibility
re-exports. Build and verification never authorize push, Pages deployment, or
workflow dispatch.
