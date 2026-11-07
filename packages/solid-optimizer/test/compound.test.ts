/**
 * Compound components, like Kobalte's
 * `const Dialog = Object.assign(DialogRoot, { Trigger: DialogTrigger })`.
 * `<Dialog>` is the root and `<Dialog.Trigger>` is the part, so both inline.
 */
import { describe, expect, it } from 'vitest';
import { lower, optimize, templateCount } from './utils';

const PARTS = `
function DialogRoot(props) {
  return <div class="root">{props.children}</div>;
}
function DialogTrigger(props) {
  return <button>{props.children}</button>;
}
function DialogTitle(props) {
  return <h2>{props.children}</h2>;
}`;

const VIEW = `export const view = (
  <Dialog>
    <Dialog.Trigger>Open</Dialog.Trigger>
    <Dialog.Title>Hi</Dialog.Title>
  </Dialog>
);`;

function compile(code: string): string {
  const out = optimize(code);
  expect(() => lower(out)).not.toThrow();
  return out;
}

describe('compound components', () => {
  it('inlines the root and its parts, and removes the compound', () => {
    const out = compile(
      `${PARTS}\nconst Dialog = Object.assign(DialogRoot, { Trigger: DialogTrigger, Title: DialogTitle });\n${VIEW}`,
    );
    expect(out.replaceAll(/\s+/g, '')).toContain(
      '<divclass="root"><button>Open</button><h2>Hi</h2></div>',
    );
    expect(out).not.toContain('Object.assign');
    expect(out).not.toContain('function Dialog');
    expect(templateCount(out)).toBe(1);
  });

  it('reads a string key and a shorthand part', () => {
    const out = compile(
      `${PARTS}\nconst Trigger = DialogTrigger;\nconst Dialog = Object.assign(DialogRoot, { 'Title': DialogTitle, Trigger });\nexport const view = <Dialog><Dialog.Title>Hi</Dialog.Title></Dialog>;`,
    );
    expect(out).toContain('<div class="root"><h2>Hi</h2></div>');
  });

  it('keeps the compound when something else reads it', () => {
    const out = compile(
      `${PARTS}\nexport const Dialog = Object.assign(DialogRoot, { Trigger: DialogTrigger, Title: DialogTitle });\n${VIEW}`,
    );
    // The tags name the parts, but the export keeps every part, so a copy
    // would only add to the output.
    expect(out).toContain('<DialogTrigger>Open</DialogTrigger>');
    expect(out).toContain('export const Dialog = Object.assign(DialogRoot');
  });

  it('keeps the compound when the root is read for a part', () => {
    const out = compile(
      `${PARTS}\nconst Dialog = Object.assign(DialogRoot, { Trigger: DialogTrigger, Title: DialogTitle });\nexport const parts = [DialogRoot.Trigger];\n${VIEW}`,
    );
    expect(out).toContain('Object.assign(DialogRoot');
    expect(out).toContain('function DialogTrigger');
  });

  it('leaves the tags when a part is written', () => {
    const out = compile(
      `${PARTS}\nconst Dialog = Object.assign(DialogRoot, { Trigger: DialogTrigger, Title: DialogTitle });\nDialog.Trigger = DialogTitle;\n${VIEW}`,
    );
    expect(out).toContain('<Dialog.Trigger>');
  });

  it('leaves the tags when the root is written', () => {
    const out = compile(
      `${PARTS}\nconst Dialog = Object.assign(DialogRoot, { Trigger: DialogTrigger, Title: DialogTitle });\nDialogRoot.Title = DialogTrigger;\n${VIEW}`,
    );
    expect(out).toContain('<Dialog.Title>');
  });

  it('leaves the tags when Object is not the global', () => {
    const out = compile(
      `const Object = { assign: (a) => a };\n${PARTS}\nconst Dialog = Object.assign(DialogRoot, { Trigger: DialogTrigger, Title: DialogTitle });\n${VIEW}`,
    );
    expect(out).toContain('<Dialog.Trigger>');
  });

  it('leaves the tags when the parts are not plain names', () => {
    for (const parts of [
      '{ ...extra, Trigger: DialogTrigger }',
      '{ [key]: DialogTrigger }',
      '{ Trigger() { return null; } }',
      '{ get Trigger() { return DialogTrigger; } }',
    ]) {
      const out = compile(
        `const extra = {};\nconst key = 'Trigger';\n${PARTS}\nconst Dialog = Object.assign(DialogRoot, ${parts});\nexport const view = <Dialog.Trigger>Open</Dialog.Trigger>;`,
      );
      expect(out, parts).toContain('<Dialog.Trigger>');
    }
  });

  it('leaves a member tag the compound does not have', () => {
    const out = compile(
      `${PARTS}\nconst Dialog = Object.assign(DialogRoot, { Trigger: DialogTrigger });\nexport const view = <Dialog.Title>Hi</Dialog.Title>;`,
    );
    expect(out).toContain('<Dialog.Title>');
  });

  it('leaves a tag where the part name means something else', () => {
    const out = compile(
      `${PARTS}\nconst Dialog = Object.assign(DialogRoot, { Trigger: DialogTrigger });\nexport function View() {\n  const DialogTrigger = (props) => <i>{props.children}</i>;\n  return <div><DialogTrigger>a</DialogTrigger><Dialog.Trigger>b</Dialog.Trigger></div>;\n}`,
    );
    expect(out).toContain('<Dialog.Trigger>b</Dialog.Trigger>');
  });
});
