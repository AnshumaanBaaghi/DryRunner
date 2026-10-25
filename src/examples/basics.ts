import type { Example } from './types';

export const BASIC_EXAMPLES: Example[] = [
  {
    id: 'loop-sum',
    title: 'Simple loop sum',
    category: 'Loops',
    expect: { primary: 'scalars' },
    code: `let sum = 0;
for (let i = 0; i < 5; i++) {
  sum += i;
}
console.log(sum);
`,
  },
  {
    id: 'nested-pairs',
    title: 'Nested loops: all pairs',
    category: 'Loops',
    expect: { primary: 'scalars', mode: 'iteration-space' },
    code: `const items = ['a', 'b', 'c', 'd'];
for (let i = 0; i < items.length; i++) {
  for (let j = i + 1; j < items.length; j++) {
    console.log(items[i] + items[j]);
  }
}
`,
  },
  {
    id: 'fibonacci',
    title: 'Fibonacci (recursion)',
    category: 'Recursion',
    expect: { primary: 'recursionTree', also: ['callStack'] },
    code: `function fib(n) {
  if (n <= 1) return n;
  return fib(n - 1) + fib(n - 2);
}
console.log(fib(5));
`,
  },
  {
    id: 'fibonacci-memo',
    title: 'Fibonacci with memo',
    category: 'Recursion',
    expect: { primary: 'memo', also: ['callStack'] },
    code: `const memo = new Map();
function fib(n) {
  if (n <= 1) return n;
  if (memo.has(n)) return memo.get(n);
  const value = fib(n - 1) + fib(n - 2);
  memo.set(n, value);
  return value;
}
console.log(fib(8));
`,
  },
  {
    id: 'factorial',
    title: 'Factorial',
    category: 'Recursion',
    expect: { primary: 'recursionTree', also: ['callStack'] },
    code: `function factorial(n) {
  if (n === 0) return 1;
  return n * factorial(n - 1);
}
console.log(factorial(5));
`,
  },
  {
    id: 'n-queens',
    title: 'N-Queens (4×4)',
    category: 'Backtracking',
    expect: { primary: 'backtracking', mode: 'board' },
    code: `function solveNQueens(n) {
  const board = Array.from({ length: n }, () => new Array(n).fill('.'));
  const solutions = [];

  function isSafe(row, col) {
    for (let r = 0; r < row; r++) {
      if (board[r][col] === 'Q') return false;
      const d = row - r;
      if (col - d >= 0 && board[r][col - d] === 'Q') return false;
      if (col + d < n && board[r][col + d] === 'Q') return false;
    }
    return true;
  }

  function place(row) {
    if (row === n) {
      solutions.push(board.map((r) => r.join('')));
      return;
    }
    for (let col = 0; col < n; col++) {
      if (!isSafe(row, col)) continue;
      board[row][col] = 'Q';
      place(row + 1);
      board[row][col] = '.';
    }
  }

  place(0);
  return solutions;
}
console.log(solveNQueens(4));
`,
  },
  {
    id: 'subsets',
    title: 'Subsets',
    category: 'Backtracking',
    expect: { primary: 'backtracking', mode: 'path' },
    code: `function subsets(nums) {
  const result = [];
  const path = [];
  function backtrack(start) {
    result.push([...path]);
    for (let i = start; i < nums.length; i++) {
      path.push(nums[i]);
      backtrack(i + 1);
      path.pop();
    }
  }
  backtrack(0);
  return result;
}
console.log(subsets([1, 2, 3]));
`,
  },
  {
    id: 'permutations',
    title: 'Permutations',
    category: 'Backtracking',
    expect: { primary: 'backtracking', mode: 'path' },
    code: `function permute(nums) {
  const result = [];
  const path = [];
  const used = new Array(nums.length).fill(false);
  function backtrack() {
    if (path.length === nums.length) {
      result.push([...path]);
      return;
    }
    for (let i = 0; i < nums.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      path.push(nums[i]);
      backtrack();
      path.pop();
      used[i] = false;
    }
  }
  backtrack();
  return result;
}
console.log(permute([1, 2, 3]));
`,
  },
  {
    id: 'climbing-stairs',
    title: 'Climbing stairs (1D DP)',
    category: 'Dynamic programming',
    expect: { primary: 'dp1d' },
    code: `function climbStairs(n) {
  const dp = new Array(n + 1).fill(0);
  dp[0] = 1;
  dp[1] = 1;
  for (let i = 2; i <= n; i++) {
    dp[i] = dp[i - 1] + dp[i - 2];
  }
  return dp[n];
}
console.log(climbStairs(6));
`,
  },
  {
    id: 'lcs',
    title: 'Longest common subsequence',
    category: 'Dynamic programming',
    expect: { primary: 'dp2d' },
    code: `function lcs(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp[a.length][b.length];
}
console.log(lcs('ABCBDAB', 'BDCABA'));
`,
  },
  {
    id: 'edit-distance',
    title: 'Edit distance',
    category: 'Dynamic programming',
    expect: { primary: 'dp2d' },
    code: `function minDistance(word1, word2) {
  const m = word1.length;
  const n = word2.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (word1[i - 1] === word2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}
console.log(minDistance('horse', 'ros'));
`,
  },
  {
    id: 'knapsack',
    title: '0/1 knapsack',
    category: 'Dynamic programming',
    expect: { primary: 'dp2d' },
    code: `function knapsack(weights, values, capacity) {
  const n = weights.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(capacity + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let w = 0; w <= capacity; w++) {
      dp[i][w] = dp[i - 1][w];
      if (weights[i - 1] <= w) {
        dp[i][w] = Math.max(dp[i][w], dp[i - 1][w - weights[i - 1]] + values[i - 1]);
      }
    }
  }
  return dp[n][capacity];
}
console.log(knapsack([1, 3, 4, 5], [1, 4, 5, 7], 7));
`,
  },
];
