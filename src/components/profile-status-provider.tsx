import { useOnboarding } from '@/components/onboarding-provider';
import { PROFILE_INTENTS } from '@/lib/profile';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { hasRequiredProfile, type ProfileStatus } from '@/lib/profile-status';
const Context = createContext<{ status: ProfileStatus; refresh: () => Promise<void> } | null>(null);
export function ProfileStatusProvider({ userId, children }: { userId: string | null; children: ReactNode }) {
  const { setDraft } = useOnboarding();
  const [result, setResult] = useState<{ owner: string | null; status: ProfileStatus }>({ owner: null, status: 'loading' });
  const request = useRef<AbortController | null>(null);
  const owner = useRef(userId);
  useEffect(() => { owner.current = userId; }, [userId]);
  const refresh = useCallback(async () => {
    request.current?.abort();
    const abort = new AbortController(); request.current = abort;
    setResult({ owner: userId, status: 'loading' });
    if (!userId) return;
    try {
      const { data, error } = await supabase.from('profiles').select('first_name,date_of_birth,gender,bio,intents')
        .eq('user_id', userId).abortSignal(abort.signal).maybeSingle();
      if (error) throw new Error('Profile check unavailable');
      if (!abort.signal.aborted && owner.current === userId) {
        const complete = hasRequiredProfile(data);
        if (!complete && data) {
          const parts = typeof data.date_of_birth === 'string' ? data.date_of_birth.split('-') : [];
          setDraft(previous => ({ ...previous,
            firstName: typeof data.first_name === 'string' ? data.first_name : '',
            dateOfBirth: parts.length === 3 ? parts[1] + '/' + parts[2] + '/' + parts[0] : '',
            gender: typeof data.gender === 'string' ? data.gender : '', bio: typeof data.bio === 'string' ? data.bio : '',
            intents: PROFILE_INTENTS.filter(intent => Array.isArray(data.intents) && data.intents.includes(intent)),
          }));
        }
        setResult({ owner: userId, status: complete ? 'complete' : 'required' });
      }
    } catch {
      if (!abort.signal.aborted && owner.current === userId) setResult({ owner: userId, status: 'error' });
    }
  }, [userId, setDraft]);
  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => { if (!disposed) void refresh(); });
    return () => { disposed = true; request.current?.abort(); };
  }, [refresh]);
  return <Context.Provider value={{ status: result.owner === userId ? result.status : 'loading', refresh }}>{children}</Context.Provider>;
}
export function useProfileStatus() {
  const value = useContext(Context);
  if (!value) throw new Error('Profile status provider required');
  return value;
}
