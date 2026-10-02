import { For } from 'solid-js';
import { Badge } from './Badge';

// Used by two lazy pages and not by the entry, so Rolldown moves it into a
// chunk the two pages share. Neither page can inline it.
export function Table(props: { rows: { name: string; status: string }[] }) {
  return (
    <table class="table">
      <tbody>
        <For each={props.rows}>
          {(row) => (
            <tr>
              <td>{row.name}</td>
              <td>
                <Badge tone={row.status} text={row.status} />
              </td>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
}
