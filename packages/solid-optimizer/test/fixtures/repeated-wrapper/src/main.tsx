import { createMemo, createSignal } from 'solid-js';
import { render } from '@solidjs/web';

function Field(props: { label: string; value: string }) {
  const [focused, setFocused] = createSignal(false);
  const [touched, setTouched] = createSignal(false);
  const state = createMemo(() => {
    if (focused()) return 'editing';
    if (touched() && props.value.length === 0) return 'missing';
    return touched() ? 'done' : 'idle';
  });
  return (
    <label class={focused() ? 'field focused' : 'field'}>
      <span class="field-label">{props.label}</span>
      <input
        class="field-input"
        value={props.value}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setTouched(true);
        }}
        data-state={state()}
        placeholder="Type something here, then press enter to save it"
      />
      <small class="field-hint">Saved automatically when you leave the field</small>
    </label>
  );
}

function App() {
  const [name, setName] = createSignal('Ada');
  return (
    <form>
      <Field label="First name" value={name()} />
      <Field label="Last name" value={name()} />
      <Field label="Email" value={name()} />
      <Field label="Phone" value={name()} />
      <Field label="Street" value={name()} />
      <Field label="City" value={name()} />
      <Field label="Country" value={name()} />
      <Field label="Postal code" value={name()} />
      <button type="button" onClick={() => setName('Grace')}>
        Rename
      </button>
    </form>
  );
}

render(() => <App />, document.getElementById('app')!);
