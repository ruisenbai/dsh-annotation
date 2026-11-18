/** Launch the installed Linux GUI with a private profile and fixture-observer channel. */
import { createServer } from 'node:net'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { copyFile } from 'node:fs/promises'
import { _electron } from 'playwright'

export async function launchFixtureDesktop({
  directory,
  root,
  profile,
  patch,
  workspace,
  env,
  onReply,
  deadline,
}) {
  const address = join(root, 'fixture.sock')
  const connected = Promise.withResolvers()
  let connection
  const server = createServer((socket) => {
    if (connection) {
      socket.destroy()
      return
    }
    connection = socket
    createInterface({ input: socket }).on('line', (line) => onReply(JSON.parse(line)))
    connected.resolve()
  })
  let electron
  async function close() {
    try {
      await electron?.close()
    } finally {
      connection?.destroy()
      server.close()
    }
  }
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(address, resolve)
    })
    await copyFile(patch, join(profile, 'cordis.patch.yml'))
    const isolated = {
      ...env,
      DSH_ANNOTATION_FIXTURE_SOCKET: address,
      XDG_CONFIG_HOME: join(root, 'config'),
      XDG_DATA_HOME: join(root, 'data'),
      XDG_CACHE_HOME: join(root, 'cache'),
      LANG: 'zh_CN.UTF-8',
      LANGUAGE: 'zh_CN:zh',
    }
    delete isolated.ELECTRON_RUN_AS_NODE
    electron = await _electron.launch({
      executablePath: join(directory, 'deepseek-harness'),
      args: [
        '--user-data-dir=' + join(root, 'electron-data'),
        '--lang=zh-CN',
        '--disable-dev-shm-usage',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        ...(process.env.DSH_ANNOTATION_DESKTOP_PLATFORM
          ? ['--ozone-platform=' + process.env.DSH_ANNOTATION_DESKTOP_PLATFORM]
          : []),
      ],
      env: isolated,
      cwd: workspace,
      timeout: 55000,
    })
    await deadline(connected.promise, 'Desktop fixture observer', 65000)
    const window = await deadline(
      (async () => {
        for (;;) {
          const kind = await electron.evaluate(({ BrowserWindow }) => {
            for (const win of BrowserWindow.getAllWindows()) {
              if (!win.isVisible()) continue
              const url = win.webContents.getURL()
              if (url.endsWith('/renderer/welcome.html')) return 'welcome'
              if (url.startsWith('dsh-app://app/')) return 'workspace'
            }
          })
          const pages = electron.windows()
          if (kind === 'workspace') {
            const main = pages.find((item) => item.url().startsWith('dsh-app://app/'))
            if (main) return main
          }
          if (kind === 'welcome') {
            const welcome = pages.find((item) => item.url().endsWith('/renderer/welcome.html'))
            if (welcome) {
              await welcome.locator('#api-key').click()
              await Promise.all([welcome.waitForEvent('close'), welcome.locator('#skip-key').click()])
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      })(),
      'Visible desktop workspace',
      40000,
    )
    return { window, send: (packet) => connection.write(JSON.stringify(packet) + '\n'), close }
  } catch (error) {
    await close()
    throw error
  }
}
