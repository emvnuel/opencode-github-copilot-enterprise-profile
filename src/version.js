export function compareSemver(a, b) {
  const pa = String(a || "0.0.0").split(".").map((x) => Number.parseInt(x, 10) || 0)
  const pb = String(b || "0.0.0").split(".").map((x) => Number.parseInt(x, 10) || 0)
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1
    if ((pa[i] || 0) < (pb[i] || 0)) return -1
  }
  return 0
}
