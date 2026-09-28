import type { AnnotationSubmissionPayload } from './types.ts'

/** Encode one immutable payload into the internal command's base64url argument. */
export function encodeSubmissionCommand(commandName: string, payload: AnnotationSubmissionPayload): string {
  return encodeJsonCommand(commandName, payload)
}

/** Encode a plugin-owned JSON request without relying on the current page DOM. */
export function encodeJsonCommand(commandName: string, value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  const encoded = btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
  return `/${commandName} ${encoded}`
}
