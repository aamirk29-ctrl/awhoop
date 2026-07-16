// Generic staleness ranking — sort items so whatever you've neglected the
// longest (or never touched at all) surfaces first. First used by the Gym
// exercise recommender; kept dependency-free so it can rank anything else
// keyed by a "last touched" timestamp (e.g. CFA review blocks, networking
// follow-ups) without pulling in gym types.

/** Sorts `items` oldest-last-touched first. `lastDoneAt` returns ms epoch, or
 *  null if the item has never been done — null sorts before every real
 *  timestamp, i.e. never-done items are the most stale. */
export function rankByStaleness<T>(items: T[], lastDoneAt: (item: T) => number | null): T[] {
  return items
    .map((item) => ({ item, at: lastDoneAt(item) }))
    .sort((a, b) => (a.at ?? -Infinity) - (b.at ?? -Infinity))
    .map((x) => x.item);
}
