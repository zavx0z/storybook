import type {StorybookProxyInput} from "../../index"

export interface ProxyStep {
  readonly reply?: Record<string, unknown>
  readonly body?: string
  readonly httpStatus?: number
  readonly abort?: boolean
  readonly switchServer?: boolean
}

/** Изолированный HTTP-стенд не меняет запись действующего Storybook и не регистрирует тесты. */
export async function exerciseProxy(steps: readonly ProxyStep[], request: StorybookProxyInput = {node: "example", input: {future: {enabled: true}}}) {
  const child = Bun.spawn([process.execPath, new URL("./worker.ts", import.meta.url).pathname], {
    stdin: new Blob([JSON.stringify({steps, request})]), stdout: "pipe", stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (exitCode !== 0) throw new Error(stderr)
  return JSON.parse(stdout) as {
    replies: Record<string, unknown>[]
    errors: {name: string, message: string}[]
    requests: {input: StorybookProxyInput, path: string, authorized: boolean, server: number}[]
  }
}
