/** Before/after photos on a job. */

export type PhotoKind = 'before' | 'after';

export const PHOTO_KINDS: readonly PhotoKind[] = ['before', 'after'];

export const MAX_PHOTOS_PER_KIND = 10;

/** The app compresses to well under this; anything bigger wasn't compressed. */
export const MAX_PHOTO_BYTES = 1_500_000;

/** Photos (object and row) are purged this long after they were taken. */
export const PHOTO_RETENTION_DAYS = 90;

/** Longest edge the app resizes to before upload. */
export const PHOTO_MAX_EDGE_PX = 1280;
