import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';

export function DiscoverySearchState({ compact }: { compact: boolean }) {
  const [pulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    let disposed = false;
    let changed = false;
    let animation: Animated.CompositeAnimation | undefined;
    function update(reduced: boolean) {
      animation?.stop();
      pulse.setValue(0);
      if (disposed || reduced) return;
      animation = Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]));
      animation.start();
    }
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', value => { changed = true; update(value); });
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (!disposed && !changed) update(value);
    }).catch(() => { /* Remain static if the accessibility setting is unavailable. */ });
    return () => { disposed = true; listener.remove(); animation?.stop(); };
  }, [pulse]);

  const size = compact ? 88 : 124;
  return <View style={styles.content}>
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[styles.radar, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.65, 0.4] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }]}>
        {[1, 0.68, 0.36].map((ratio, index) => <View key={ratio} style={[styles.ring, { width: size * ratio, height: size * ratio, borderRadius: size, borderColor: index === 1 ? '#B5A47C' : '#667F6A' }]} />)}
      </Animated.View>
      <View style={styles.center} />
    </View>
    <Text style={styles.title}>Looking nearby</Text>
    <Text style={styles.description}>Keep Line of Sight open. People who are also looking nearby will appear here.</Text>
  </View>;
}

const styles = StyleSheet.create({
  content: { width: '100%', alignItems: 'center', gap: 12, paddingVertical: 8 },
  radar: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', borderWidth: 1 },
  center: { position: 'absolute', width: 5, height: 5, borderRadius: 3, backgroundColor: '#253D2F' },
  title: { color: '#253D2F', fontSize: 19, fontWeight: '600', textAlign: 'center' },
  description: { maxWidth: 300, color: '#656D66', fontSize: 15, lineHeight: 22, textAlign: 'center' },
});
