export type PushRoute = '/requests' | '/connections' | { pathname: '/connection-detail'; params: { connectionId: string } };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export async function notificationRoute(data: unknown, authorize: (id: string) => Promise<boolean>): Promise<PushRoute | null> {
  if(!data || typeof data !== 'object') return null;
  const value = data as Record<string,unknown>;
  if(value.type === 'connection_request') return '/requests';
  if(value.type === 'connection_accepted') return '/connections';
  if(value.type === 'new_message' && typeof value.connection_id === 'string' && uuid.test(value.connection_id)
      && await authorize(value.connection_id)) return { pathname:'/connection-detail',params:{connectionId:value.connection_id} };
  return null;
}
export interface Registration {
  supported: boolean;
  projectId?: string;
  android: boolean;
  channel(): Promise<unknown>;
  permission(): Promise<{granted:boolean;canAskAgain:boolean}>;
  ask(): Promise<{granted:boolean}>;
  token(projectId:string): Promise<string>;
  register(token:string): Promise<void>;
  unregister(token:string): Promise<void>;
}
// One controller per authenticated lifecycle. Rotation re-fetches an Expo token
// (the native token-change event itself contains an APNs/FCM token).
export function createPushRegistration(api: Registration) {
  let stopped=false, current: string | null=null;
  let work=Promise.resolve();
  function refresh() {
    work=work.then(async()=>{
      if(stopped || !api.supported || !api.projectId) return;
      try {
        if(api.android) await api.channel();
        let permission=await api.permission();
        if(!permission.granted && permission.canAskAgain && !stopped) permission={...permission,...await api.ask()};
        if(!permission.granted || stopped) return;
        const token=await api.token(api.projectId);
        if(stopped) return;
        const old=current;
        await api.register(token);
        current=token;
        if(old && old!==token) await api.unregister(old);
      } catch { /* Push never prevents normal app use. */ }
    });
    return work;
  }
  return { refresh, stop(){stopped=true;}, async unregister(){
    stopped=true;
    await work;
    const token=current;current=null;
    if(token) { try { await api.unregister(token); } catch { /* Logout still succeeds. */ } }
  } };
}
let cleanup: (()=>Promise<void>) | null = null;
export function setPushCleanup(fn: ()=>Promise<void>) {
  cleanup=fn;
  return ()=>{if(cleanup===fn)cleanup=null;};
}
export async function unregisterPushForLogout() {
  const fn=cleanup; cleanup=null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([fn?.(),new Promise<void>(resolve=>{timer=setTimeout(resolve,6000);})]); }
  catch { /* Best effort only. */ }
  finally { clearTimeout(timer); }
}
