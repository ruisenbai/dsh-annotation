/** Synchronous SHA-256 lets the browser and Host validate the same stored snapshot. */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { OfficialDiffSnapshot } from './annotation-source.ts'
import type { TextQuoteSelector } from './types.ts'

/** Hash exact source bytes or a canonical UTF-8 record. */
export function sha256Hex(value: string | Uint8Array): string {
  return bytesToHex(sha256(typeof value === 'string' ? new TextEncoder().encode(value) : value))
}

/** Bind the selected fragment and nearby context to the compact source record. */
export function quoteFragmentHash(quote: TextQuoteSelector): string {
  return sha256Hex(JSON.stringify([quote.exact, quote.prefix, quote.suffix, quote.start, quote.end]))
}

/** Hash every persisted official Diff field except the digest itself. */
export function officialDiffHash(snapshot: Omit<OfficialDiffSnapshot, 'hash'>): string {
  return sha256Hex(
    JSON.stringify({
      version: snapshot.version,
      sessionId: snapshot.sessionId,
      seq: snapshot.seq,
      turn: snapshot.turn,
      fileIndex: snapshot.fileIndex,
      path: snapshot.path,
      display: snapshot.display,
      kind: snapshot.kind,
      before: snapshot.before,
      after: snapshot.after,
      coarse: snapshot.coarse,
      hunks: snapshot.hunks.map((hunk) => ({
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        lines: hunk.lines,
      })),
    }),
  )
}
