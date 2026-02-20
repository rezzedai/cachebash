import React from 'react';
import { View, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ParamListBase } from '@react-navigation/native';

import HomeScreen from '../screens/HomeScreen';
import MessagesScreen from '../screens/MessagesScreen';
import TasksScreen from '../screens/TasksScreen';
import SettingsScreen from '../screens/SettingsScreen';
import ProgramDetailScreen from '../screens/ProgramDetailScreen';
import ChannelDetailScreen from '../screens/ChannelDetailScreen';
import TaskDetailScreen from '../screens/TaskDetailScreen';

const Tab = createBottomTabNavigator();
const HomeStack = createNativeStackNavigator<ParamListBase>();
const MessagesStack = createNativeStackNavigator<ParamListBase>();
const TasksStack = createNativeStackNavigator<ParamListBase>();
const SettingsStack = createNativeStackNavigator<ParamListBase>();

// Tab icon component with distinct Unicode symbols
function TabIcon({ routeName, focused }: { routeName: string; focused: boolean }) {
  const color = focused ? '#00d4ff' : '#6b7280';

  const icons: Record<string, string> = {
    Home: '⬡',      // hexagon for grid/dashboard
    Messages: '◈',   // diamond for messages
    Tasks: '☰',      // hamburger for task list
    Settings: '⚙',   // gear for settings
  };

  return (
    <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 18, color, lineHeight: 24 }}>
        {icons[routeName] || '●'}
      </Text>
    </View>
  );
}

// Stack navigators for each tab
function HomeStackScreen() {
  return (
    <HomeStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: '#0a0a0f' },
        headerTintColor: '#f0f0f5',
        headerShadowVisible: false,
      }}
    >
      <HomeStack.Screen name="HomeMain" component={HomeScreen} options={{ headerShown: false }} />
      <HomeStack.Screen name="ProgramDetail" component={ProgramDetailScreen} options={{ title: 'Program' }} />
    </HomeStack.Navigator>
  );
}

function MessagesStackScreen() {
  return (
    <MessagesStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: '#0a0a0f' },
        headerTintColor: '#f0f0f5',
        headerShadowVisible: false,
      }}
    >
      <MessagesStack.Screen name="MessagesMain" component={MessagesScreen} options={{ title: 'Messages' }} />
      <MessagesStack.Screen name="ChannelDetail" component={ChannelDetailScreen} options={{ title: 'Channel' }} />
    </MessagesStack.Navigator>
  );
}

function TasksStackScreen() {
  return (
    <TasksStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: '#0a0a0f' },
        headerTintColor: '#f0f0f5',
        headerShadowVisible: false,
      }}
    >
      <TasksStack.Screen name="Tasks" component={TasksScreen} options={{ title: 'Tasks' }} />
      <TasksStack.Screen name="TaskDetail" component={TaskDetailScreen} options={{ title: 'Task' }} />
    </TasksStack.Navigator>
  );
}

function SettingsStackScreen() {
  return (
    <SettingsStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: '#0a0a0f' },
        headerTintColor: '#f0f0f5',
        headerShadowVisible: false,
      }}
    >
      <SettingsStack.Screen name="SettingsMain" component={SettingsScreen} options={{ title: 'Settings' }} />
    </SettingsStack.Navigator>
  );
}

export default function AppNavigation() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarIcon: ({ focused }) => <TabIcon routeName={route.name} focused={focused} />,
          tabBarShowLabel: true,
          tabBarStyle: {
            backgroundColor: '#0a0a0f',
            borderTopColor: '#1a1a24',
            height: 60,
            paddingBottom: 8,
            paddingTop: 8,
          },
          tabBarActiveTintColor: '#00d4ff',
          tabBarInactiveTintColor: '#6b7280',
          headerShown: false,
        })}
      >
        <Tab.Screen name="Home" component={HomeStackScreen} />
        <Tab.Screen name="Messages" component={MessagesStackScreen} />
        <Tab.Screen name="Tasks" component={TasksStackScreen} />
        <Tab.Screen name="Settings" component={SettingsStackScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
