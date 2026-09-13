import { Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';

// Route groups preserve /discovery, /connections, /requests and /edit-profile.
export default function AuthenticatedTabs() {
  return (
    <Tabs initialRouteName="discovery" backBehavior="initialRoute" screenOptions={{
      headerShown: false,
      lazy: true,
      tabBarHideOnKeyboard: true,
      tabBarActiveTintColor: '#253D2F',
      tabBarInactiveTintColor: '#7A817A',
      tabBarStyle: { backgroundColor: '#FEFCF8', borderTopColor: '#E5E2DA', elevation: 0 },
      tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      tabBarLabelPosition: 'below-icon',
      sceneStyle: { backgroundColor: '#FEFCF8' },
    }}>
      <Tabs.Screen name="discovery" options={{ title: 'Discovery', tabBarIcon: ({ color }) => (
        <SymbolView name={{ ios: 'safari', android: 'explore', web: 'explore' }} tintColor={color} size={23} />
      ) }} />
      <Tabs.Screen name="connections" options={{ title: 'Connections', tabBarIcon: ({ color }) => (
        <SymbolView name={{ ios: 'person.2', android: 'group', web: 'group' }} tintColor={color} size={23} />
      ) }} />
      <Tabs.Screen name="requests" options={{ title: 'Requests', tabBarIcon: ({ color }) => (
        <SymbolView name={{ ios: 'envelope', android: 'mail', web: 'mail' }} tintColor={color} size={23} />
      ) }} />
      <Tabs.Screen name="edit-profile" options={{ title: 'Profile', tabBarIcon: ({ color }) => (
        <SymbolView name={{ ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' }} tintColor={color} size={23} />
      ) }} />
    </Tabs>
  );
}
