import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import WelcomeScreen from '../screens/onboarding/WelcomeScreen';
import ConnectAgentScreen from '../screens/onboarding/ConnectAgentScreen';
import FirstTaskScreen from '../screens/onboarding/FirstTaskScreen';
import CompletionScreen from '../screens/onboarding/CompletionScreen';

const Stack = createNativeStackNavigator();

export default function OnboardingNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: '#0a0a0f' },
      }}
    >
      <Stack.Screen name="Welcome" component={WelcomeScreen} />
      <Stack.Screen name="ConnectAgent" component={ConnectAgentScreen} />
      <Stack.Screen name="FirstTask" component={FirstTaskScreen} />
      <Stack.Screen name="Completion" component={CompletionScreen} />
    </Stack.Navigator>
  );
}
