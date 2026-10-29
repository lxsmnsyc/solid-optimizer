// `Config` is only used as a type, but the import has no `type` keyword.
import { Config } from './config';

const config: Config = { title: 'Hello' };

export function App() {
  return <h1>{config.title}</h1>;
}
