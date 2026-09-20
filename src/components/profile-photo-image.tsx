import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

type Source = { uri: string; expiresAt: number };
const same = (a: Source | null, b: Source) => a?.uri === b.uri && a.expiresAt === b.expiresAt;

// Keep the loaded native view mounted while its replacement decodes underneath it.
export function ProfilePhotoImage({ uri, expiresAt, onFailure }: Source & { onFailure: (uri: string) => void }) {
  const target = { uri, expiresAt };
  const latest = useRef(target);
  useLayoutEffect(() => { latest.current = { uri, expiresAt }; }, [uri, expiresAt]);
  const mounted = useRef(true);
  const [displayed, setDisplayed] = useState<Source | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const deadlines = [expiresAt, displayed?.expiresAt].filter((value): value is number => value !== undefined && value > Date.now());
    if (!deadlines.length) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, Math.min(...deadlines) - Date.now()));
    return () => clearTimeout(timer);
  });
  const visible = displayed && displayed.expiresAt > now ? displayed : null;
  const layers = visible ? [visible] : [];
  if (expiresAt > now && !same(visible, target)) layers.push(target);
  return <View style={styles.frame}>
    {layers.map(source => <Image key={`${source.uri}:${source.expiresAt}`}
      source={{ uri: source.uri }} resizeMode="cover" fadeDuration={0}
      accessible={same(visible, source)} accessibilityLabel="Your profile photo"
      style={[StyleSheet.absoluteFill, { opacity: same(visible, source) ? 1 : 0 }]}
      onLoad={() => {
        if (mounted.current && same(latest.current, source) && source.expiresAt > Date.now()) setDisplayed(source);
      }}
      onError={() => {
        if (!mounted.current) return;
        if (same(latest.current, source)) onFailure(source.uri);
        setDisplayed(current => same(current, source) ? null : current);
      }} />)}
  </View>;
}
const styles = StyleSheet.create({ frame: { width: '100%', height: '100%' } });
