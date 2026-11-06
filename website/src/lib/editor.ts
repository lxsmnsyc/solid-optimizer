import { javascript } from '@codemirror/lang-javascript';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { basicSetup } from 'codemirror';

// Colors come from the CSS variables twinkleplop uses too, so the editor and
// the output panes match.
const HIGHLIGHT = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: 'var(--syntax-keyword)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--syntax-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--syntax-number)' },
  { tag: tags.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: 'var(--syntax-function)',
  },
  { tag: [tags.className, tags.typeName], color: 'var(--syntax-type)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--syntax-property)' },
  { tag: [tags.tagName, tags.angleBracket], color: 'var(--syntax-tag)' },
]);

const THEME = EditorView.theme(
  {
    '&': {
      height: '100%',
      backgroundColor: 'transparent',
      color: 'var(--fg)',
      fontSize: '13px',
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-mono)',
      fontVariantLigatures: 'none',
      lineHeight: '1.7',
    },
    '.cm-content': { caretColor: 'var(--accent)', padding: '14px 0' },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: 'var(--fg-faint)',
      border: 'none',
    },
    '.cm-activeLine, .cm-activeLineGutter': {
      backgroundColor: 'var(--active-line)',
    },
    '&.cm-focused': { outline: 'none' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'var(--selection) !important',
    },
    '.cm-cursor': { borderLeftColor: 'var(--accent)' },
    '.cm-tooltip': {
      backgroundColor: 'var(--surface-2)',
      border: '1px solid var(--border)',
    },
  },
  { dark: true },
);

/** A fresh editor state for one file, with its own undo history. */
export function createFileState(doc: string, extensions: Extension[]): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      basicSetup,
      javascript({ jsx: true, typescript: true }),
      THEME,
      syntaxHighlighting(HIGHLIGHT),
      ...extensions,
    ],
  });
}

export function createEditor(parent: HTMLElement, state: EditorState): EditorView {
  return new EditorView({ parent, state });
}
