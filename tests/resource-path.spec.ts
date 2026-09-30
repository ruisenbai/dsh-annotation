import { describe, expect, it } from 'vitest'
import {
  isAbsoluteResourcePath,
  parseFileResourceAddress,
  sameAbsoluteResourcePath,
  sameResourceAddress,
} from '../src/shared/resource-path.ts'

describe('file resource addresses', () => {
  it.each([
    [
      'dsh-resource://file/session/s%2F1/dir/../a%3Fb%23c%25.txt?download=1#section',
      { scope: 'session', sessionId: 's/1', path: 'dir/../a?b#c%.txt' },
    ],
    ['dsh-resource://file/session/s/', { scope: 'session', sessionId: 's', path: '' }],
    ['dsh-resource://file/absolute/home/me/notes.md', { scope: 'absolute', path: '/home/me/notes.md' }],
    ['dsh-resource://file/absolute/C:/w/x.ts', { scope: 'absolute', path: 'C:/w/x.ts' }],
    ['dsh-resource://file/absolute//server/share/x.ts', { scope: 'absolute', path: '//server/share/x.ts' }],
  ])('parses the official address grammar for %s', (address, parsed) => {
    expect(parseFileResourceAddress(address)).toEqual(parsed)
  })

  it.each([
    'dsh-resource://terminal/session/s/1',
    'dsh-resource://File/session/s/w/x.ts',
    'DSH-RESOURCE://file/session/s/w/x.ts',
    'dsh-resource://file/shared/s/w/x.ts',
    'dsh-resource://file/session/s',
    'dsh-resource://file/session//a.txt',
    'dsh-resource://file/absolute',
    'dsh-resource://file/absolute/',
    'dsh-resource://file/absolute//',
    'dsh-resource://file/session/s/%E0%A4%A',
  ])('rejects the invalid address %s', (address) => {
    expect(parseFileResourceAddress(address)).toBeUndefined()
  })

  it('matches the decoded Session and path without resolving relative segments', () => {
    expect(
      sameResourceAddress(
        'dsh-resource://file/session/s%201/dir/../notes%20one.md',
        's 1',
        'dir/../notes one.md',
      ),
    ).toBe(true)
    expect(sameResourceAddress('dsh-resource://file/session/s%202/notes.md', 's 1', 'notes.md')).toBe(false)
    expect(sameResourceAddress('dsh-resource://file/session/s%201/other.md', 's 1', 'notes.md')).toBe(false)
  })

  it('recognizes POSIX, Windows drive, and UNC absolute paths', () => {
    expect(isAbsoluteResourcePath('/workspace/a.ts')).toBe(true)
    expect(isAbsoluteResourcePath('C:\\workspace\\a.ts')).toBe(true)
    expect(isAbsoluteResourcePath('\\\\server\\share\\a.ts')).toBe(true)
    expect(isAbsoluteResourcePath('../workspace/a.ts')).toBe(false)
  })

  it('normalizes separators but preserves exact case for absolute identity', () => {
    expect(sameAbsoluteResourcePath('C:\\Workspace\\a.ts', 'C:/Workspace/a.ts')).toBe(true)
    expect(sameAbsoluteResourcePath('C:/Workspace/a.ts', 'c:/Workspace/a.ts')).toBe(false)
    expect(sameAbsoluteResourcePath('/Workspace/a.ts', '/workspace/a.ts')).toBe(false)
    expect(sameAbsoluteResourcePath('workspace/a.ts', '/workspace/a.ts')).toBe(false)
  })
})
