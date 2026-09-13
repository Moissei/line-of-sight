import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';

const phrase = 'Seize the moment.';

export function DiscoveryWindHeadline({ fontSize }: { fontSize: number }) {
  const [progress] = useState(() => new Animated.Value(0));
  useFocusEffect(useCallback(() => {
    let disposed = false;
    let changed = false;
    let animation: Animated.CompositeAnimation | undefined;
    const update = (reduced: boolean) => {
      animation?.stop();
      progress.setValue(0);
      if (disposed || reduced) return;
      animation = Animated.loop(Animated.sequence([
        Animated.delay(3600),
        Animated.timing(progress, { toValue: 1, duration: 1400, easing: Easing.linear, useNativeDriver: true }),
      ]));
      animation.start();
    };
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', value => { changed = true; update(value); });
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (!disposed && !changed) update(value);
    }).catch(() => { /* Static if the setting cannot be read. */ });
    return () => { disposed = true; listener.remove(); animation?.stop(); progress.setValue(0); };
  }, [progress]));

  return <View accessible accessibilityRole="header" accessibilityLabel={phrase} style={styles.row}>
    {Array.from(phrase).map((letter, index) => {
      const start = index * 60 / 1400;
      const middle = start + 250 / 1400;
      const end = start + 500 / 1400;
      return <Animated.Text key={index} accessible={false} style={[styles.letter, { fontSize,
        transform: [{ translateY: progress.interpolate({
          inputRange: [start, start + 125 / 1400, middle, middle + 125 / 1400, end],
          outputRange: [0, -1, -2, -1, 0], extrapolate: 'clamp',
        }) }],
      }]}>{letter === ' ' ? '\u00a0' : letter}</Animated.Text>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', alignSelf: 'center' },
  letter: { fontWeight: '600', letterSpacing: -0.6, color: '#202D25', textAlign: 'center' },
});
