import React, { useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { IconPlus, ScreenContainer, ScreenHeader, colors, radius, spacing, typography } from '@mana/ui';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { CommunitiesPanel, type CommunitiesPanelHandle } from './CommunitiesPanel';

type Props = NativeStackScreenProps<RootStackParamList, 'Communities'>;

/** The Communities tab on its own screen (the home screen shows the same panel in a tab). */
export function CommunitiesScreen({ navigation }: Props) {
  const panel = useRef<CommunitiesPanelHandle>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    await panel.current?.refresh();
    setRefreshing(false);
  };

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader
          title="Communities"
          onBack={() => navigation.goBack()}
          right={
            <Pressable
              onPress={() => navigation.navigate('CommunitySetup')}
              style={({ pressed }) => [styles.add, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Add a community"
              hitSlop={6}
            >
              <IconPlus size={16} color={colors.white} />
              <Text style={styles.addText}>Add</Text>
            </Pressable>
          }
        />
      </View>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.teal} />}
      >
        <CommunitiesPanel ref={panel} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  scroll: { paddingBottom: spacing.xxl },
  pressed: { opacity: 0.75 },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.tealDeep,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  addText: { ...typography.label, color: colors.white, fontWeight: '700' },
});
