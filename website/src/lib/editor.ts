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
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: 'var(--syn-keyword)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--syn-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--syn-number)' },
  { tag: tags.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: 'var(--syn-function)',
  },
  { tag: [tags.className, tags.typeName], color: 'var(--syn-type)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--syn-attr)' },
  { tag: [tags.tagName, tags.angleBracket], color: 'var(--syn-tag)' },
]);

const THEME = EditorView.theme(
  {
    '&': {
      height: '100%',
      backgroundColor: 'transparent',
      color: 'var(--text)',
      fontSize: '13px',
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-mono)',
      fontVariantLigatures: 'none',
      lineHeight: '1.7',
    },
    '.cm-content': { caretColor: 'var(--accent-strong)', padding: '14px 0' },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: 'var(--muted)',
      border: 'none',
    },
    '.cm-activeLine, .cm-activeLineGutter': {
      backgroundColor: 'var(--surface-strong)',
    },
    '&.cm-focused': { outline: 'none' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'var(--accent-tint) !important',
    },
    '.cm-cursor': { borderLeftColor: 'var(--accent-strong)' },
    // Banig: no borders. A tooltip is a raised tile on the editor's well.
    '.cm-tooltip': {
      backgroundColor: 'var(--bg-elevated)',
      border: 'none',
      borderRadius: 'var(--radius-row)',
    },
  },
  // The colors are tokens that follow the site's theme, so the editor is not marked dark or light.
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
