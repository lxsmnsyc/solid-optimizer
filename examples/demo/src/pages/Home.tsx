import { Card } from '../components/Card';
import { Counter } from '../components/Counter';
import { Tab, Tabs } from '../components/Tabs';

export function Home() {
  return (
    <Card title="Home">
      <Counter label="Clicks" start={0} />
      <Tabs>
        <Tab index={0}>Inlining</Tab>
        <Tab index={1} tone="accent" title="Constant folding">
          Folding
        </Tab>
      </Tabs>
    </Card>
  );
}
