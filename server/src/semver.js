const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;

export function compareSemver(left, right) {
  const a = SEMVER_RE.exec(left ?? "");
  const b = SEMVER_RE.exec(right ?? "");
  if (!a || !b) return null;
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(a[index]) - Number(b[index]);
    if (difference) return Math.sign(difference);
  }
  if (a[4] === b[4]) return 0;
  if (!a[4]) return 1;
  if (!b[4]) return -1;

  const leftIdentifiers = a[4].split(".");
  const rightIdentifiers = b[4].split(".");
  const count = Math.max(leftIdentifiers.length, rightIdentifiers.length);
  for (let index = 0; index < count; index += 1) {
    const leftIdentifier = leftIdentifiers[index];
    const rightIdentifier = rightIdentifiers[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;
    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric)
      return Math.sign(Number(leftIdentifier) - Number(rightIdentifier));
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return Math.sign(leftIdentifier.localeCompare(rightIdentifier));
  }
  return 0;
}
