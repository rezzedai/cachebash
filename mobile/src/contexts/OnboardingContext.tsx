import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from './AuthContext';

type OnboardingStep = 'welcome' | 'connect-agent' | 'first-task' | 'completion';

interface OnboardingState {
  isFirstRun: boolean;
  isLoading: boolean;
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
}

interface OnboardingContextType extends OnboardingState {
  completeStep: (step: OnboardingStep) => Promise<void>;
  skipOnboarding: () => Promise<void>;
  goToStep: (step: OnboardingStep) => void;
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);

const STEPS: OnboardingStep[] = ['welcome', 'connect-agent', 'first-task', 'completion'];

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const [isFirstRun, setIsFirstRun] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('welcome');
  const [completedSteps, setCompletedSteps] = useState<OnboardingStep[]>([]);

  useEffect(() => {
    async function checkOnboarding() {
      if (!isAuthenticated || !user) {
        setIsLoading(false);
        return;
      }

      try {
        const onboardingDoc = await getDoc(doc(db, `tenants/${user.uid}/config/onboarding`));
        if (onboardingDoc.exists()) {
          const data = onboardingDoc.data();
          if (data.completed) {
            setIsFirstRun(false);
          } else {
            setIsFirstRun(true);
            setCompletedSteps(data.completedSteps || []);
            // Resume from last incomplete step
            const lastCompleted = data.completedSteps || [];
            const nextStep = STEPS.find(s => !lastCompleted.includes(s)) || 'welcome';
            setCurrentStep(nextStep);
          }
        } else {
          // No onboarding doc = first run
          setIsFirstRun(true);
        }
      } catch (error) {
        console.error('Failed to check onboarding status:', error);
        setIsFirstRun(false); // Fail safe — don't block app
      } finally {
        setIsLoading(false);
      }
    }

    checkOnboarding();
  }, [isAuthenticated, user]);

  const completeStep = useCallback(async (step: OnboardingStep) => {
    if (!user) return;

    const newCompleted = [...completedSteps, step];
    setCompletedSteps(newCompleted);

    const stepIndex = STEPS.indexOf(step);
    const nextStep = STEPS[stepIndex + 1];

    if (nextStep) {
      setCurrentStep(nextStep);
    }

    // Check if all steps done
    const allDone = STEPS.every(s => newCompleted.includes(s));

    try {
      await setDoc(doc(db, `tenants/${user.uid}/config/onboarding`), {
        completedSteps: newCompleted,
        completed: allDone,
        completedAt: allDone ? new Date().toISOString() : null,
        updatedAt: new Date().toISOString(),
      }, { merge: true });

      if (allDone) {
        setIsFirstRun(false);
      }
    } catch (error) {
      console.error('Failed to save onboarding progress:', error);
    }
  }, [user, completedSteps]);

  const skipOnboarding = useCallback(async () => {
    if (!user) return;

    try {
      await setDoc(doc(db, `tenants/${user.uid}/config/onboarding`), {
        completed: true,
        skipped: true,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    } catch (error) {
      console.error('Failed to skip onboarding:', error);
    }

    setIsFirstRun(false);
  }, [user]);

  const goToStep = useCallback((step: OnboardingStep) => {
    setCurrentStep(step);
  }, []);

  return (
    <OnboardingContext.Provider
      value={{
        isFirstRun,
        isLoading,
        currentStep,
        completedSteps,
        completeStep,
        skipOnboarding,
        goToStep,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding(): OnboardingContextType {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboarding must be used within an OnboardingProvider');
  }
  return context;
}

export type { OnboardingStep };
