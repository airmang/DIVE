/**
 * Myers-like line diff, LCS-based. Produces unified hunks of `+`/`-`/`=` ops.
 * Kept tiny and dep-free. Caps input at 300 lines (spec §5.5 hint) to stay
 * inline-renderable; callers can delegate the overflow to the slide-in panel.
 */

export type DiffOp = "eq" | "add" | "del";

export interface DiffLine {
  op: DiffOp;
  text: string;
  leftNum: number | null;
  rightNum: number | null;
}

export interface DiffResult {
  lines: DiffLine[];
  truncated: boolean;
  addCount: number;
  delCount: number;
}

const MAX_LINES = 300;

export function computeLineDiff(before: string, after: string): DiffResult {
  const a = before === "" ? [] : before.split(/\r?\n/);
  const b = after === "" ? [] : after.split(/\r?\n/);
  const truncated = a.length > MAX_LINES || b.length > MAX_LINES;
  const aCap = a.slice(0, MAX_LINES);
  const bCap = b.slice(0, MAX_LINES);

  const n = aCap.length;
  const m = bCap.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        aCap[i] === bCap[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const lines: DiffLine[] = [];
  let addCount = 0;
  let delCount = 0;
  let i = 0;
  let j = 0;
  let leftNum = 1;
  let rightNum = 1;
  while (i < n && j < m) {
    if (aCap[i] === bCap[j]) {
      lines.push({ op: "eq", text: aCap[i], leftNum, rightNum });
      i++;
      j++;
      leftNum++;
      rightNum++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      lines.push({ op: "del", text: aCap[i], leftNum, rightNum: null });
      delCount++;
      i++;
      leftNum++;
    } else {
      lines.push({ op: "add", text: bCap[j], leftNum: null, rightNum });
      addCount++;
      j++;
      rightNum++;
    }
  }
  while (i < n) {
    lines.push({ op: "del", text: aCap[i], leftNum, rightNum: null });
    delCount++;
    i++;
    leftNum++;
  }
  while (j < m) {
    lines.push({ op: "add", text: bCap[j], leftNum: null, rightNum });
    addCount++;
    j++;
    rightNum++;
  }

  return { lines, truncated, addCount, delCount };
}
