import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { PLACE_CODE_LENGTH, isPlaceCode } from '@mana/domain';
import { Button, IconMapPin, IconPhone, Notice, TextField, colors, spacing } from '@mana/ui';
import { api, send } from '../../api/client';
import { errorMessage } from '../../api/errors';
import type { NearbyPlace } from '../../api/types';
import { EdgeGroup, EdgePanel, EdgeRow, SectionLabel } from '../../components/CardList';
import { PlaceRow } from '../../components/places/PlaceCard';
import { ScreenHeader } from '../../components/ScreenHeader';
import { usePageStyle } from '../../layout/Layout';
import type { JoinStackParams } from '../../navigation/types';
import { useJoinMode } from '../../places/joinMode';
import { currentLocation, type Coordinates } from '../../utils/location';

type Props = NativeStackScreenProps<JoinStackParams, 'FindPlace'>;

/**
 * "Where is your vehicle parked?" One tap shares the location and lists the places MANA washes
 * at nearby, nearest first, with their photos; a code from a QR poster opens a place directly.
 * Not listed: a new number asks to be called back, a customer talks to their branch.
 */
export function FindPlaceScreen({ navigation }: Props) {
  const pageStyle = usePageStyle();
  const mode = useJoinMode();
  const [location, setLocation] = useState<Coordinates | null>(null);
  const [places, setPlaces] = useState<NearbyPlace[] | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const findNearby = async () => {
    setLocating(true);
    setError(null);
    try {
      const here = await currentLocation();
      setLocation(here);
      const r = await send(api.places.near.$get({ query: { lat: String(here.latitude), lng: String(here.longitude) } }));
      setPlaces(r.places);
    } catch (err) {
      setError(err instanceof Error && err.name === 'LocationError' ? err.message : errorMessage(err));
    } finally {
      setLocating(false);
    }
  };

  const openCode = async () => {
    const clean = code.trim().toUpperCase();
    if (!isPlaceCode(clean)) {
      setCodeError(`The code on the poster has ${PLACE_CODE_LENGTH} letters and numbers.`);
      return;
    }
    setOpening(true);
    try {
      const { place } = await send(api.places['by-code'][':code'].$get({ param: { code: clean } }));
      navigation.navigate('JoinPlace', { placeId: place.id });
    } catch (err) {
      setCodeError(errorMessage(err));
    } finally {
      setOpening(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScreenHeader title="Find your place" onBack={() => navigation.goBack()} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={[styles.content, pageStyle]} keyboardShouldPersistTaps="handled">
          <SectionLabel>Where is your vehicle parked?</SectionLabel>
          <EdgePanel>
            <Text style={styles.lead}>
              We wash at buildings, colonies and streets on fixed days. Share your location to see the ones near you.
            </Text>
            <Button
              label={location ? 'Search again here' : 'Use my location'}
              variant={location ? 'secondary' : 'primary'}
              size="lg"
              icon={<IconMapPin size={18} color={location ? colors.water : colors.white} />}
              loading={locating}
              onPress={() => void findNearby()}
            />
            {error ? <Notice tone="warning">{error}</Notice> : null}
          </EdgePanel>

          {locating && !places ? <ActivityIndicator color={colors.water} style={styles.loading} /> : null}
          {places ? (
            <>
              <SectionLabel right={places.length ? `${places.length} nearby` : undefined}>Places near you</SectionLabel>
              {places.length ? (
                <EdgeGroup>
                  {places.map((p) => (
                    <PlaceRow
                      key={p.id}
                      place={p}
                      distanceM={p.distanceM}
                      onPress={() => navigation.navigate('JoinPlace', { placeId: p.id, location })}
                    />
                  ))}
                </EdgeGroup>
              ) : (
                <EdgePanel>
                  <Text style={styles.lead}>We don’t wash near you yet. Ask us to start, below.</Text>
                </EdgePanel>
              )}
            </>
          ) : null}

          <SectionLabel>Have a code from a poster?</SectionLabel>
          <EdgePanel>
            <TextField
              label="Place code"
              placeholder="e.g. K7M2QPX"
              value={code}
              onChangeText={(t) => {
                setCode(t.toUpperCase().replace(/[^0-9A-Z]/g, ''));
                setCodeError(null);
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={PLACE_CODE_LENGTH}
              onSubmitEditing={() => void openCode()}
              returnKeyType="go"
              error={codeError}
            />
            <Button
              label="Open place"
              variant="secondary"
              disabled={code.length < PLACE_CODE_LENGTH}
              loading={opening}
              onPress={() => void openCode()}
            />
          </EdgePanel>

          <SectionLabel>My place isn’t here</SectionLabel>
          <EdgeGroup>
            {mode.kind === 'ticket' ? (
              <EdgeRow
                icon={<IconPhone size={18} color={colors.indigo} />}
                title="Call me back"
                subtitle="Tell us where you are and we’ll call you to start washing there"
                onPress={() => navigation.navigate('RequestForm')}
              />
            ) : (
              <EdgeRow
                icon={<IconPhone size={18} color={colors.indigo} />}
                title="Talk to your branch"
                subtitle="Ask them to start washing at your place"
                onPress={() => navigation.navigate('Help')}
              />
            )}
          </EdgeGroup>
          <View style={styles.bottom} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  content: { paddingBottom: spacing.xl },
  lead: { fontSize: 15, lineHeight: 21, color: colors.slateDeep },
  loading: { marginTop: spacing.lg },
  bottom: { height: spacing.md },
});
