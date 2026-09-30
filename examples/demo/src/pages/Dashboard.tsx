import { Loading, lazy } from 'solid-js';
import { Card } from '../components/Card';
import { Stat } from '../components/Stat';
import { Table } from '../components/Table';

const Chart = lazy(async () => import('./Chart'));

const ROWS = [
  { name: 'api', status: 'ok' },
  { name: 'worker', status: 'down' },
];

export default function Dashboard() {
  return (
    <Card title="Dashboard">
      <dl>
        <Stat label="Users" value={128} />
        <Stat label="Errors" value={3} />
      </dl>
      <Table rows={ROWS} />
      <Loading fallback={<p>Loading chart…</p>}>
        <Chart />
      </Loading>
    </Card>
  );
}
