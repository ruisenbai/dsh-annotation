import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconEditOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { DocumentContent } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import { digest, parseResourceAddress } from '../document-integration.tsx'
import { fileSource } from '../official-adapters.ts'
import type { FileAnnotationSource } from '../../shared/annotation-source.ts'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionIdentity } from '../../shared/types.ts'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

type Props = PropsRuntime<'sidebar.right.tab.document.action'> & PropsLocale<'dshAnnotation'>

/** Complete file bytes returned by the official workspace-files Remote. */
export type ReadFileSnapshot = (
  sessionId: SessionIdentity,
  path: string,
  signal: AbortSignal,
  range?: { readonly offset: number; readonly length: number },
) => Promise<{
  readonly ok: boolean
  readonly value?: {
    readonly absolutePath: string
    readonly version: string
    readonly bytes?: number
    readonly data: Uint8Array
    readonly offset: number
    readonly eof: boolean
  }
}>

/** Hash a large whole-file source through bounded same-version byte windows. */
export async function readFileBytesDigest(
  sessionId: SessionIdentity,
  path: string,
  readFile: ReadFileSnapshot,
  signal: AbortSignal,
): Promise<
  | { readonly absolutePath: string; readonly version: string; readonly bytes: number; readonly hash: string }
  | undefined
> {
  const chunkSize = 1024 * 1024
  const digest = sha256.create()
  let offset = 0
  let version: string | undefined
  let absolutePath: string | undefined
  let declaredBytes: number | undefined
  while (!signal.aborted) {
    const response = await readFile(sessionId, path, signal, { offset, length: chunkSize })
    const value = response.value
    if (
      !response.ok ||
      value === undefined ||
      value.offset !== offset ||
      (version !== undefined && value.version !== version) ||
      (absolutePath !== undefined && value.absolutePath !== absolutePath) ||
      (declaredBytes !== undefined && value.bytes !== declaredBytes) ||
      (value.data.length === 0 && !value.eof)
    )
      return undefined
    version = value.version
    absolutePath = value.absolutePath
    declaredBytes = value.bytes
    digest.update(value.data)
    offset += value.data.length
    if (value.eof) {
      if (declaredBytes !== undefined && declaredBytes !== offset) return undefined
      return { absolutePath, version, bytes: offset, hash: bytesToHex(digest.digest()) }
    }
  }
  return undefined
}

/** Same-version line page used to validate text already shown by the Host. */
export type ReadFilePage = (
  sessionId: SessionIdentity,
  path: string,
  offset: number,
  limit: number,
  signal: AbortSignal,
) => Promise<{
  readonly ok: boolean
  readonly value?: {
    readonly version: string
    readonly bytes?: number
    readonly offset: number
    readonly text: string
    readonly lines: number
    readonly eof: boolean
  }
}>

function sourceFormat(content: DocumentContent, root: HTMLElement | undefined): string {
  const renderer = root?.dataset.documentPreview
  if (renderer !== undefined) return renderer.slice(renderer.lastIndexOf('/') + 1)
  return content.kind === 'text' ? 'text' : content.kind === 'bytes' ? 'binary' : 'renderer'
}

type OfficeProps = PropsRuntime<'sidebar.right.tab.document.actions'> & PropsLocale<'dshAnnotation'>

function displayedRoot(address: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[data-textpreview-url]')].find(
    (element) => element.dataset.textpreviewUrl === address,
  )
}

/** Keep a toolbar action disabled until a complete official read matches the displayed version. */
export async function createSource(
  content: DocumentContent,
  address: string,
  observedVersion: string | undefined,
  readFile: ReadFileSnapshot,
  signal: AbortSignal,
  entry: 'sidebar',
  readPage?: ReadFilePage,
): Promise<FileAnnotationSource | undefined> {
  const parsed = parseResourceAddress(address)
  if (parsed === undefined || observedVersion === undefined) return undefined
  const root = displayedRoot(address)
  const format = sourceFormat(content, root)
  if (content.kind === 'text' && readPage !== undefined) {
    if (
      content.pages.length === 0 ||
      content.text !==
        content.pages
          .filter((page) => page.lines > 0)
          .map((page) => page.text)
          .join('\n')
    )
      return undefined
    let bytes: number | undefined
    for (const page of content.pages) {
      const checked = await readPage(
        parsed.sessionId,
        parsed.path,
        page.offset,
        Math.max(1, page.lines),
        signal,
      )
      const value = checked.value
      if (
        !checked.ok ||
        value === undefined ||
        signal.aborted ||
        value.version !== observedVersion ||
        value.offset !== page.offset ||
        value.text !== page.text ||
        value.lines !== page.lines ||
        (bytes !== undefined && value.bytes !== bytes)
      )
        return undefined
      bytes = value.bytes
    }
    if (bytes === undefined) return undefined
    return fileSource(
      {
        sessionId: parsed.sessionId,
        resourceAddress: address,
        path: parsed.path,
        resourceVersion: observedVersion,
        format,
        hash: await digest(`file-revision-v2\0${observedVersion}\0${bytes}\0${parsed.path}`),
        bytes,
        text: content.text,
        pages: content.pages,
      },
      entry,
      true,
    )
  }
  if (content.kind === 'text' && !content.eof) return undefined
  const result = await readFile(parsed.sessionId, parsed.path, signal)
  if (!result.ok || result.value === undefined) return undefined
  const { version, bytes, data, offset, eof } = result.value
  if (
    signal.aborted ||
    version !== observedVersion ||
    offset !== 0 ||
    !eof ||
    (bytes !== undefined && bytes !== data.byteLength)
  )
    return undefined
  if (content.kind === 'bytes' && !equalBytes(data, content.data)) return undefined
  const rawText = content.kind === 'text' ? new TextDecoder('utf-8', { fatal: true }).decode(data) : undefined
  if (content.kind === 'text' && rawText !== content.text && rawText !== `${content.text}\n`) return undefined
  return fileSource(
    {
      sessionId: parsed.sessionId,
      resourceAddress: address,
      path: parsed.path,
      resourceVersion: version,
      format,
      hash: await digest(data),
      bytes: data.byteLength,
      ...(rawText === undefined ? {} : { text: rawText }),
    },
    entry,
    true,
  )
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/**
 * Render the whole-file action from the public document action slot.
 * @param props - renderer content, tab navigation, localized copy, and the annotation callback.
 * @returns the action button once the complete preview revision is available.
 */
export function FileWholeAnnotationAction(
  beginFileAnnotation: (source: FileAnnotationSource, rect: DOMRect) => void,
  readFile: ReadFileSnapshot,
  registerFileSource?: (source: FileAnnotationSource) => () => void,
  readPage?: ReadFilePage,
): (props: Props) => ReactNode {
  return function FileWholeAnnotationActionBody({ content, useTabInfo, useResource, t }: Props): ReactNode {
    const { tab } = useTabInfo()
    const address = tab.contentId
    const resource = useResource<'file'>(address)
    const observedVersion = resource.value?.version
    const [source, setSource] = useState<FileAnnotationSource | undefined>()
    const [availability, setAvailability] = useState<'loading' | 'unavailable' | 'ready'>('loading')
    useEffect(() => {
      let live = true
      const abort = new AbortController()
      tab.signal.addEventListener('abort', () => abort.abort(), { once: true, signal: abort.signal })
      let unregister: (() => void) | undefined
      setSource(undefined)
      setAvailability('loading')
      void createSource(content, address, observedVersion, readFile, abort.signal, 'sidebar', readPage)
        .then((next) => {
          if (!live || abort.signal.aborted) return
          setSource(next)
          setAvailability(next === undefined ? 'unavailable' : 'ready')
          if (next !== undefined && registerFileSource !== undefined) unregister = registerFileSource(next)
        })
        .catch(() => {
          if (live) {
            setSource(undefined)
            setAvailability('unavailable')
          }
        })
      return () => {
        live = false
        abort.abort()
        unregister?.()
      }
    }, [content, address, observedVersion, readFile, readPage, registerFileSource, tab.signal])
    const label = t('selection.annotateOfficial')
    const unavailable = t(availability === 'loading' ? 'source.loading' : 'source.unavailable')
    return (
      <>
        <button
          type="button"
          className="dia-official-file-action"
          aria-label={source === undefined ? unavailable : label}
          title={source === undefined ? unavailable : label}
          disabled={source === undefined}
          data-official-file-annotate=""
          onClick={(event) => {
            if (source === undefined) return
            beginFileAnnotation(source, event.currentTarget.getBoundingClientRect())
          }}
        >
          <IconEditOutlineRegular size={15} />
        </button>
        {availability === 'unavailable' && (
          <span className="dia-official-file-state" role="status">
            {unavailable}
          </span>
        )}
      </>
    )
  }
}

/** The Host's Office renderer owns the keyed toolbar slot, so this action uses its public list slot. */
export function OfficeWholeAnnotationAction(
  beginFileAnnotation: (source: FileAnnotationSource, rect: DOMRect) => void,
  readFile: ReadFileSnapshot,
  registerFileSource: (source: FileAnnotationSource) => () => void,
): (props: OfficeProps) => ReactNode {
  return function OfficeWholeAnnotationActionBody({ absolutePath, t }: OfficeProps): ReactNode {
    const button = useRef<HTMLButtonElement>(null)
    const [address, setAddress] = useState<string>()
    const [source, setSource] = useState<FileAnnotationSource>()
    const [availability, setAvailability] = useState<'loading' | 'unavailable' | 'ready'>('loading')
    useEffect(() => {
      const root = button.current?.closest<HTMLElement>('[data-textpreview-url]')
      setAddress(root?.dataset.documentPreview?.endsWith('/office') ? root.dataset.textpreviewUrl : undefined)
    }, [absolutePath])
    useEffect(() => {
      if (address === undefined) return
      const parsed = parseResourceAddress(address)
      if (parsed === undefined) return
      const abort = new AbortController()
      let live = true
      let unregister: (() => void) | undefined
      setSource(undefined)
      setAvailability('loading')
      void readFileBytesDigest(parsed.sessionId, parsed.path, readFile, abort.signal)
        .then((file) => {
          if (file === undefined || file.absolutePath !== absolutePath || abort.signal.aborted) {
            if (live) setAvailability('unavailable')
            return
          }
          const next = fileSource(
            {
              sessionId: parsed.sessionId,
              resourceAddress: address,
              path: parsed.path,
              resourceVersion: file.version,
              format: 'office',
              hash: file.hash,
              bytes: file.bytes,
            },
            'sidebar',
            true,
          )
          if (!live || abort.signal.aborted) return
          setSource(next)
          setAvailability('ready')
          unregister = registerFileSource(next)
        })
        .catch(() => {
          if (live) setAvailability('unavailable')
        })
      return () => {
        live = false
        abort.abort()
        unregister?.()
      }
    }, [address, absolutePath, readFile, registerFileSource])
    const label = t('selection.annotateOfficial')
    const unavailable = t(availability === 'loading' ? 'source.loading' : 'source.unavailable')
    return (
      <button
        ref={button}
        type="button"
        className="dia-official-file-action"
        aria-label={source === undefined ? unavailable : label}
        title={source === undefined ? unavailable : label}
        disabled={source === undefined}
        data-official-file-annotate=""
        hidden={address === undefined}
        onClick={(event) => {
          if (source !== undefined) beginFileAnnotation(source, event.currentTarget.getBoundingClientRect())
        }}
      >
        <IconEditOutlineRegular size={15} />
      </button>
    )
  }
}
