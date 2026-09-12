import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { supabase } from './supabase';
import { loadConnections } from './connections';
import { createPushRegistration, notificationRoute, setPushCleanup } from './push-notifications';

export function usePushNotifications(signedIn: boolean, generation: number) {
  const router=useRouter();
  useEffect(()=>{
    if(!signedIn || Platform.OS==='web' || !Device.isDevice || Constants.executionEnvironment==='storeClient') return;
    let stopped=false;
    let dispose=()=>{};
    const abort=new AbortController();
    void (async()=>{
      try {
        const notifications=await import('expo-notifications');
        if(stopped)return;
        notifications.setNotificationHandler({handleNotification:async()=>({shouldShowBanner:true,shouldShowList:true,shouldPlaySound:true,shouldSetBadge:false})});
        const projectId=Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
        async function deviceRpc(name:string,token:string) {
          const {error}=await supabase.rpc(name,{expo_token:token}).abortSignal(AbortSignal.timeout(5000));
          if(error)throw Error('Unavailable');
        }
        const registration=createPushRegistration({supported:true,projectId,android:Platform.OS==='android',
          channel:()=>notifications.setNotificationChannelAsync('default',{name:'Connections and messages',importance:notifications.AndroidImportance.DEFAULT}),
          permission:()=>notifications.getPermissionsAsync(),ask:()=>notifications.requestPermissionsAsync(),
          token:async id=>(await notifications.getExpoPushTokenAsync({projectId:id})).data,
          register:token=>deviceRpc('register_push_device',token),unregister:token=>deviceRpc('unregister_push_device',token),
        });
        const clearCleanup=setPushCleanup(()=>registration.unregister());
        const rotation=notifications.addPushTokenListener(()=>{void registration.refresh();});
        const handled=new Set<string>();
        async function respond(response: import('expo-notifications').NotificationResponse) {
          const id=response.notification.request.identifier;
          if(stopped || handled.has(id))return;
          handled.add(id);
          try {
            const route=await notificationRoute(response.notification.request.content.data,async connectionId=>
              (await loadConnections(abort.signal)).some(c=>c.connection_id===connectionId));
            if(!stopped && route)router.push(route);
          } catch { /* Stale/unauthorized notification does not open a chat. */ }
          finally { if(!stopped)void notifications.clearLastNotificationResponseAsync().catch(()=>{}); }
        }
        const responses=notifications.addNotificationResponseReceivedListener(response=>{void respond(response);});
        dispose=()=>{registration.stop();clearCleanup();rotation.remove();responses.remove();};
        void registration.refresh();
        const last=await notifications.getLastNotificationResponseAsync();
        if(last && !stopped)await respond(last);
      } catch { /* Unsupported native runtime or permission/registration failure. */ }
    })();
    return ()=>{stopped=true;abort.abort();dispose();};
  },[signedIn,generation,router]);
}
