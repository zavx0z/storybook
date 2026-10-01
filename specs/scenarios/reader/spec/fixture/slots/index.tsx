/** Панель с независимыми именованным и безымянным слотами для исполняемых примеров. */
export function SlotPanel(props: Readonly<{label: string}>) {
  return (
    <section aria-label={props.label}>
      <header data-heading="">
        <slot name="header" />
      </header>
      <main data-body="">
        <slot />
      </main>
    </section>
  )
}
