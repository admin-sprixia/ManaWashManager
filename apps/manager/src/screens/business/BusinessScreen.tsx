import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  Button,
  EdgeGroup,
  EdgeRow,
  IconCalendar,
  IconCar,
  IconChart,
  IconEdit,
  IconHome,
  IconPerson,
  IconPlus,
  IconRupee,
  IconSparkle,
  IconStore,
  IconSync,
  IconTag,
  IconTrash,
  Notice,
  PhoneField,
  Pill,
  ScreenContainer,
  ScreenHeader,
  SectionLabel,
  colors,
  showAlert,
  spacing,
  typography,
} from '@mana/ui';
import { isValidPhone, normalizePhone } from '@mana/domain';
import { api } from '../../api/client';
import { useAuth } from '../../api/auth';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { NameSheet, useCatalog } from './shared';

type Props = NativeStackScreenProps<RootStackParamList, 'Business'>;

const formatPhone = (p: string) => (p.length === 10 ? `${p.slice(0, 5)} ${p.slice(5)}` : p);

/**
 * The business behind every branch: one price list, its rules and who may change them. Each
 * change here rebuilds every branch's menu on its own.
 */
export function BusinessScreen({ navigation }: Props) {
  const { user } = useAuth();
  const { catalog, error, load, run } = useCatalog();
  const [renaming, setRenaming] = useState(false);
  const [adminPhone, setAdminPhone] = useState('');
  const [adminError, setAdminError] = useState<string | null>(null);
  const [addingAdmin, setAddingAdmin] = useState(false);
  const [busy, setBusy] = useState<'publish' | 'import' | 'homeWash' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!catalog) {
    return (
      <ScreenContainer noPadding>
        <View style={styles.headerPad}>
          <ScreenHeader title="Business price list" onBack={() => navigation.goBack()} />
        </View>
        {error ? (
          <View style={styles.pad}>
            <Notice tone="danger">{error}</Notice>
            <Button label="Try again" variant="secondary" onPress={() => void load()} />
          </View>
        ) : (
          <ActivityIndicator color={colors.water} style={styles.loading} />
        )}
      </ScreenContainer>
    );
  }

  const updating = catalog.branches.filter((b) => !b.upToDate).length;
  const activeServices = catalog.services.filter((s) => s.active);
  const doorstep = catalog.adjustments.find((a) => a.mode === 'doorstep' && a.classId == null);
  const activeZones = catalog.zones.filter((z) => z.active).length;
  const { policy } = catalog;

  const addAdmin = async () => {
    const phone = normalizePhone(adminPhone);
    if (!isValidPhone(phone)) return setAdminError('Enter a valid 10-digit mobile number.');
    if (catalog.admins.includes(phone)) return setAdminError('Already an admin.');
    setAddingAdmin(true);
    const message = await run(() => api.business.admins.$post({ json: { phone } }), 'Admin added');
    setAddingAdmin(false);
    if (message) return setAdminError(message);
    setAdminPhone('');
    setAdminError(null);
  };

  const removeAdmin = (phone: string) => {
    const self = phone === user?.phone;
    showAlert(
      self ? 'Stop being an admin?' : `Remove +91 ${formatPhone(phone)}?`,
      self
        ? 'You won’t be able to change the business price list any more. Another admin can add you back.'
        : 'They keep running their branch, but can’t change the business price list any more.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const message = await run(() => api.business.admins[':phone'].$delete({ param: { phone } }), 'Admin removed');
              if (message) setActionError(message);
              else if (self) navigation.goBack();
            })();
          },
        },
      ],
      { icon: <IconTrash size={26} color={colors.danger} /> },
    );
  };

  const publish = async () => {
    setBusy('publish');
    setActionError(null);
    const message = await run(() => api.business.publish.$post(), 'Every branch’s menu is being updated');
    setBusy(null);
    if (message) setActionError(message);
  };

  const toggleHomeWash = () => {
    const turnOn = !catalog.homeWash;
    showAlert(
      turnOn ? 'Start washing at single homes?' : 'Stop washing at single homes?',
      turnOn
        ? 'New Wash gets a Doorstep choice, and people near your branches can book your team to their home in the MANA Car Wash app.'
        : 'Your team keeps washing at communities. New Wash and the MANA Car Wash app stop offering washes at single homes. Turn it back on any time.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: turnOn ? 'Turn on' : 'Turn off',
          onPress: () => {
            void (async () => {
              setBusy('homeWash');
              setActionError(null);
              const message = await run(
                () => api.business['plan-rules'].$patch({ json: { homeWash: turnOn } }),
                turnOn ? 'Washing at homes is on' : 'Washing at homes is off',
              );
              setBusy(null);
              if (message) setActionError(message);
            })();
          },
        },
      ],
    );
  };

  const importMenu = () => {
    showAlert(
      'Copy this branch’s menu into the price list?',
      'Each service here that the price list doesn’t have yet is added, with this branch’s prices as base prices for sizes that have none. Every branch then gets them.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Copy',
          onPress: () => {
            void (async () => {
              setBusy('import');
              setActionError(null);
              const message = await run(() => api.business.import.$post({ json: {} }), 'Menu copied into the price list');
              setBusy(null);
              if (message) setActionError(message);
            })();
          },
        },
      ],
    );
  };

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="Business price list" onBack={() => navigation.goBack()} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.pad}>
          {updating > 0 ? (
            <Notice tone="info" title={`Updating ${updating} branch${updating === 1 ? '' : 'es'}`}>
              Menus update in the background after each change. Pull back to this screen to see progress.
            </Notice>
          ) : (
            <Notice tone="success" title="Every branch is up to date">
              Changes here reach every branch’s menu, New Wash and the MANA Car Wash app straight away.
            </Notice>
          )}
        </View>

        <SectionLabel>Business</SectionLabel>
        <EdgeGroup>
          <EdgeRow
            icon={<IconStore size={19} color={colors.waterDeep} />}
            title={catalog.business.name}
            subtitle={`${catalog.branches.length} branch${catalog.branches.length === 1 ? '' : 'es'} · tap to rename`}
            right={<IconEdit size={16} color={colors.waterDeep} />}
            chevron={false}
            onPress={() => setRenaming(true)}
          />
        </EdgeGroup>

        <SectionLabel>Price list</SectionLabel>
        <EdgeGroup>
          <EdgeRow
            icon={<IconSparkle size={19} color={colors.waterDeep} />}
            title="Services"
            subtitle={`${activeServices.length} service${activeServices.length === 1 ? '' : 's'} · names, where they’re done, combos`}
            onPress={() => navigation.navigate('BusinessServices')}
          />
          <EdgeRow
            icon={<IconRupee size={19} color={colors.tealDeep} />}
            iconBg="#CCFBF1"
            title="Base prices"
            subtitle={`By vehicle size${catalog.priceBooks.length > 1 ? ` · ${catalog.priceBooks.length} price books` : ''}`}
            onPress={() => navigation.navigate('BusinessPrices')}
          />
          <EdgeRow
            icon={<IconChart size={19} color={colors.amberDeep} />}
            iconBg="#FEF3C7"
            title="Pricing rules"
            subtitle={[
              doorstep
                ? `${catalog.homeWash ? 'Doorstep' : 'Community'} +${doorstep.percentBp / 100}%`
                : `No ${catalog.homeWash ? 'doorstep' : 'community'} extra`,
              activeZones ? `${activeZones} zone${activeZones === 1 ? '' : 's'}` : null,
              policy.branchOverrides ? `branches ±${Math.max(policy.maxIncreasePct, policy.maxDecreasePct)}%` : 'fixed prices',
            ]
              .filter(Boolean)
              .join(' · ')}
            onPress={() => navigation.navigate('BusinessRules')}
          />
          <EdgeRow
            icon={<IconCar size={19} color="#5B21B6" />}
            iconBg="#EDE9FE"
            title="Vehicle sizes"
            subtitle="Which size each kind of vehicle is priced as"
            onPress={() => navigation.navigate('BusinessVehicles')}
          />
          <EdgeRow
            icon={<IconTag size={19} color={colors.waterDeep} />}
            title="Branches and price books"
            subtitle={updating > 0 ? `${updating} updating` : 'Which prices and zone each branch uses'}
            right={updating > 0 ? <Pill label="UPDATING" tone="amber" /> : undefined}
            onPress={() => navigation.navigate('BusinessBranches')}
          />
        </EdgeGroup>

        <SectionLabel>Communities</SectionLabel>
        <EdgeGroup>
          <EdgeRow
            icon={<IconCalendar size={19} color={colors.tealDeep} />}
            iconBg="#CCFBF1"
            title="Wash plans"
            subtitle="Monthly and longer plans, paying, refunds and GST"
            onPress={() => navigation.navigate('WashPlans')}
          />
          <EdgeRow
            icon={busy === 'homeWash' ? <ActivityIndicator color={colors.water} /> : <IconHome size={19} color={colors.waterDeep} />}
            title="Washing at single homes"
            subtitle={
              catalog.homeWash
                ? 'On · people can book your team to their home'
                : 'Off · your team goes only to communities'
            }
            right={<Pill label={catalog.homeWash ? 'ON' : 'OFF'} tone={catalog.homeWash ? 'teal' : 'slate'} />}
            chevron={false}
            disabled={busy != null}
            onPress={toggleHomeWash}
          />
        </EdgeGroup>

        <SectionLabel>Admins</SectionLabel>
        <Text style={[styles.help, styles.pad]}>
          Admins change the business price list. Sign in with one of these numbers to see this screen.
        </Text>
        <EdgeGroup>
          {catalog.admins.map((phone) => (
            <EdgeRow
              key={phone}
              icon={<IconPerson size={19} color={colors.waterDeep} />}
              title={`+91 ${formatPhone(phone)}`}
              subtitle={phone === user?.phone ? 'You' : undefined}
              right={catalog.admins.length > 1 ? <IconTrash size={17} color={colors.danger} /> : undefined}
              chevron={false}
              onPress={catalog.admins.length > 1 ? () => removeAdmin(phone) : undefined}
            />
          ))}
        </EdgeGroup>
        <View style={[styles.pad, styles.block]}>
          <PhoneField
            label="Add an admin"
            digits={adminPhone}
            onChangeDigits={(d) => {
              setAdminPhone(d);
              if (adminError) setAdminError(null);
            }}
            normalize={normalizePhone}
            error={adminError}
            onSubmit={() => void addAdmin()}
          />
          <Button
            label="Add admin"
            variant="secondary"
            icon={<IconPlus size={18} color={colors.water} />}
            loading={addingAdmin}
            onPress={() => void addAdmin()}
          />
        </View>

        <SectionLabel>Tools</SectionLabel>
        <EdgeGroup>
          <EdgeRow
            icon={busy === 'publish' ? <ActivityIndicator color={colors.water} /> : <IconSync size={18} color={colors.waterDeep} />}
            title="Update every branch now"
            subtitle="Menus update by themselves; use this if one looks out of date"
            disabled={busy != null}
            onPress={() => void publish()}
          />
          <EdgeRow
            icon={busy === 'import' ? <ActivityIndicator color={colors.water} /> : <IconPlus size={18} color={colors.waterDeep} />}
            title="Copy this branch’s menu in"
            subtitle="Adds this branch’s own services to the price list"
            disabled={busy != null}
            onPress={importMenu}
          />
        </EdgeGroup>
        {actionError ? <Text style={[styles.error, styles.pad]}>{actionError}</Text> : null}
      </ScrollView>

      <NameSheet
        visible={renaming}
        title="Business name"
        label="Name"
        initial={catalog.business.name}
        maxLength={80}
        onClose={() => setRenaming(false)}
        onSave={async (name) => {
          const message = await run(() => api.business.$patch({ json: { name } }), 'Name saved');
          if (!message) setRenaming(false);
          return message;
        }}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  loading: { marginTop: spacing.xl },
  scroll: { paddingBottom: spacing.xxl },
  pad: { paddingHorizontal: spacing.md, gap: spacing.md },
  block: { paddingTop: spacing.md },
  help: { ...typography.body, color: colors.slateDeep, fontSize: 14, lineHeight: 20, marginBottom: spacing.sm },
  error: { ...typography.label, color: colors.danger, marginTop: spacing.md },
});
