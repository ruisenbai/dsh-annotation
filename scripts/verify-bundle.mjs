import { access, readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const expectedDshVersion = '0.1.2-rc.1'
if (manifest.engines?.dsh !== expectedDshVersion) {
  throw new Error(`package.json engines.dsh must be ${expectedDshVersion}`)
}
const platformModules = JSON.parse(await readFile(new URL('client-platform.json', root), 'utf8'))
const expectedPlatformModules = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]
if (JSON.stringify(platformModules) !== JSON.stringify(expectedPlatformModules)) {
  throw new Error('client-platform.json does not match the DSH 0.1.2-rc.1 platform modules')
}
for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
  if (manifest.devDependencies?.[name] !== range) {
    throw new Error(`peer and development ranges differ for ${name}`)
  }
  if (name.startsWith('@deepseek-ai/dsh-') && range !== expectedDshVersion) {
    throw new Error(`lockstep DSH peer ${name} must match engines.dsh`)
  }
}
const required = [
  'lib/index.js',
  'lib/invariant.js',
  'lib/client.js',
  'lib/types/index.d.ts',
  'lib/types/client/index.d.ts',
  'cordis.patch.yml',
  'screenshots.json',
]
await Promise.all(required.map((path) => access(new URL(path, root))))

const screenshots = JSON.parse(await readFile(new URL('screenshots.json', root), 'utf8'))
if (
  !Array.isArray(screenshots) ||
  screenshots.length < 1 ||
  screenshots.length > 8 ||
  screenshots.some(
    (path) => typeof path !== 'string' || path.startsWith('/') || path.split('/').includes('..'),
  )
) {
  throw new Error('screenshots.json must list 1-8 repository-relative image paths')
}
await Promise.all(screenshots.map((path) => access(new URL(path, root))))

const client = await readFile(new URL('lib/client.js', root), 'utf8')
if (
  !client.startsWith('window.__ModuleLoader__.load({') ||
  !client.includes(`id: ${JSON.stringify(manifest.name)}`)
) {
  throw new Error('client bundle does not register with the DSH module loader')
}
const declaredExternals = manifest.dsh?.client?.external ?? []
if (!Array.isArray(declaredExternals) || declaredExternals.some((value) => typeof value !== 'string')) {
  throw new Error('package.json dsh.client.external must be an array of module specifiers')
}
const requests = new Set(
  [...client.matchAll(/\brequire\(\s*(['"])([^'"]+)\1\s*\)/g)].map((match) => match[2]),
)
const allowedRequests = new Set([...platformModules, ...declaredExternals])
const undeclaredRequests = [...requests].filter((request) => !allowedRequests.has(request)).sort()
if (undeclaredRequests.length > 0) {
  throw new Error(`client bundle requests undeclared modules: ${undeclaredRequests.join(', ')}`)
}
const unusedExternals = declaredExternals.filter((request) => !requests.has(request))
if (unusedExternals.length > 0) {
  throw new Error(`package.json declares unused client externals: ${unusedExternals.join(', ')}`)
}
const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8')
if (!patch.includes(`name: ${manifest.name}`)) {
  throw new Error('cordis.patch.yml does not insert this package')
}
if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') {
  throw new Error('package.json does not expose the bundle patch')
}
if (manifest.dsh?.client?.platform !== 'web') {
  throw new Error('package.json does not expose a Web Client half')
}
console.log(`verified ${manifest.name}@${manifest.version} bundle artifacts`)
