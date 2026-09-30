import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Table } from '../components/Table';

const MEMBERS = [
  { name: 'Ada', status: 'admin' },
  { name: 'Linus', status: 'member' },
];

export default function Settings() {
  return (
    <Card title="Settings">
      <p>
        Signed in as <Avatar name="Ada" />
      </p>
      <Table rows={MEMBERS} />
      <Button icon="save" onClick={() => {}}>
        Save
      </Button>
    </Card>
  );
}
