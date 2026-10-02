/** D1 refuses a query with more than 100 bound parameters, so long `IN (…)` lists go in slices. */
export const MAX_IN_LIST = 90;

export function chunk<T>(items: T[], size = MAX_IN_LIST): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
