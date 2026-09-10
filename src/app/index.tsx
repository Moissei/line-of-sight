import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

export default function WelcomeScreen() {
  const router = useRouter();
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const availableHeight = height - insets.top - insets.bottom;
  const compact = availableHeight < 600;
  const short = availableHeight < 400;
  const titleWidth = Math.min(width - insets.left - insets.right, 528) - 8;
  // Leave room for Tangerine's flourishes and retain the existing size on wider screens.
  const titleSize = Math.min(short ? 44 : compact ? 56 : 64, (titleWidth - 24) / 6);
  const taglineSize = short ? 14 : 17;
  const taglineLineHeight = short ? 20 : 26;
  const buttonHeight = compact ? 48 : 58;
  const spacing = compact ? 8 : 16;
  const eyeGap = compact ? 4 : 8;
  const eyeFrameRatio = 0.245;
  // Reserve room for text and both actions before sizing the decorative artwork.
  const imageHeightBudget = Math.max(0, availableHeight - (
    2 * spacing + 2 * buttonHeight + 12 + 2 * spacing + eyeGap +
    titleSize * 1.15 * fontScale + 2 * taglineLineHeight * fontScale
  ));
  const imageWidth = Math.max(0, Math.min(
    width - insets.left - insets.right - 8,
    520,
    imageHeightBudget / eyeFrameRatio,
  ));

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={[styles.content, { paddingVertical: spacing }]}>
        <View style={styles.hero}>
          <View style={[styles.eyeFrame, { width: imageWidth, height: imageWidth * eyeFrameRatio, marginBottom: eyeGap }]}>
            <Image
              source={require('@/assets/images/eyechico.png')}
              style={[styles.eyeImage, {
                width: imageWidth,
                height: imageWidth * 1066 / 1476,
                top: -imageWidth * 330 / 1476,
              }]}
              resizeMode="contain"
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
          </View>
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.5}
            style={[styles.title, { fontSize: titleSize, lineHeight: titleSize * 1.15 }]}>
            Line of Sight
          </Text>
          <Text style={[styles.tagline, { fontSize: taglineSize, lineHeight: taglineLineHeight, marginTop: spacing }]}>
            You noticed them. Maybe they noticed you too.
          </Text>
        </View>

        <View style={[styles.actions, { paddingTop: spacing }]}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/sign-up')}
            style={({ pressed }) => [styles.button, styles.primaryButton, { minHeight: buttonHeight, paddingVertical: compact ? 12 : 18 }, pressed && styles.pressed]}>
            <Text style={[styles.buttonLabel, styles.primaryLabel]}>GET STARTED</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/login')}
            style={({ pressed }) => [styles.button, styles.secondaryButton, { minHeight: buttonHeight, paddingVertical: compact ? 12 : 18 }, pressed && styles.pressed]}>
            <Text style={[styles.buttonLabel, styles.secondaryLabel]}>LOG IN</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Sampled from the PNG's pale cream edges to minimize the rectangular boundary.
  screen: { flex: 1, backgroundColor: '#FEFCF8' },
  content: {
    flex: 1,
    width: '100%',
    maxWidth: 528,
    alignSelf: 'center',
    paddingHorizontal: 4,
  },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Show source rows 330–692: all the eye artwork, without its large blank margins.
  eyeFrame: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  eyeImage: {
    position: 'absolute',
    alignSelf: 'center',
  },
  title: {
    width: '100%',
    alignSelf: 'center',
    flexShrink: 0,
    paddingHorizontal: 12,
    overflow: 'visible',
    fontFamily: 'Tangerine-Bold',
    color: '#202D25',
    textAlign: 'center',
  },
  tagline: {
    maxWidth: 280,
    color: '#656D66',
    textAlign: 'center',
  },
  actions: {
    gap: 12,
    width: '100%',
    maxWidth: 452,
    alignSelf: 'center',
    paddingHorizontal: 24,
  },
  button: {
    minHeight: 58,
    borderRadius: 16,
    paddingHorizontal: 24,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: { backgroundColor: '#253D2F' },
  secondaryButton: { borderWidth: 1, borderColor: '#C9CEC7' },
  buttonLabel: { fontSize: 14, fontWeight: '700', letterSpacing: 1.5 },
  primaryLabel: { color: '#FFFFFF' },
  secondaryLabel: { color: '#253D2F' },
  pressed: { opacity: 0.7 },
});
