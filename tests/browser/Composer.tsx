import { useLayoutEffect, useMemo, useRef } from 'react'
import { registerPlainText } from '@lexical/plain-text'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  COMMAND_PRIORITY_HIGH,
  createEditor,
  KEY_ENTER_COMMAND,
} from 'lexical'

/** 使用与 DSH 相同的 Lexical 编辑器承载浏览器夹具，不用 textarea 模拟选区。 */
export function BrowserComposer({
  text,
  onText,
  onSubmit,
}: {
  text: string
  onText: (text: string) => void
  onSubmit: () => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onText, onSubmit })
  callbacks.current = { onText, onSubmit }
  const editor = useMemo(
    () =>
      createEditor({
        namespace: 'annotation-browser-composer',
        onError: (error) => {
          throw error
        },
      }),
    [],
  )
  useLayoutEffect(() => {
    editor.setRootElement(rootRef.current)
    const unregisterPlainText = registerPlainText(editor)
    const unregisterUpdate = editor.registerUpdateListener(({ editorState }) => {
      callbacks.current.onText(editorState.read(() => $getRoot().getTextContent()))
    })
    const unregisterEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        if (event === null || event.shiftKey || event.isComposing || editor.isComposing()) return false
        event.preventDefault()
        callbacks.current.onSubmit()
        return true
      },
      COMMAND_PRIORITY_HIGH,
    )
    return () => {
      unregisterEnter()
      unregisterUpdate()
      unregisterPlainText()
      editor.setRootElement(null)
    }
  }, [editor])
  useLayoutEffect(() => {
    if (editor.getEditorState().read(() => $getRoot().getTextContent()) === text) return
    editor.update(
      () => {
        $getRoot()
          .clear()
          .append($createParagraphNode().append($createTextNode(text)))
      },
      { discrete: true },
    )
  }, [editor, text])
  return (
    <div
      ref={rootRef}
      data-composer-input
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="Official composer"
    />
  )
}
