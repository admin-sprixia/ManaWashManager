import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GOOGLE_REVIEW_MIN_STARS, RATING_COMMENT_MAX, RATING_WINDOW_DAYS } from '@mana/domain';
import {
  Button,
  TextField,
  colors,
  showToast,
  spacing,
  typography,
} from '@mana/ui';
import { EdgePanel, SectionLabel } from './CardList';
import { api, send } from '../api/client';
import { errorMessage } from '../api/errors';
import { openLink } from '../utils/contact';
import { StarRating } from './StarRating';

interface SavedRating {
  stars: number;
  comment: string | null;
}

/**
 * Stars and a note for one paid wash, which the branch team reads. Happy customers also get a
 * link to the branch's Google reviews.
 */
export function RateWashCard({
  washId,
  rating,
  canRate,
  reviewUrl,
  branchName,
}: {
  washId: string;
  rating: SavedRating | null;
  canRate: boolean;
  reviewUrl: string | null;
  branchName: string;
}) {
  const [saved, setSaved] = useState<SavedRating | null>(rating);
  const [editing, setEditing] = useState(rating == null);
  const [stars, setStars] = useState(rating?.stars ?? 0);
  const [comment, setComment] = useState(rating?.comment ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!saved && !canRate) return null;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = await send(
        api.washes[':id'].rating.$put({
          param: { id: washId },
          json: { stars, comment: comment.trim() || null },
        }),
      );
      setSaved(body.rating);
      setEditing(false);
      showToast('Thanks! The team will see your rating.', 'success');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const showGoogle = saved != null && !editing && saved.stars >= GOOGLE_REVIEW_MIN_STARS && reviewUrl != null;

  return (
    <>
      <SectionLabel>{saved && !editing ? 'Your rating' : 'How was this wash?'}</SectionLabel>
      <EdgePanel>
      {saved && !editing ? (
        <>
          <StarRating value={saved.stars} size={28} />
          {saved.comment ? <Text style={styles.comment}>“{saved.comment}”</Text> : null}
          {showGoogle ? (
            <View style={styles.google}>
              <Text style={styles.googleText}>Glad you liked it! A Google review helps {branchName} a lot.</Text>
              <Button label="Review us on Google" onPress={() => openLink(reviewUrl)} />
            </View>
          ) : null}
          {canRate ? (
            <Button label="Change rating" variant="secondary" onPress={() => setEditing(true)} />
          ) : null}
        </>
      ) : (
        <>
          <Text style={styles.hint}>Only the {branchName} team sees this. You can change it for {RATING_WINDOW_DAYS} days.</Text>
          <StarRating value={stars} onChange={setStars} />
          {stars > 0 ? (
            <TextField
              label={stars >= GOOGLE_REVIEW_MIN_STARS ? 'Anything to add?' : 'What went wrong?'}
              optional
              value={comment}
              onChangeText={setComment}
              maxLength={RATING_COMMENT_MAX}
              multiline
              placeholder={stars >= GOOGLE_REVIEW_MIN_STARS ? 'What did you like?' : 'Tell the team what to do better'}
            />
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            {saved ? (
              <View style={styles.flex}>
                <Button
                  label="Cancel"
                  variant="secondary"
                  onPress={() => {
                    setStars(saved.stars);
                    setComment(saved.comment ?? '');
                    setEditing(false);
                    setError(null);
                  }}
                  disabled={busy}
                />
              </View>
            ) : null}
            <View style={styles.flex}>
              <Button label="Send rating" onPress={() => void save()} disabled={stars === 0} loading={busy} />
            </View>
          </View>
        </>
      )}
      </EdgePanel>
    </>
  );
}

const styles = StyleSheet.create({
  hint: { ...typography.body, color: colors.slateDeep, fontSize: 14, lineHeight: 20 },
  comment: { ...typography.body, color: colors.waterInk, fontStyle: 'italic', textAlign: 'center' },
  google: { gap: spacing.sm, paddingTop: spacing.xs },
  googleText: { ...typography.body, color: colors.slateDeep, fontSize: 14, textAlign: 'center' },
  error: { ...typography.body, color: colors.danger, fontSize: 14 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
});
