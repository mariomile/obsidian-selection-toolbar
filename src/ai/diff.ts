export type DiffSeg = { type: "eq" | "del" | "add"; text: string };

/** Word-level diff (LCS over whitespace/word tokens). No dependencies. */
export function wordDiff(a: string, b: string): DiffSeg[] {
  const A = a.match(/\s+|[^\s]+/g) ?? [];
  const B = b.match(/\s+|[^\s]+/g) ?? [];
  const n = A.length;
  const m = B.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const segs: DiffSeg[] = [];
  const push = (type: DiffSeg["type"], text: string) => {
    const last = segs[segs.length - 1];
    if (last && last.type === type) last.text += text;
    else segs.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      push("eq", A[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("del", A[i]);
      i++;
    } else {
      push("add", B[j]);
      j++;
    }
  }
  while (i < n) push("del", A[i++]);
  while (j < m) push("add", B[j++]);
  return segs;
}

/** True when the diff is small enough to render comfortably. */
export const DIFF_CHAR_CAP = 6000;
