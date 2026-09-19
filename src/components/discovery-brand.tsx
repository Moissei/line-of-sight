import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, StyleSheet, View } from 'react-native';

export function DiscoveryBrand({ active, width, fontSize, compact }: { active: boolean; width: number; fontSize: number; compact: boolean }) {
  const [fade] = useState(() => new Animated.Value(1));
  const [signal] = useState(() => new Animated.Value(0));
  const [leftPupil] = useState(() => new Animated.Value(0));
  const [rightPupil] = useState(() => new Animated.Value(0));
  useFocusEffect(useCallback(() => {
    let disposed = false;
    let changed = false;
    let fading: Animated.CompositeAnimation | undefined;
    let traveling: Animated.CompositeAnimation | undefined;
    function update(reduced: boolean) {
      fading?.stop(); traveling?.stop();
      fade.setValue(1); signal.setValue(0);
      leftPupil.setValue(0); rightPupil.setValue(0);
      if (disposed || reduced) return;
      fading = Animated.loop(Animated.sequence([
        Animated.timing(fade, { toValue: 0.55, duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
        Animated.timing(fade, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
      ]));
      fading.start();
      if (active) {
        const illuminate = (eye: Animated.Value) => Animated.sequence([
          Animated.timing(eye, { toValue: 0.85, duration: 200, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
          Animated.timing(eye, { toValue: 0, duration: 200, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
        ]);
        traveling = Animated.loop(Animated.sequence([
          // Sequence.reset() only resets its first child after completion.
          // Reset the signal explicitly; both pupils already finish at zero.
          Animated.timing(signal, { toValue: 0, duration: 0, useNativeDriver: true, isInteraction: false }),
          illuminate(leftPupil),
          Animated.timing(signal, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
          illuminate(rightPupil),
          Animated.delay(300),
          Animated.timing(signal, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
          // The next cycle lights the left pupil on arrival before sending again.
          Animated.delay(100),
        ]));
        traveling.start();
      }
    }
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', value => { changed = true; update(value); });
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (!disposed && !changed) update(value);
    }).catch(() => { /* Default to full-opacity, static artwork. */ });
    return () => { disposed = true; listener.remove(); fading?.stop(); traveling?.stop(); };
  }, [active, fade, signal, leftPupil, rightPupil]));

  return <View style={[styles.brand, { gap: compact ? 12 : 20, paddingTop: compact ? 8 : 24 }]}>
    <Animated.Text accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}
      style={[styles.title, { fontSize, lineHeight: fontSize * 1.15, opacity: fade }]}>
      Seize the moment.
    </Animated.Text>
    {/* Exact Welcome asset and crop: source rows 330–692, unchanged image. */}
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={[styles.eyeFrame, { width, height: width * 0.245 }]}>
      <Image source={require('@/assets/images/eyechico.png')} resizeMode="contain" accessible={false}
        style={{ position: 'absolute', width, height: width * 1066 / 1476, top: -width * 330 / 1476 }} />
      {/* Masks cover the baked-in star, arcs and dot ornaments.
          Their source-image bounds avoid both eyes and eyebrows. */}
      {[{ x: 580, y: 430, w: 330, h: 235 }, { x: 460, y: 530, w: 560, h: 28 }].map(({ x, y, w, h }) => (
        <View key={x} pointerEvents="none" style={{ position: 'absolute',
          left: width * x / 1476, top: width * (y - 330) / 1476,
          width: width * w / 1476, height: width * h / 1476, backgroundColor: '#FEFCF8',
        }} />
      ))}
      {[0.325, 0.345, 0.365, 0.635, 0.655, 0.675].map(x => <View key={x} pointerEvents="none" style={{
        position: 'absolute', left: width * x - 1.5, top: width * 213 / 1476 - 1,
        width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#B59962',
      }} />)}
      {/* Pupils are baked into the PNG. Small opacity-only overlays leave it intact. */}
      {active && [{ x: 347, y: 538, opacity: leftPupil }, { x: 1130, y: 550, opacity: rightPupil }].map(({ x, y, opacity }) => (
        <Animated.View key={x} pointerEvents="none" style={{ position: 'absolute',
          left: width * (x - 18) / 1476, top: width * (y - 330 - 18) / 1476,
          width: width * 36 / 1476, height: width * 36 / 1476, borderRadius: width * 18 / 1476,
          backgroundColor: '#D6B66F', opacity,
        }} />
      ))}
      {<View pointerEvents="none" style={{ position: 'absolute', left: width * 0.32, top: width * 213 / 1476, width: width * 0.36, height: 1, backgroundColor: 'rgba(181, 153, 98, 0.35)' }}>
        {active && <Animated.View style={[styles.signal, {
          opacity: signal.interpolate({ inputRange: [0, 0.15, 0.85, 1], outputRange: [0, 0.7, 0.7, 0] }),
          transform: [{ translateX: signal.interpolate({ inputRange: [0, 1], outputRange: [0, Math.max(0, width * 0.36 - 12)] }) }],
        }]} />}
      </View>}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  brand: { alignItems: 'center', flexShrink: 0, paddingBottom: 12 },
  title: { width: '100%', fontFamily: 'Tangerine-Bold', color: '#202D25', textAlign: 'center' },
  eyeFrame: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  signal: { position: 'absolute', top: -1, width: 12, height: 3, borderRadius: 2, backgroundColor: '#A9894D' },
});
