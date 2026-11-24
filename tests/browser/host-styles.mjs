/** The standalone fixture mounts the styles normally installed by the DSH Web renderer. */
import { __$dsh_client_module_manifest as primitives } from '@deepseek-ai/dsh-client-ui-primitives'

for (const [path, sheet] of Object.entries(primitives.meta().stylesheets)) {
  const element = document.createElement('style')
  element.dataset.plugin = primitives.id
  element.dataset.path = path
  element.textContent = sheet.text({ asset: (name) => new URL(name, document.baseURI).href })
  document.head.append(element)
}
