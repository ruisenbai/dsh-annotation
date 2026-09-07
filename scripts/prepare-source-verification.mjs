/** Create an isolated plugin checkout whose official dependencies use verified host tarballs. */
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const root = fileURLToPath(new URL('../', import.meta.url))
const baseline = JSON.parse(readFileSync(join(root, 'source-baseline.json'), 'utf8'))
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const { values } = parseArgs({
  options: {
    harness: { type: 'string' },
    from: { type: 'string', multiple: true },
    out: { type: 'string' },
  },
})
if (!values.harness || !values.from?.length || !values.out) {
  throw new Error(
    'Usage: node scripts/prepare-source-verification.mjs --harness <checkout> --from <tarballs> [--from <tarballs>] --out <new-directory>',
  )
}
const harness = resolve(values.harness)
const output = resolve(values.out)
const capture = (command, args, cwd) => execFileSync(command, args, { cwd, encoding: 'utf8' }).trim()
if (capture('git', ['rev-parse', 'HEAD'], harness) !== baseline.commit) {
  throw new Error(`Harness checkout must be the official ${baseline.tag} commit ${baseline.commit}`)
}
if (capture('git', ['status', '--porcelain', '--untracked-files=no'], harness) !== '') {
  throw new Error('Harness tracked files must be clean before source verification')
}
if (manifest.engines.dsh !== baseline.version) throw new Error('Source baseline differs from engines.dsh')

const overrides = {}
const sourceVersions = {}
for (const directory of values.from.map((path) => resolve(path))) {
  for (const filename of readdirSync(directory)
    .filter((name) => name.endsWith('.tgz'))
    .sort()) {
    const tarball = join(directory, filename)
    const pkg = JSON.parse(capture('tar', ['-xOf', tarball, 'package/package.json'], root))
    if (!pkg.name.startsWith('@deepseek-ai/')) throw new Error(`Unexpected source package: ${pkg.name}`)
    if (pkg.name === '@deepseek-ai/dsh' || pkg.name.startsWith('@deepseek-ai/dsh-')) {
      if (pkg.version !== baseline.version) throw new Error(`Wrong DSH version in ${filename}`)
    }
    if (overrides[pkg.name]) throw new Error(`Duplicate source package: ${pkg.name}`)
    overrides[pkg.name] = pathToFileURL(tarball).href
    sourceVersions[pkg.name] = pkg.version
  }
}
for (const name of Object.keys(manifest.devDependencies).filter((name) => name.startsWith('@deepseek-ai/'))) {
  if (!overrides[name]) throw new Error(`Missing official dependency tarball: ${name}`)
}
if (!overrides['@deepseek-ai/node-addon-landlock-run']) throw new Error('Missing Landlock entry tarball')

// 临时目录不覆盖源仓库，也不沿用旧宿主版本的锁文件。
mkdirSync(output)
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  cwd: root,
  encoding: 'utf8',
})
  .split('\0')
  .filter((name) => name && name !== 'pnpm-lock.yaml')
for (const name of new Set(files)) {
  mkdirSync(dirname(join(output, name)), { recursive: true })
  copyFileSync(join(root, name), join(output, name))
}
// 显式提供整套宿主 peer，避免 pnpm 为未声明的 peer 查询尚未发布的 npm 版本。
writeFileSync(
  join(output, 'package.json'),
  `${JSON.stringify({ ...manifest, devDependencies: { ...sourceVersions, ...manifest.devDependencies } }, null, 2)}\n`,
)
const workspace = `${readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')}\n# Optional external model CLIs are outside annotation verification.\nignoredOptionalDependencies:\n  - '@anthropic-ai/claude-agent-sdk-*'\n  - '@openai/codex-*'\n`
writeFileSync(
  join(output, 'pnpm-workspace.yaml'),
  `${workspace}\noverrides:\n${Object.entries(overrides)
    .map(([name, url]) => `  ${JSON.stringify(name)}: ${JSON.stringify(url)}`)
    .join('\n')}\n`,
)
console.log(
  `Prepared ${manifest.name}@${manifest.version} in ${output} against ${Object.keys(overrides).length} official tarballs from ${baseline.commit}`,
)
