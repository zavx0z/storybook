---
name: storybook
description: "Run, attach, check and verify the one external declaration-driven Storybook server and exact package tabs. Consumer projects own JSON declarations and stories, never Storybook packages or dependencies."
---

# External Storybook

Use the one dispatcher from this skill. Never copy it into a consumer, select a
port, start a package-local server or address an old `@scope/storybook` package.

Set `SKILL_ROOT` to the exact directory containing this file. The dispatcher
resolves the canonical external tool checkout:

```bash
"$SKILL_ROOT/scripts/storybook.sh" status
```

## Owner boundary

Consumer roots provide only `.storybook/manifest.json`, package
`catalog.json`, owner-owned stories/resources and optional plain
`storybook-runtime/1` adapters. They never install or import
`@zavx0z/storybook`, expose stories from production packages, own a Storybook
listener or choose a port.

The external tool owns the single process/origin, canonical graph, shared
six-region Workbench, independent PackageSessions, immutable revisions,
last-good diagnostics, WebSocket topics and browser tabs.

## Server and registry

Always run read-only `status` first. A stopped server may be started once with
one or more declaration/root paths. Preserve the foreground terminal session.

```bash
"$SKILL_ROOT/scripts/storybook.sh" serve /path/to/workspace /path/to/package
"$SKILL_ROOT/scripts/storybook.sh" attach /path/to/another-project
"$SKILL_ROOT/scripts/storybook.sh" detach project-id
"$SKILL_ROOT/scripts/storybook.sh" status
"$SKILL_ROOT/scripts/storybook.sh" stop
```

If the server already runs, `serve` attaches supplied roots and reuses it.
Attach is atomic; failure must leave the current graph and sessions unchanged.
Detach closes only the selected descendant sessions. Stop is global and must be
used only when the task actually authorizes stopping this exact server.

Workspace is optional. It is valid to attach workspace groups, standalone
projects and standalone packages simultaneously.

## Check and initialize

`check` resolves and compiles exact package sessions without creating a
consumer server. With no running server and a path scope it uses one bounded
transient external process and stops it afterward.

```bash
"$SKILL_ROOT/scripts/storybook.sh" check /path/to/project
"$SKILL_ROOT/scripts/storybook.sh" check @ui/components

"$SKILL_ROOT/scripts/storybook.sh" init packages/components --kind package --executable --stories
"$SKILL_ROOT/scripts/storybook.sh" init . --kind project
"$SKILL_ROOT/scripts/storybook.sh" init . --kind workspace
```

Init creates declarations, not `package.json`, `bunfig.toml`, server/build
wrappers, lifecycle scripts, dependencies or port configuration. It refuses an
existing `.storybook` directory.

## Landing and package tabs

Open from the landing action or request an exact package/route from the running
server:

```bash
"$SKILL_ROOT/scripts/storybook.sh" open @ui/components components/button/basic/contained
```

The landing client reuses named tab `storybook:<package-id>`. One package tab
equals one JS realm, one runtime instance and one independently updateable
session. Normal route navigation stays in place; successful package update
reloads only matching tabs and preserves pathname. Failure keeps last-good and
shows package diagnostics.

## Browser evidence

The browser helper derives the current origin and exact package URLs from the
running external server. It uses the canonical macOS Chrome service internally,
checks its health first and always targets a stable CDP `targetId`. It never
falls back to ambiguous AppleScript window/tab selection when several Chrome
profiles are running.

```bash
"$SKILL_ROOT/scripts/storybook.sh" browser targets landing
"$SKILL_ROOT/scripts/storybook.sh" browser open landing --activate

"$SKILL_ROOT/scripts/storybook.sh" browser targets @ui/components
"$SKILL_ROOT/scripts/storybook.sh" browser open @ui/components \
  --route components/button/basic/contained
"$SKILL_ROOT/scripts/storybook.sh" browser reload @ui/components \
  --route components/button/basic/contained --target-id WINDOW:TAB
"$SKILL_ROOT/scripts/storybook.sh" browser console @ui/components \
  --target-id WINDOW:TAB
"$SKILL_ROOT/scripts/storybook.sh" browser canvas @ui/components \
  --target-id WINDOW:TAB --output /tmp/ui-components.png
```

Run `targets` first and pass the exact target id when more than one matching
package tab exists. Browser evidence is route-specific: ready marker, exact
pathname/package id, console errors `0` and a non-empty DOM or canvas preview.
Automated capture remains evidence, not owner acceptance.

## Acceptance

Iterate with focused owner tests and external `check`, then verify the exact
live route. Preserve existing listeners, attached roots, unrelated tabs and
user WIP. Build/check/browser actions never authorize commit, push, workflow,
Pages deployment, reference capture or MCP changes.
