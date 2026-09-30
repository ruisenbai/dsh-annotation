/** File resource-address parsing and Host-resolved path identity checks. */

/** Parsed `dsh-resource://file/…` address. */
export type FileResourceAddress =
  | { readonly scope: 'session'; readonly sessionId: string; readonly path: string }
  | { readonly scope: 'absolute'; readonly path: string }

const FILE_ADDRESS_PREFIX = 'dsh-resource://file/'
const WINDOWS_ABSOLUTE = /^[A-Za-z]:\//u

function isDriveSegment(segment: string | undefined): boolean {
  return segment !== undefined && /^[A-Za-z]:$/u.test(segment)
}

/** Parse the official file-address grammar without resolving filesystem paths. */
export function parseFileResourceAddress(address: string): FileResourceAddress | undefined {
  try {
    if (!address.startsWith(FILE_ADDRESS_PREFIX)) return undefined
    const end = address.search(/[?#]/u)
    const [scope, ...rest] = address
      .slice(FILE_ADDRESS_PREFIX.length, end === -1 ? undefined : end)
      .split('/')
    if (scope === 'session') {
      const [id, ...segments] = rest
      if (id === undefined || id === '' || segments.length === 0) return undefined
      return {
        scope,
        sessionId: decodeURIComponent(id),
        path: segments.map(decodeURIComponent).join('/'),
      }
    }
    if (scope === 'absolute') {
      const unc = rest[0] === '' && rest.length > 1
      const segments = (unc ? rest.slice(1) : rest).map(decodeURIComponent)
      if (segments.length === 0 || segments[0] === '') return undefined
      if (unc) return { scope, path: `//${segments.join('/')}` }
      return { scope, path: isDriveSegment(segments[0]) ? segments.join('/') : `/${segments.join('/')}` }
    }
    return undefined
  } catch {
    return undefined
  }
}

function slashPath(path: string): string {
  return path.replace(/\\/gu, '/')
}

/** Whether a stored path is absolute in either supported execution-world syntax. */
export function isAbsoluteResourcePath(path: string): boolean {
  const normalized = slashPath(path)
  return normalized.startsWith('/') || WINDOWS_ABSOLUTE.test(normalized)
}

/** Compare a stored absolute path with the exact path resolved by the Host. */
export function sameAbsoluteResourcePath(declared: string, resolved: string): boolean {
  const left = slashPath(declared)
  const right = slashPath(resolved)
  if (!isAbsoluteResourcePath(left) || !isAbsoluteResourcePath(right)) return false
  return left === right
}

/** Whether a saved resource address exactly names the stored Session request. */
export function sameResourceAddress(address: string, sessionId: string, path: string): boolean {
  const parsed = parseFileResourceAddress(address)
  return parsed?.scope === 'session' && parsed.sessionId === sessionId && parsed.path === path
}
