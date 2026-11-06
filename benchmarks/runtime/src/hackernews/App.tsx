import { For } from 'solid-js';
import Comment from '../../../../examples/hackernews/src/components/comment.jsx';
import Story from '../../../../examples/hackernews/src/components/story.jsx';
import item from '../../../../examples/hackernews/fixtures/item.json';
import news from '../../../../examples/hackernews/fixtures/news.json';
import newest from '../../../../examples/hackernews/fixtures/newest.json';

// Hacker News's two story lists and a story's comments, from its fixtures,
// rendered at once without the router. These are the components that run
// once per story and once per comment.
export function App() {
  return (
    <main>
      <ul class="news-list">
        <For each={news}>{(story) => <Story story={story} />}</For>
      </ul>
      <ul class="news-list">
        <For each={newest}>{(story) => <Story story={story} />}</For>
      </ul>
      <ul class="comment-children">
        <For each={item.comments}>{(comment) => <Comment comment={comment} />}</For>
      </ul>
    </main>
  );
}
