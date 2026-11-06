/**
 * The tracker's data, made the same way on every run so that every build
 * renders the same issues. `fetchIssues` and `fetchComments` stand in for a
 * server: each answers on a later microtask, and the first load of issue 13's
 * comments fails.
 */

export interface User {
  readonly id: number;
  readonly name: string;
  readonly initials: string;
}

export interface Issue {
  readonly id: number;
  readonly title: string;
  readonly state: 'open' | 'closed';
  readonly priority: 'low' | 'medium' | 'high';
  readonly labels: readonly string[];
  /** Missing when nobody is assigned. */
  readonly assignee: User | undefined;
  readonly comments: number;
  readonly opened: string;
}

export interface Comment {
  readonly id: number;
  readonly author: User;
  readonly body: string;
}

const NAMES = ['Ana Reyes', 'Ben Okafor', 'Chen Wei', 'Dara Novak', 'Eli Santos', 'Fay Lund'];
const LABELS = ['bug', 'docs', 'performance', 'ssr', 'types', 'question'];
const VERBS = ['Fix', 'Document', 'Speed up', 'Test', 'Refactor', 'Remove'];
const THINGS = [
  'hydration of nested lists',
  'the router cache',
  'store reconciliation',
  'event delegation',
  'the dev overlay',
  'async boundaries',
  'stream flushing',
];
const PRIORITIES = ['low', 'medium', 'high'] as const;

/** A fixed sequence of numbers in `[0, 1)`, so each run makes the same data. */
function sequence(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

function pick<T>(next: () => number, items: readonly T[]): T {
  const item = items[Math.floor(next() * items.length)];
  if (item === undefined) {
    throw new Error('pick from an empty list');
  }
  return item;
}

function makeUsers(): User[] {
  const users: User[] = [];
  for (const [index, name] of NAMES.entries()) {
    let initials = '';
    for (const part of name.split(' ')) {
      initials += part.charAt(0);
    }
    users.push({ id: index + 1, name, initials });
  }
  return users;
}

export const USERS: readonly User[] = makeUsers();

function makeIssues(): Issue[] {
  const next = sequence(7);
  const issues: Issue[] = [];
  for (let id = 1; id <= 40; id += 1) {
    const labels = new Set<string>();
    const count = Math.floor(next() * 3);
    for (let index = 0; index < count; index += 1) {
      labels.add(pick(next, LABELS));
    }
    issues.push({
      id,
      title: `${pick(next, VERBS)} ${pick(next, THINGS)}`,
      state: next() < 0.3 ? 'closed' : 'open',
      priority: pick(next, PRIORITIES),
      labels: [...labels],
      assignee: next() < 0.25 ? undefined : pick(next, USERS),
      comments: Math.floor(next() * 6),
      opened: `${String(1 + Math.floor(next() * 28))} days ago`,
    });
  }
  return issues;
}

export const ISSUES: readonly Issue[] = makeIssues();

/** The issue whose comments fail to load the first time. */
export const FLAKY_ISSUE = 13;
let flakyFailed = false;

export function commentsOf(issue: Issue): Comment[] {
  const next = sequence(issue.id);
  const comments: Comment[] = [];
  for (let index = 0; index < issue.comments; index += 1) {
    comments.push({
      id: issue.id * 100 + index,
      author: pick(next, USERS),
      body: `${pick(next, ['Confirmed', 'Cannot reproduce', 'Looks related to', 'Fixed by'])} ${pick(next, THINGS)}.`,
    });
  }
  return comments;
}

export async function fetchIssues(): Promise<readonly Issue[]> {
  await Promise.resolve();
  return ISSUES;
}

export async function fetchComments(issue: Issue): Promise<Comment[]> {
  await Promise.resolve();
  if (issue.id === FLAKY_ISSUE && !flakyFailed) {
    flakyFailed = true;
    throw new Error(`The comments of #${String(issue.id)} are unavailable. Try again.`);
  }
  return commentsOf(issue);
}
