import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { emptyProfileDraft, type ProfileDraft } from '@/lib/profile';

function useDraftState() {
  const [draft, setDraft] = useState<ProfileDraft>(emptyProfileDraft);
  return { draft, setDraft };
}
const OnboardingContext = createContext<ReturnType<typeof useDraftState> | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const state = useDraftState();
  const { setDraft } = state;
  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    let previousUser: string | null | undefined;
    void import('@/lib/supabase').then(({ supabase }) => {
      if (disposed) return;
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        const nextUser = session?.user.id ?? null;
        if (previousUser !== undefined && previousUser !== nextUser) setDraft(emptyProfileDraft);
        previousUser = nextUser;
      });
      unsubscribe = () => data.subscription.unsubscribe();
    }).catch(() => { /* The save flow reports configuration errors without logging data. */ });
    return () => { disposed = true; unsubscribe?.(); };
  }, [setDraft]);
  return <OnboardingContext.Provider value={state}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) throw new Error('OnboardingProvider is required');
  return context;
}
