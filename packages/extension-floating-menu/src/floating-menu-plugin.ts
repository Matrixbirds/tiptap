import {
  Editor, Extension, getText, getTextSerializersFromSchema, posToDOMRect,
} from '@tiptap/core'
import { Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model'
import { EditorState, Plugin, PluginKey } from '@tiptap/pm/state'
import { EditorView } from '@tiptap/pm/view'
import tippy, { Instance, Props } from 'tippy.js'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    floatingMenuPlugin: {
      setFloatMenu: (visible: boolean) => ReturnType,
    }
  }
}

const floatingMenuKey = new PluginKey('floatingMenuKey')

const isEmptyParagraph = (pos: ResolvedPos, editor: Editor) => {
  const nodeParent = pos.parent

  if (nodeParent.type.name === 'paragraph' && nodeParent.content.size === 0 && !getText(nodeParent, { textSerializers: getTextSerializersFromSchema(editor.schema) })) {
    return true
  }

  return false
}

export interface FloatingMenuPluginProps {
  /**
   * The plugin key for the floating menu.
   * @default 'floatingMenu'
   */
  pluginKey: PluginKey | string

  /**
   * The editor instance.
   * @default null
   */
  editor: Editor

  /**
   * The DOM element that contains your menu.
   * @default null
   */
  element: HTMLElement

  /**
   * The options for the tippy instance.
   * @default {}
   * @see https://atomiks.github.io/tippyjs/v6/all-props/
   */
  tippyOptions?: Partial<Props>

  /**
   * A function that determines whether the menu should be shown or not.
   * If this function returns `false`, the menu will be hidden, otherwise it will be shown.
   * @default null
   */
  shouldShow?:
    | ((props: {
        editor: Editor
        view: EditorView
        state: EditorState
        oldState?: EditorState
      }) => boolean)
    | null
}

export type FloatingMenuViewProps = FloatingMenuPluginProps & {
  /**
   * The editor view.
   */
  view: EditorView
}

// TIPTAP PLUGIN
export class FloatingMenuView {
  public editor: Editor

  public element: HTMLElement

  public view: EditorView

  public preventHide = false

  public forceHide = false

  public tippy: Instance | undefined

  public visible: boolean = false

  public tippyOptions?: Partial<Props>

  private getTextContent(node:ProseMirrorNode) {
    return getText(node, { textSerializers: getTextSerializersFromSchema(this.editor.schema) })
  }

  public shouldShow: Exclude<FloatingMenuPluginProps['shouldShow'], null> = ({ view, state }) => {
    const { selection } = state
    const { $anchor, empty } = selection
    const isRootDepth = $anchor.depth === 1

    const isEmptyTextBlock = $anchor.parent.isTextblock && !$anchor.parent.type.spec.code && !$anchor.parent.textContent && $anchor.parent.childCount === 0 && !this.getTextContent($anchor.parent)

    if (
      !view.hasFocus()
      || !empty
      || !isRootDepth
      || !isEmptyTextBlock
      || !this.editor.isEditable
    ) {
      return false
    }

    return true
  }

  constructor({
    editor, element, view, tippyOptions = {}, shouldShow,
  }: FloatingMenuViewProps) {
    this.editor = editor
    this.element = element
    this.view = view
    this.forceHide = false

    if (shouldShow) {
      this.shouldShow = shouldShow
    }

    this.element.addEventListener('mousedown', this.mousedownHandler, { capture: true })
    this.element.addEventListener('keydown', this.keydownHandler)
    this.editor.on('focus', this.focusHandler)
    this.editor.on('blur', this.blurHandler)
    this.tippyOptions = tippyOptions
    // Detaches menu content from its current parent
    this.element.remove()
    this.element.style.visibility = 'visible'
  }

  mousedownHandler = (event: MouseEvent) => {
    console.log("mousedownHandler ", event.target)
    this.preventHide = true
  }

  keydownHandler = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      this.preventHide = true
      this.hide()
      this.editor.commands.focus()
    }
  }

  focusHandler = () => {
    // we use `setTimeout` to make sure `selection` is already updated
    setTimeout(() => this.update(this.editor.view))
  }

  blurHandler = ({ event }: { event: FocusEvent }) => {
    if (this.preventHide) {
      this.preventHide = false

      return
    }

    if (event?.relatedTarget && this.element.parentNode?.contains(event.relatedTarget as Node)) {
      return
    }

    if (
      event?.relatedTarget === this.editor.view.dom
    ) {
      return
    }

    this.hide()
  }

  tippyBlurHandler = (event: FocusEvent) => {
    this.blurHandler({ event })
  }

  createTooltip() {
    const { element: editorElement } = this.editor.options
    const editorIsAttached = !!editorElement.parentElement

    if (this.tippy || !editorIsAttached) {
      return
    }

    this.tippy = tippy(editorElement, {
      duration: 0,
      getReferenceClientRect: null,
      content: this.element,
      interactive: true,
      trigger: 'manual',
      placement: 'right',
      hideOnClick: 'toggle',
      onShow: () => {
        this.visible = true
        // this.editor.commands.blur()
        // const textarea = document.getElementById('textarea')

        setTimeout(() => {
          this.preventHide = true
          this.editor.commands.blur()
          requestAnimationFrame(() => {
            this.preventHide = false
            const textarea = document.getElementById('textarea')

            textarea?.focus()
          })
        }, 0)
        // textarea?.focus()
        // this.editor.view.dispatch(this.editor.state.tr.setMeta('forceFloating', true))
        // console.log("show tippy onShow")
      },
      onHidden: () => {
        this.visible = false
      },
      ...this.tippyOptions,
    })

    // maybe we have to hide tippy on its own blur event as well
    if (this.tippy.popper.firstChild) {
      (this.tippy.popper.firstChild as HTMLElement).addEventListener('blur', this.tippyBlurHandler)
    }
  }

  update(view: EditorView, oldState?: EditorState) {
    const { state, composing } = view
    const { selection } = state
    const { from, to } = selection

    if (composing || this.visible) {
      console.log("update ", view, oldState)
      return
    }

    this.createTooltip()

    const shouldShow = this.shouldShow?.({
      editor: this.editor,
      view,
      state,
      oldState,
    })

    if (!shouldShow) {
      this.hide()

      return
    }

    this.tippy?.setProps({
      getReferenceClientRect:
        this.tippyOptions?.getReferenceClientRect || (() => posToDOMRect(view, from, to)),
    })

    this.show()
  }

  show() {
    this.tippy?.show()
  }

  hide() {
    this.tippy?.hide()
  }

  destroy() {
    if (this.tippy?.popper.firstChild) {
      (this.tippy.popper.firstChild as HTMLElement).removeEventListener(
        'blur',
        this.tippyBlurHandler,
      )
    }
    this.tippy?.destroy()
    this.preventHide = false
    this.visible = false
    this.element.removeEventListener('mousedown', this.mousedownHandler, { capture: true })
    this.element.removeEventListener('keydown', this.keydownHandler)
    this.editor.off('focus', this.focusHandler)
    this.editor.off('blur', this.blurHandler)
  }
}

export const FloatingMenuPlugin = (options: FloatingMenuPluginProps) => {

  return new Plugin({
    key: floatingMenuKey,
    view: view => new FloatingMenuView({
      view,
      ...options,
      shouldShow: () => {
        const { selection } = view.state
        const { $anchor, empty } = selection

        const emptyParagraph = isEmptyParagraph($anchor, options.editor)
        const stateValue = floatingMenuKey.getState(view.state)

        if (!empty || !emptyParagraph || !stateValue.showFloatingMenu) {
          return false
        }
        return options.shouldShow?.({ editor: options.editor, view, state: view.state }) ?? true
      },
    }),
    state: {
      init: () => {
        return {
          showFloatingMenu: false,
        }
      },
      apply: (tr, value, oldState: EditorState, newState: EditorState) => {
        const meta = tr.getMeta(floatingMenuKey)

        if (meta !== undefined) {
          return { showFloatingMenu: meta }
        }

        const isSameDoc = oldState && oldState.doc.eq(newState.doc)
        const isSameSelection = oldState.selection.eq(newState.selection)

        // 这里是为了光标位置发生变化，导致菜单消失,需要判断文档模型的前后状态变更，以及光标是否有变更
        if (isSameDoc && isSameSelection) {
          return { showFloatingMenu: false }
        }

        return { showFloatingMenu: false }
      },
    },
  })
}

export const FloatingMenuExtension = Extension.create({
  name: 'floatingMenuExtension',
  addCommands() {
    return {
      setFloatMenu: (visible: boolean) => ({ tr, dispatch }) => {
        if (dispatch) {
          dispatch(tr.setMeta(floatingMenuKey, visible))
        }
        return true
      },
    }
  },
  addKeyboardShortcuts() {
    return {
      Space: () => {
        return this.editor.commands.command(({
          state, editor,
        }) => {
          if (editor && isEmptyParagraph(state.selection.$to, editor)) {
            editor.commands.setFloatMenu(true)
            return true
          }
          return false
        })
      },
      Escape: () => {
        return this.editor.commands.command(({ editor }) => {
          if (editor) {
            editor.commands.setFloatMenu(false)
            return true
          }
          return false
        })
      },
    }
  },
})
