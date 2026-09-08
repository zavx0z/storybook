---
name: storybook
description: "Use the Storybook MCP as the only agent interface for the one external declaration-driven Storybook server, graph, package views, inspection, interaction, and capture."
---

# Storybook MCP workflow

1. Use only `storybook_*` MCP tools. Do not call Storybook shell scripts, CLI,
   browser eval, Chrome/CDP identities, ports, coordinates, or PNG paths.
2. Start with `storybook_status`; use `storybook_ensure` when the canonical
   server or required declarations are absent.
3. Find the exact package/category/subject/variant through `storybook_search`,
   then open its exact route with `storybook_open`. It reuses a tab currently on
   that package or opens a background tab without disturbing other packages.
4. After source changes, build with `storybook_check(live:false)`. Open and
   inspect the candidate, then explicitly apply with `storybook_check(live:true)`
   and use `storybook_wait` for active. Only successful application updates every
   tab of that package. Never force a manual reload. If the user navigates away,
   reopen the package through MCP instead of acting on the old view handle.
5. Use `storybook_inspect` for state, diagnostics, console, semantic, layout,
   display and canvas evidence. Use stable semantic node IDs or exact
   role+name, never raw coordinates.
6. Use `storybook_interact` for hover/focus/click/key/type/wheel/scenario state.
7. Use `storybook_capture` for page/Workbench/preview/canvas/node PNG evidence.
   A capture is not an accepted Blender reference or visual baseline.
8. Do not call `storybook_detach` or `storybook_stop` unless the task explicitly
   requires that destructive action. `storybook_stop` always needs confirmation.
9. Never change another package to bypass the package that failed. Preserve its
   lastWorking revision and report its scoped diagnostics.
10. If inspection or interaction reports a missing platform capability, record
    the exact behavior and owner. Do not patch DOM, Renderer, TSX, Engine, UI,
    Node, or MetaFor from Storybook as a workaround.
