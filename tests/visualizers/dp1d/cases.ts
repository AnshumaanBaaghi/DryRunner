/** Example ids shared by the DP detector tests. */
export const DP_2D = ['lcs', 'edit-distance', 'knapsack'];

/** Examples with no DP table at all (Dijkstra's `dist` is relaxed, islands sinks cells in DFS order, …). */
export const NOT_DP = [
  'loop-sum', 'nested-pairs', 'fibonacci', 'fibonacci-memo', 'factorial', 'n-queens', 'subsets', 'permutations', 'bst-traversals',
  'max-depth', 'bfs', 'dfs', 'dijkstra', 'islands', 'valid-parentheses', 'next-greater', 'queue-simulation', 'longest-substring',
  'two-sum-sorted', 'binary-search', 'reverse-list', 'bubble-sort', 'quick-sort', 'merge-sort',
];
