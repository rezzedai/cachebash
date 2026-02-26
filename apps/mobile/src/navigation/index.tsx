import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
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
import CreateTaskScreen from '../screens/CreateTaskScreen';
import SprintsScreen from '../screens/SprintsScreen';
import SprintDetailScreen from '../screens/SprintDetailScreen';
import FleetHealthScreen from '../screens/FleetHealthScreen';
import UsageScreen from '../screens/UsageScreen';
import KeyManagementScreen from '../screens/KeyManagementScreen';
import ComposeMessageScreen from '../screens/ComposeMessageScreen';
import { useTasks } from '../hooks/useTasks';
import { useMessages } from '../hooks/useMessages';

const Tab = createBottomTabNavigator();
const HomeStack = createNativeStackNavigator<ParamListBase>();
const MessagesStack = createNativeStackNavigator<ParamListBase>();
const TasksStack = createNativeStackNavigator<ParamListBase>();
const SettingsStack = createNativeStackNavigator<ParamListBase>();

// View-based tab icons — render consistently across all devices
function HomeIcon({ color }: { color: string }) {
  return (
    <View style={iconStyles.container}>
      <View style={[iconStyles.homeBase, { borderColor: color }]} />
      <View style={[iconStyles.homeRoof, { borderBottomColor: color }]} />
    </View>
  );
}

function MessagesIcon({ color }: { color: string }) {
  return (
    <View style={iconStyles.container}>
      <View style={[iconStyles.messageBubble, { borderColor: color }]}>
        <View style={iconStyles.messageDots}>
          <View style={[iconStyles.dot, { backgroundColor: color }]} />
          <View style={[iconStyles.dot, { backgroundColor: color }]} />
          <View style={[iconStyles.dot, { backgroundColor: color }]} />
        </View>
      </View>
    </View>
  );
}

function TasksIcon({ color }: { color: string }) {
  return (
    <View style={iconStyles.container}>
      <View style={iconStyles.taskLines}>
        <View style={[iconStyles.taskLine, { backgroundColor: color }]} />
        <View style={[iconStyles.taskLine, { backgroundColor: color, width: 12 }]} />
        <View style={[iconStyles.taskLine, { backgroundColor: color, width: 9 }]} />
      </View>
    </View>
  );
}

function SettingsIcon({ color }: { color: string }) {
  return (
    <View style={iconStyles.container}>
      <View style={[iconStyles.gear, { borderColor: color }]}>
        <View style={[iconStyles.gearCenter, { backgroundColor: color }]} />
      </View>
    </View>
  );
}

// Badge component for tab bar
function TabBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <View style={iconStyles.badge}>
      <Text style={iconStyles.badgeText}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

function TabIcon({ routeName, focused, badge }: { routeName: string; focused: boolean; badge?: number }) {
  const color = focused ? '#00d4ff' : '#6b7280';

  let icon;
  switch (routeName) {
    case 'Home': icon = <HomeIcon color={color} />; break;
    case 'Messages': icon = <MessagesIcon color={color} />; break;
    case 'Tasks': icon = <TasksIcon color={color} />; break;
    case 'Settings': icon = <SettingsIcon color={color} />; break;
    default: icon = <View style={[iconStyles.dot, { backgroundColor: color, width: 6, height: 6 }]} />;
  }

  return (
    <View style={iconStyles.iconWrapper}>
      {icon}
      {badge !== undefined && <TabBadge count={badge} />}
    </View>
  );
}

const iconStyles = StyleSheet.create({
  container: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  iconWrapper: { width: 28, height: 24, alignItems: 'center', justifyContent: 'center' },
  // Home icon
  homeBase: { width: 14, height: 10, borderWidth: 1.5, borderRadius: 2, position: 'absolute', bottom: 2 },
  homeRoof: { width: 0, height: 0, borderLeftWidth: 10, borderRightWidth: 10, borderBottomWidth: 8, borderLeftColor: 'transparent', borderRightColor: 'transparent', position: 'absolute', top: 1 },
  // Messages icon
  messageBubble: { width: 18, height: 14, borderWidth: 1.5, borderRadius: 4 },
  messageDots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', flex: 1, gap: 2 },
  dot: { width: 2, height: 2, borderRadius: 1 },
  // Tasks icon
  taskLines: { gap: 3, alignItems: 'flex-start' },
  taskLine: { height: 2, width: 15, borderRadius: 1 },
  // Settings icon
  gear: { width: 16, height: 16, borderWidth: 1.5, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  gearCenter: { width: 4, height: 4, borderRadius: 2 },
  // Badge
  badge: { position: 'absolute', top: -4, right: -6, backgroundColor: '#ef4444', borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText: { fontSize: 9, fontWeight: '700', color: '#fff' },
});

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
      <HomeStack.Screen name="ChannelDetail" component={ChannelDetailScreen} options={{ title: 'Channel' }} />
      <HomeStack.Screen name="CreateTask" component={CreateTaskScreen} options={{ title: 'Create Task' }} />
      <HomeStack.Screen name="TaskDetail" component={TaskDetailScreen} options={{ title: 'Task' }} />
      <HomeStack.Screen name="Sprints" component={SprintsScreen} options={{ title: 'Sprints' }} />
      <HomeStack.Screen name="SprintDetail" component={SprintDetailScreen} options={{ title: 'Sprint' }} />
      <HomeStack.Screen name="FleetHealth" component={FleetHealthScreen} options={{ title: 'Fleet Health' }} />
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
      <MessagesStack.Screen
        name="MessagesMain"
        component={MessagesScreen}
        options={({ navigation: nav }) => ({
          title: 'Messages',
          headerRight: () => (
            <View style={{ flexDirection: 'row', gap: 12, marginRight: 4 }}>
              <Text
                style={{ fontSize: 22, color: '#00d4ff', fontWeight: '600' }}
                onPress={() => nav.navigate('ComposeMessage')}
                accessibilityLabel="New message"
                accessibilityRole="button"
              >+</Text>
            </View>
          ),
        })}
      />
      <MessagesStack.Screen name="ChannelDetail" component={ChannelDetailScreen} options={{ title: 'Channel' }} />
      <MessagesStack.Screen name="ComposeMessage" component={ComposeMessageScreen} options={{ title: 'New Message' }} />
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
      <TasksStack.Screen name="CreateTask" component={CreateTaskScreen} options={{ title: 'Create Task' }} />
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
      <SettingsStack.Screen name="Usage" component={UsageScreen} options={{ title: 'Usage' }} />
      <SettingsStack.Screen name="KeyManagement" component={KeyManagementScreen} options={{ title: 'API Keys' }} />
    </SettingsStack.Navigator>
  );
}

export default function AppNavigation() {
  const { pendingCount } = useTasks();
  const { unreadCount } = useMessages();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused }) => {
          let badge: number | undefined;
          if (route.name === 'Messages') badge = unreadCount;
          if (route.name === 'Tasks') badge = pendingCount;
          return <TabIcon routeName={route.name} focused={focused} badge={badge} />;
        },
        tabBarShowLabel: true,
        tabBarStyle: {
          backgroundColor: '#0a0a0f',
          borderTopColor: '#1a1a24',
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
  );
}
