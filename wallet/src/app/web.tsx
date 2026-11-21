import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeOut, LinearTransition } from 'react-native-reanimated';
import { T } from '../ui/Text';
import { Field, Press, Screen } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { C, F } from '../ui/theme';
import { DUR, EASE_OUT } from '../ui/motion';
import { sites, useSites } from '../lib/data';
import { useBookmarks } from '../lib/bookmarks';
import { currentAddress } from '../lib/wallet';
import { toUrl } from '../lib/provider';

const glass = { backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.12)' } as const;
const open = (u: string) => router.push(`/browser?url=${encodeURIComponent(u)}`);

/** The Browser's front door: type or search, your favourite sites, and the sites you have connected to your Apps wallet. */
export default function Web() {
  const [text, setText] = useState('');
  const me = currentAddress();
  const marks = useBookmarks();
  const connected = useSites().filter((s) => s.address === me);
  return (
    <Screen title="Browser">
      <View style={[{ flexDirection: 'row', alignItems: 'center', height: 48, borderRadius: 24, paddingLeft: 16 }, glass]}>
        <Icon name="search" size={18} color={C.sub} width={2} />
        <Field value={text} onChangeText={setText} placeholder="Search or type a website" autoCapitalize="none" autoCorrect={false} keyboardType="web-search" returnKeyType="go" onSubmitEditing={() => text.trim() && open(toUrl(text))} style={{ flex: 1, backgroundColor: 'transparent', height: 48 }} />
      </View>

      <View style={{ gap: 10 }}>
        <T style={{ fontFamily: F.medium, fontSize: 11.5, letterSpacing: 1.8, color: C.sub, paddingLeft: 4 }}>FAVOURITES</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 14, columnGap: 10 }}>
          {marks.map((b) => (
            <Press key={b.url} onPress={() => open(b.url)} scaleTo={0.92} accessibilityLabel={b.title} style={{ width: 70, alignItems: 'center', gap: 7 }}>
              <View style={[{ width: 58, height: 58, borderRadius: 19, alignItems: 'center', justifyContent: 'center' }, glass]}>
                {b.fixed ? <Icon name="globe" size={26} color={C.text} width={1.7} /> : <T style={{ fontFamily: F.semibold, fontSize: 17, letterSpacing: -0.3 }}>{b.title.slice(0, 2).toUpperCase()}</T>}
              </View>
              <T style={{ fontSize: 11.5, color: C.soft }} numberOfLines={1}>{b.title}</T>
            </Press>
          ))}
        </View>
      </View>

      <View style={{ gap: 10 }}>
        <T style={{ fontFamily: F.medium, fontSize: 11.5, letterSpacing: 1.8, color: C.sub, paddingLeft: 4 }}>CONNECTED SITES</T>
        {connected.length === 0 ? (
          <T v="sub" color={C.faint} style={{ paddingHorizontal: 4 }}>Sites you connect to show up here. You can cut them off any time.</T>
        ) : (
          <View style={[{ borderRadius: 26, paddingHorizontal: 16, paddingVertical: 4 }, glass]}>
            {connected.map((s, i) => (
              <Animated.View key={s.origin} exiting={FadeOut} layout={LinearTransition.duration(DUR.base).easing(EASE_OUT)} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 62, borderTopWidth: i ? 0.5 : 0, borderTopColor: 'rgba(255,255,255,0.08)' }}>
                <Press onPress={() => open(s.origin)} accessibilityLabel={`Open ${s.origin}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 }}>
                  <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
                    <T style={{ fontFamily: F.semibold, fontSize: 13 }}>{s.origin.replace(/^https?:\/\/(www\.)?/, '').slice(0, 2).toUpperCase()}</T>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <T v="callout" numberOfLines={1}>{s.origin.replace(/^https?:\/\//, '')}</T>
                    <T v="caption" dim>Can see your address</T>
                  </View>
                </Press>
                <Press onPress={() => sites.save((x) => x.filter((y) => !(y.origin === s.origin && y.address === me)))} accessibilityLabel={`Disconnect ${s.origin}`} style={{ paddingHorizontal: 12, height: 32, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', justifyContent: 'center' }}>
                  <T v="caption" style={{ fontFamily: F.medium }}>Disconnect</T>
                </Press>
              </Animated.View>
            ))}
          </View>
        )}
      </View>
    </Screen>
  );
}
