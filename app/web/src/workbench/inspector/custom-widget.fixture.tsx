export function CustomWorkbenchWidget(props: Readonly<{value: unknown}>) {
  return <article
    data-custom-workbench-widget=""
    style={css`
      display: block;
      width: 100%;
      min-height: 24px;
    `}
  >
    {String(props.value)}
  </article>
}
