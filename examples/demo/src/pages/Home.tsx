import { Card } from '../components/Card';
import { Counter } from '../components/Counter';

export function Home() {
  return (
    <Card title="Home">
      <Counter label="Clicks" start={0} />
    </Card>
  );
}
