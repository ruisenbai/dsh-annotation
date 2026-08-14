import { access, readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const required = [
  'lib/index.js',
  'lib/invariant.js',
  'lib/client.js',
  'lib/types/index.d.ts',
  'lib/types/client/index.d.ts',
  'cordis.patch.yml',
]
await Promise.all(required.map((path) => access(new URL(path, root))))

const client = await readFile(new URL('lib/client.js', root), 'utf8')
if (
  !client.startsWith('window.__ModuleLoader__.load({') ||
  !client.includes(`id: ${JSON.stringify(manifest.name)}`)
) {
  throw new Error('client bundle does not register with the DSH module loader')
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
