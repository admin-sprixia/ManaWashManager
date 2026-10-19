import React from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { IconBug, IconCar, IconChart, IconRupee, IconSettings, IconSparkle, IconStore, colors } from '@mana/ui';
import { EdgeGroup, EdgeRow, Pill } from './EdgeList';
import { useShop } from '../offline/ShopProvider';
import type { RootStackParamList } from '../navigation/RootNavigator';

/**
 * Mana Wash HQ's tools, the same on More (HQ who also run a branch) and on the HQ home (HQ who
 * work at no branch). `errorLog`: the signed-in branch's app and server errors, so only where
 * there is a branch.
 */
export function HqToolsGroup({ errorLog = false, sizeGuide = false }: { errorLog?: boolean; sizeGuide?: boolean }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { unseenErrors } = useShop();
  return (
    <EdgeGroup>
      <EdgeRow
        icon={<IconStore size={19} color={colors.waterDeep} />}
        title="All branches"
        subtitle="Today’s numbers, open, pause or close, owners"
        onPress={() => navigation.navigate('BusinessBranches')}
      />
      <EdgeRow
        icon={<IconSparkle size={19} color={colors.indigo} />}
        iconBg={colors.indigoPale}
        title="Services and plans"
        subtitle="What every branch can sell, and wash plans"
        onPress={() => navigation.navigate('BusinessServices')}
      />
      <EdgeRow
        icon={<IconRupee size={19} color={colors.tealDeep} />}
        iconBg="#CCFBF1"
        title="Base prices"
        subtitle="Hub, community and doorstep prices, price books"
        onPress={() => navigation.navigate('BusinessPrices')}
      />
      <EdgeRow
        icon={<IconChart size={19} color={colors.amberDeep} />}
        iconBg="#FEF3C7"
        title="Pricing rules"
        subtitle="How much branch owners may change prices"
        onPress={() => navigation.navigate('BusinessRules')}
      />
      <EdgeRow
        icon={<IconSettings size={19} color={colors.slateDeep} />}
        title="HQ settings"
        subtitle="Business name, admins, update every branch"
        onPress={() => navigation.navigate('Business')}
      />
      {sizeGuide ? (
        <EdgeRow
          icon={<IconCar size={19} color={colors.indigo} />}
          iconBg={colors.indigoPale}
          title="Vehicle size guide"
          subtitle="Which size (S, M, L, XL) every car and bike is priced as"
          onPress={() => navigation.navigate('VehicleGuide')}
        />
      ) : null}
      {errorLog ? (
        <EdgeRow
          icon={<IconBug size={19} color={colors.slateDeep} />}
          iconBg="#F1F5F9"
          title="Error log"
          subtitle={unseenErrors > 0 ? `${unseenErrors} new since you last looked` : 'App crashes and server errors'}
          right={
            unseenErrors > 0 ? <Pill label={unseenErrors > 99 ? '99+' : String(unseenErrors)} tone="danger" /> : undefined
          }
          onPress={() => navigation.navigate('ErrorLog')}
        />
      ) : null}
    </EdgeGroup>
  );
}
