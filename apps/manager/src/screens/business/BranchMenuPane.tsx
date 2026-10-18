import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@mana/ui';
import { api } from '../../api/client';
import { useApiData } from '../places/shared';
import type { Catalog } from './shared';
import { PlanList, type PlanItem } from './branch/PlanList';
import { ServiceSwitchList } from './branch/ServiceSwitchList';

type Branch = Catalog['branches'][number];
type Run = (call: () => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>, done?: string) => Promise<string | null>;

/**
 * The head-office services a branch sells, each with its own switch, and the plans they make
 * possible. Nothing reaches a branch until HQ switches it on here; switching a combo on brings
 * the services it bundles with it.
 */
export function BranchMenuPane({ catalog, branch, run }: { catalog: Catalog; branch: Branch; run: Run }) {
  const [menu, setMenu] = useState<string[]>(branch.menu);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setMenu(branch.menu), [branch.menu]);
  const plans = useApiData<{ plans: PlanItem[] }>(() => api.business.plans.$get(), 'Couldn’t load the wash plans.');

  const save = async (next: string[], done: string) => {
    const before = menu;
    setMenu(next);
    setBusy(true);
    setError(null);
    const message = await run(() => api.business.branches[':id'].menu.$put({ param: { id: branch.id }, json: { serviceIds: next } }), done);
    setBusy(false);
    if (message) {
      setMenu(before);
      setError(message);
    }
  };

  const nameOf = (id: string) => catalog.services.find((s) => s.id === id)?.name ?? 'Service';
  const live = catalog.services.filter((s) => s.active);

  return (
    <View style={styles.pane}>
      <Text style={styles.title}>Services sold here</Text>
      <Text style={styles.hint}>
        Switch on what {branch.name} sells. New head-office services start off here until you switch them on.
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ServiceSwitchList
        catalog={catalog}
        value={menu}
        runs={branch.services.live}
        disabled={busy}
        onToggle={(id, on) =>
          void save(on ? [...menu, id] : menu.filter((x) => x !== id), on ? `${nameOf(id)} is on at ${branch.name}` : `${nameOf(id)} switched off at ${branch.name}`)
        }
        onAll={(on) => void save(on ? live.map((s) => s.id) : [], on ? `Every service is on at ${branch.name}` : `Every service is off at ${branch.name}`)}
      />

      <Text style={[styles.title, styles.gap]}>Plans sold here</Text>
      <Text style={styles.hint}>A plan is sold where its wash is switched on: at the shop, at communities, or both, as the plan says.</Text>
      {plans.data ? (
        <PlanList
          plans={plans.data.plans}
          menu={menu}
          runs={branch.services.live}
          onSell={(ids) => void save([...new Set([...menu, ...ids])], 'Plan on sale here')}
        />
      ) : plans.error ? (
        <Text style={styles.error}>{plans.error}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pane: { paddingHorizontal: spacing.md, gap: spacing.sm + 2 },
  title: { ...typography.heading, fontSize: 18, color: colors.ink, letterSpacing: -0.2 },
  gap: { marginTop: spacing.md },
  hint: { ...typography.body, fontSize: 13.5, color: colors.slateDeep, lineHeight: 19 },
  error: { ...typography.label, color: colors.danger },
});
