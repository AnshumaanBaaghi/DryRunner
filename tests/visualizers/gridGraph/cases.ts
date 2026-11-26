/** Grid programs for the grid-graph tests: BFS / iterative DFS / maze traversals, backtracking path searches and look-alikes. */

/** BFS flood fill: a queue of [r, c] pairs, cells recolored in place as they are queued. */
export const FLOOD_FILL_BFS = `function floodFill(image, sr, sc, color) {
  const rows = image.length;
  const cols = image[0].length;
  const start = image[sr][sc];
  if (start === color) return image;
  const queue = [[sr, sc]];
  image[sr][sc] = color;
  while (queue.length > 0) {
    const [r, c] = queue.shift();
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && image[nr][nc] === start) {
        image[nr][nc] = color;
        queue.push([nr, nc]);
      }
    }
  }
  return image;
}
console.log(floodFill([[1, 1, 1], [1, 1, 0], [1, 0, 1]], 1, 1, 2));`;

/** Maze path search: walls '#', a separate visited 2D array. */
export const MAZE_VISITED = `function hasPath(maze, start, end) {
  const rows = maze.length;
  const cols = maze[0].length;
  const visited = Array.from({ length: rows }, () => new Array(cols).fill(false));

  function dfs(r, c) {
    if (r < 0 || c < 0 || r >= rows || c >= cols) return false;
    if (maze[r][c] === '#' || visited[r][c]) return false;
    if (r === end[0] && c === end[1]) return true;
    visited[r][c] = true;
    return dfs(r + 1, c) || dfs(r, c + 1) || dfs(r - 1, c) || dfs(r, c - 1);
  }

  return dfs(start[0], start[1]);
}
console.log(hasPath([
  ['.', '.', '#', '.'],
  ['#', '.', '#', '.'],
  ['.', '.', '.', '.'],
  ['.', '#', '#', '.'],
], [0, 0], [3, 3]));`;

/** Number of islands by BFS: a fresh queue per island, a visited Set of 'r,c' keys, a counter. */
export const ISLANDS_BFS_SET = `function numIslands(grid) {
  const rows = grid.length;
  const cols = grid[0].length;
  const seen = new Set();
  let islands = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== 1 || seen.has(r + ',' + c)) continue;
      islands++;
      const queue = [[r, c]];
      seen.add(r + ',' + c);
      while (queue.length > 0) {
        const [cr, cc] = queue.shift();
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nr = cr + dr;
          const nc = cc + dc;
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
          if (grid[nr][nc] !== 1 || seen.has(nr + ',' + nc)) continue;
          seen.add(nr + ',' + nc);
          queue.push([nr, nc]);
        }
      }
    }
  }
  return islands;
}
console.log(numIslands([
  [1, 1, 0, 0],
  [0, 1, 0, 1],
  [1, 0, 0, 1],
  [1, 1, 0, 0],
]));`;

/** Iterative DFS: a stack of [r, c] pairs, a visited 2D array, a counter. */
export const REGIONS_STACK = `function countRegions(grid) {
  const rows = grid.length;
  const cols = grid[0].length;
  const seen = Array.from({ length: rows }, () => new Array(cols).fill(false));
  let regions = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== '#' || seen[r][c]) continue;
      regions++;
      const stack = [[r, c]];
      seen[r][c] = true;
      while (stack.length) {
        const [cr, cc] = stack.pop();
        for (const [nr, nc] of [[cr + 1, cc], [cr - 1, cc], [cr, cc + 1], [cr, cc - 1]]) {
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols || seen[nr][nc] || grid[nr][nc] !== '#') continue;
          seen[nr][nc] = true;
          stack.push([nr, nc]);
        }
      }
    }
  }
  return regions;
}
console.log(countRegions(['##..', '#..#', '..##'].map((s) => s.split(''))));`;

/** BFS over a map indexed map[y][x] with [x, y] pairs. */
export const XY_FILL = `function fill(map, x0, y0) {
  const h = map.length;
  const w = map[0].length;
  const todo = [[x0, y0]];
  map[y0][x0] = '*';
  while (todo.length) {
    const [x, y] = todo.shift();
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || map[ny][nx] !== '.') continue;
      map[ny][nx] = '*';
      todo.push([nx, ny]);
    }
  }
  return map.map((row) => row.join(''));
}
console.log(fill(['.....', '.##..', '..#..'].map((s) => s.split('')), 0, 0));`;

/** The islands DFS run on two grids: each keeps to its own run. */
export const TWO_GRIDS = `function numIslands(grid) {
  let count = 0;
  function sink(r, c) {
    if (r < 0 || c < 0 || r >= grid.length || c >= grid[0].length || grid[r][c] !== '1') return;
    grid[r][c] = '0';
    sink(r + 1, c);
    sink(r - 1, c);
    sink(r, c + 1);
    sink(r, c - 1);
  }
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[0].length; c++) {
      if (grid[r][c] === '1') {
        sink(r, c);
        count++;
      }
    }
  }
  return count;
}
console.log(numIslands([['1', '1', '0'], ['0', '1', '0'], ['1', '0', '1']]));
console.log(numIslands([['1', '1'], ['1', '0']]));`;

/** Word search: cells marked '#' and restored around the recursive calls (a backtracking board). */
export const WORD_SEARCH = `function exist(board, word) {
  const rows = board.length;
  const cols = board[0].length;
  function dfs(r, c, k) {
    if (k === word.length) return true;
    if (r < 0 || c < 0 || r >= rows || c >= cols || board[r][c] !== word[k]) return false;
    const ch = board[r][c];
    board[r][c] = '#';
    const found = dfs(r + 1, c, k + 1) || dfs(r - 1, c, k + 1) || dfs(r, c + 1, k + 1) || dfs(r, c - 1, k + 1);
    board[r][c] = ch;
    return found;
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (dfs(r, c, 0)) return true;
  return false;
}
console.log(exist([['A', 'B', 'C', 'E'], ['S', 'F', 'C', 'S'], ['A', 'D', 'E', 'E']], 'ABCCED'));`;

/** Every path through a maze: a cell is unmarked once all its recursive calls returned (backtracking). */
export const MAZE_ALL_PATHS = `function countPaths(maze) {
  const n = maze.length;
  const seen = Array.from({ length: n }, () => new Array(n).fill(false));
  let paths = 0;
  function walk(r, c) {
    if (r < 0 || c < 0 || r >= n || c >= n || maze[r][c] === '#' || seen[r][c]) return;
    if (r === n - 1 && c === n - 1) {
      paths++;
      return;
    }
    seen[r][c] = true;
    walk(r + 1, c);
    walk(r - 1, c);
    walk(r, c + 1);
    walk(r, c - 1);
    seen[r][c] = false;
  }
  walk(0, 0);
  return paths;
}
console.log(countPaths([['.', '.', '.'], ['.', '#', '.'], ['.', '.', '.']]));`;

/** Memoized grid DP: the 2D table stores results after recursing (the memo view's). */
export const UNIQUE_PATHS_MEMO = `function uniquePaths(m, n) {
  const memo = Array.from({ length: m }, () => new Array(n).fill(-1));
  function go(r, c) {
    if (r === m - 1 || c === n - 1) return 1;
    if (memo[r][c] !== -1) return memo[r][c];
    memo[r][c] = go(r + 1, c) + go(r, c + 1);
    return memo[r][c];
  }
  return go(0, 0);
}
console.log(uniquePaths(4, 4));`;

/** Rotting oranges: a level-by-level BFS from every rotten orange, one queue drained a level per inner loop. */
export const ROTTING_ORANGES = `function orangesRotting(grid) {
  const rows = grid.length;
  const cols = grid[0].length;
  const queue = [];
  let fresh = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === 2) queue.push([r, c]);
      else if (grid[r][c] === 1) fresh++;
    }
  }
  let minutes = 0;
  while (queue.length && fresh > 0) {
    const size = queue.length;
    for (let i = 0; i < size; i++) {
      const [r, c] = queue.shift();
      for (const [nr, nc] of [[r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]]) {
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols || grid[nr][nc] !== 1) continue;
        grid[nr][nc] = 2;
        fresh--;
        queue.push([nr, nc]);
      }
    }
    minutes++;
  }
  return fresh === 0 ? minutes : -1;
}
console.log(orangesRotting([[2, 1, 1], [1, 1, 0], [0, 1, 1]]));`;

/** Shortest path by BFS over a head-index queue (\`queue[head++]\`), distances in a separate table. */
export const HEAD_INDEX_BFS = `function shortest(grid) {
  const n = grid.length;
  const dist = Array.from({ length: n }, () => new Array(n).fill(-1));
  const queue = [[0, 0]];
  dist[0][0] = 0;
  let head = 0;
  while (head < queue.length) {
    const [r, c] = queue[head++];
    for (const [dr, dc] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= n || nc >= n || grid[nr][nc] === 1 || dist[nr][nc] !== -1) continue;
      dist[nr][nc] = dist[r][c] + 1;
      queue.push([nr, nc]);
    }
  }
  return dist[n - 1][n - 1];
}
console.log(shortest([[0, 0, 0], [1, 1, 0], [0, 0, 0]]));`;

/**
 * Shortest path with k obstacle eliminations by DFS: cells marked 2 while on the path and put back once the four
 * recursive calls returned, results kept in a memo table of objects (`dp[r][c][k]`) shaped like the grid.
 */
export const OBSTACLE_PATH = `const shortestPossiblePath = (grid, rowCount, colCount, k, row, col, dp) => {
  if (row < 0 || col < 0 || row >= rowCount || col >= colCount || grid[row][col] == 2) return Infinity;
  if (row == rowCount - 1 && col == colCount - 1) return 0;
  if (!isNaN(dp[row][col][k])) return dp[row][col][k];
  if (grid[row][col] == 1) {
    if (k <= 0) return Infinity;
    grid[row][col] = 2;
    const left = shortestPossiblePath(grid, rowCount, colCount, k - 1, row, col - 1, dp);
    const right = shortestPossiblePath(grid, rowCount, colCount, k - 1, row, col + 1, dp);
    const top = shortestPossiblePath(grid, rowCount, colCount, k - 1, row - 1, col, dp);
    const bottom = shortestPossiblePath(grid, rowCount, colCount, k - 1, row + 1, col, dp);
    grid[row][col] = 1;
    const min = Math.min(left, right, top, bottom) + 1;
    dp[row][col][k] = min;
    return min;
  }
  grid[row][col] = 2;
  const left = shortestPossiblePath(grid, rowCount, colCount, k, row, col - 1, dp);
  const right = shortestPossiblePath(grid, rowCount, colCount, k, row, col + 1, dp);
  const top = shortestPossiblePath(grid, rowCount, colCount, k, row - 1, col, dp);
  const bottom = shortestPossiblePath(grid, rowCount, colCount, k, row + 1, col, dp);
  grid[row][col] = 0;
  const min = Math.min(left, right, top, bottom) + 1;
  dp[row][col][k] = min;
  return min;
};

function shortestPath(grid, k) {
  const dp = new Array(grid.length).fill(null).map(() => new Array(grid[0].length).fill(null).map(() => ({})));
  const ans = shortestPossiblePath(grid, grid.length, grid[0].length, k, 0, 0, dp);
  return ans == Infinity ? -1 : ans;
}

const grid = [
  [0, 1, 0, 0],
  [1, 1, 0, 0],
  [0, 0, 0, 1],
  [1, 0, 1, 0],
  [0, 0, 0, 0],
];
console.log(shortestPath(grid, 1));`;
