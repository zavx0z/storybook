/** @jsxImportSource @zavx0z/template */

export function FixtureControlsWidget(props: Readonly<{value: unknown}>) {
  return <section aria-label="Fixture controls">{String(props.value ?? "")}</section>
}
