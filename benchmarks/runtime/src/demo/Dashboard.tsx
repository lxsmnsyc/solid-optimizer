import { Card } from '../../../../examples/demo/src/components/Card';
import { Stat } from '../../../../examples/demo/src/components/Stat';
import { Table } from '../../../../examples/demo/src/components/Table';
import Chart from '../../../../examples/demo/src/pages/Chart';

const ROWS = [
  { name: 'api', status: 'ok' },
  { name: 'worker', status: 'down' },
];

// The demo's dashboard with its chart imported directly. `renderToString`
// does not wait for a lazy component, so a lazy chart would render as its
// fallback on the server.
export function Dashboard() {
  return (
    <Card title="Dashboard">
      <dl>
        <Stat label="Users" value={128} />
        <Stat label="Errors" value={3} />
      </dl>
      <Table rows={ROWS} />
      <Chart />
    </Card>
  );
}
