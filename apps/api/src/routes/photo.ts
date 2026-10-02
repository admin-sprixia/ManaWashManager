import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { jobRepo, opsRepo } from '@mana/db';
import {
  MAX_OFFLINE_BACKDATE_MS,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_KIND,
  PHOTO_KINDS,
  resolveOccurredAt,
  type PhotoKind,
} from '@mana/domain';
import { startOfIstDay } from '../lib/istDate';
import { requireAuth, requireRole } from '../middleware/auth';
import type { Env } from '../types';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Invalid id');

const uploadSchema = z.object({
  id: idSchema,
  jobId: idSchema,
  kind: z.enum(PHOTO_KINDS as [PhotoKind, ...PhotoKind[]]),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  file: z.instanceof(File, { message: 'Attach a photo' }),
});
const photoParamSchema = z.object({ id: idSchema });

/** Staff see photos for jobs still on the board (today's, or not yet closed out); owners see all. */
function staffCanSee(job: { status: string; createdAt: Date }) {
  return (
    job.createdAt.getTime() >= startOfIstDay().getTime() ||
    ['waiting', 'washing', 'ready'].includes(job.status)
  );
}

// Uploads may be replayed from the phone's offline queue, so they're keyed by a client id.
export const photoRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth)
  .post('/', zValidator('form', uploadSchema), async (c) => {
    const body = c.req.valid('form');
    const db = c.get('db');
    const session = c.get('session');

    const existing = await opsRepo.findPhoto(db, body.id);
    if (existing) {
      if (existing.jobId !== body.jobId) return c.json({ error: 'invalid_id' as const }, 409);
      return c.json({ id: existing.id, kind: existing.kind as PhotoKind }, 200);
    }

    const job = await jobRepo.findById(db, body.jobId);
    if (!job) return c.json({ error: 'job_not_found' as const, message: 'This job no longer exists.' }, 404);
    if (job.status === 'void') {
      return c.json({ error: 'job_void' as const, message: 'This job was voided.' }, 409);
    }
    if (session.role !== 'owner' && Date.now() - job.createdAt.getTime() > MAX_OFFLINE_BACKDATE_MS) {
      return c.json(
        { error: 'too_old' as const, message: 'Only the owner can add photos to older jobs.' },
        403,
      );
    }
    if (!ALLOWED_TYPES.has(body.file.type)) {
      return c.json({ error: 'bad_type' as const, message: 'Photos must be JPEG, PNG or WebP.' }, 400);
    }
    if (body.file.size === 0 || body.file.size > MAX_PHOTO_BYTES) {
      return c.json({ error: 'too_large' as const, message: 'That photo is too large.' }, 400);
    }
    if ((await opsRepo.countPhotos(db, body.jobId, body.kind)) >= MAX_PHOTOS_PER_KIND) {
      return c.json(
        {
          error: 'limit_reached' as const,
          message: `A job can have at most ${MAX_PHOTOS_PER_KIND} ${body.kind} photos.`,
        },
        409,
      );
    }

    const ext = body.file.type === 'image/png' ? 'png' : body.file.type === 'image/webp' ? 'webp' : 'jpg';
    const r2Key = `shops/${session.shopId}/photos/${body.jobId}/${body.id}.${ext}`;
    await c.env.PHOTOS.put(r2Key, await body.file.arrayBuffer(), {
      httpMetadata: { contentType: body.file.type },
    });
    try {
      await opsRepo.createPhoto(db, {
        id: body.id,
        jobId: body.jobId,
        kind: body.kind,
        r2Key,
        contentType: body.file.type,
        sizeBytes: body.file.size,
        takenByUserId: session.sub,
        createdAt: resolveOccurredAt(body.occurredAt),
      });
    } catch (e) {
      // A replay of the same upload may have saved the row first — it owns this same key.
      const winner = await opsRepo.findPhoto(db, body.id);
      if (winner?.jobId === body.jobId) return c.json({ id: winner.id, kind: winner.kind as PhotoKind }, 200);
      await c.env.PHOTOS.delete(r2Key);
      throw e;
    }
    return c.json({ id: body.id, kind: body.kind }, 201);
  })
  .get('/:id', zValidator('param', photoParamSchema), async (c) => {
    const db = c.get('db');
    const photo = await opsRepo.findPhoto(db, c.req.valid('param').id);
    if (!photo || photo.deletedAt) return c.json({ error: 'not_found' as const }, 404);
    if (c.get('session').role !== 'owner') {
      const job = await jobRepo.findById(db, photo.jobId);
      if (!job || !staffCanSee(job)) return c.json({ error: 'forbidden' as const }, 403);
    }
    const object = await c.env.PHOTOS.get(photo.r2Key);
    if (!object) return c.json({ error: 'not_found' as const }, 404);
    return c.body(object.body, 200, {
      'Content-Type': photo.contentType,
      'Cache-Control': 'private, max-age=86400',
    });
  })
  // Owner only. The image is removed at once; the row stays (marked deleted) as a record. The row
  // is marked first, so if removing the image fails the nightly job finishes the job.
  .delete('/:id', requireRole('owner'), zValidator('param', photoParamSchema), async (c) => {
    const db = c.get('db');
    const photo = await opsRepo.findPhoto(db, c.req.valid('param').id);
    if (!photo) return c.json({ error: 'not_found' as const }, 404);
    if (!photo.deletedAt) await opsRepo.deletePhoto(db, photo.id, c.get('session').sub);
    await c.env.PHOTOS.delete(photo.r2Key);
    return c.json({ ok: true as const });
  });
