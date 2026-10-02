/** True for a unique-constraint failure, whichever layer (Prisma or D1) reported it. */
export function isUniqueClash(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  if ((e as { code?: unknown }).code === 'P2002') return true;
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(String((e as { message?: unknown }).message ?? ''));
}

/**
 * Shop-scoped upserts (and "create if missing") are a read then a write on D1, so two saves of
 * the same row at once can both decide to insert and the second hits the unique key. Running it
 * once more finds the row the first one made and takes the update path.
 */
export async function retryOnClash<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (e) {
    if (!isUniqueClash(e)) throw e;
    return write();
  }
}
