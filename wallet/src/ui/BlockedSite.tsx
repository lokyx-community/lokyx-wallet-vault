import { View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { T } from './Text';
import { Button } from './controls';
import { Icon } from './Icon';
import { C, F } from './theme';
import { DUR, EASE_OUT } from './motion';

const ROSE = '#D98880';

/** Shown instead of a website that is on a scam list or that the person blocked. The page is never loaded. */
export function BlockedSite({ host, why, onBack, onUnblock }: { host: string; why: 'list' | 'you'; onBack: () => void; onUnblock?: () => void }) {
  return (
    <Animated.View entering={FadeIn.duration(DUR.base)} style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 14 }}>
      <View style={{ width: 84, height: 84, borderRadius: 42, borderWidth: 3, borderColor: ROSE, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(217,136,128,0.14)' }}>
        <Icon name="close" size={30} color={ROSE} width={2.4} />
      </View>
      <T style={{ fontFamily: F.semibold, fontSize: 12, letterSpacing: 2.4, color: ROSE }}>BLOCKED</T>
      <Animated.View entering={FadeInDown.delay(150).duration(DUR.slow).easing(EASE_OUT)} style={{ alignItems: 'center', gap: 8 }}>
        <T style={{ fontFamily: F.semibold, fontSize: 26, letterSpacing: -0.8, lineHeight: 31, textAlign: 'center' }}>{why === 'list' ? 'This site is on a scam list' : 'You blocked this site'}</T>
        <T v="sub" style={{ textAlign: 'center', color: C.soft, lineHeight: 21 }}>
          {why === 'list' ? 'Security teams have reported it for stealing coins, so the wallet did not open it.' : 'You told the wallet to block it, so it did not open it.'}
        </T>
        <T v="caption" dim style={{ textAlign: 'center' }} numberOfLines={1}>{host}</T>
      </Animated.View>
      <View style={{ height: 10 }} />
      <View style={{ alignSelf: 'stretch', gap: 8 }}>
        <Button title="Go back" onPress={onBack} />
        {why === 'you' && onUnblock ? <Button title="Unblock this site" kind="plain" onPress={onUnblock} /> : null}
      </View>
    </Animated.View>
  );
}
