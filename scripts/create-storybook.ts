#!/usr/bin/env bun

import {createStorybookPackage} from "@zavx0z/storybook/scaffold"

const options = parseArguments(Bun.argv.slice(2))
const result = await createStorybookPackage(options)
console.log(JSON.stringify(result, null, 2))

function parseArguments(args: readonly string[]): Readonly<{
  packageName: string
  directory: string
  title?: string
  ownerLabel?: string
  ownerHref?: string
}> {
  const [packageName, directory, ...rest] = args
  if (packageName === undefined || directory === undefined) usage()
  const values: Record<string, string> = {}
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index]
    const value = rest[index + 1]
    if (flag === undefined || value === undefined || !["--title", "--owner-label", "--owner-href"].includes(flag)) usage()
    if (values[flag] !== undefined) usage()
    values[flag] = value
  }
  return Object.freeze({
    packageName,
    directory,
    ...(values["--title"] === undefined ? {} : {title: values["--title"]}),
    ...(values["--owner-label"] === undefined ? {} : {ownerLabel: values["--owner-label"]}),
    ...(values["--owner-href"] === undefined ? {} : {ownerHref: values["--owner-href"]}),
  })
}

function usage(): never {
  throw new Error("Usage: create-storybook <@scope/storybook> <directory> [--title <text>] [--owner-label <text>] [--owner-href <url>]")
}
