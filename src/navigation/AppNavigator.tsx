import { colors } from '../theme/colors';
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { PlatformPressable } from '@react-navigation/elements';
import type { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import { View, Text } from 'react-native';
import BookshelfScreen from '../screens/BookshelfScreen';
import SettingsScreen from '../screens/SettingsScreen';
import BookNotesScreen from '../screens/BookNotesScreen';
import StatsScreen from '../screens/StatsScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

// Tab Icons
const BookIcon = ({ focused }: { focused: boolean }) => (
  <View style={{ width: 26, height: 26, justifyContent: 'center', alignItems: 'center' }}>
    <View style={{ width: 18, height: 22, borderRadius: 2, borderWidth: 1.8, borderColor: focused ? colors.primary : '#999', borderLeftWidth: 3, borderLeftColor: focused ? colors.primary : '#999' }} />
  </View>
);

const StatsIcon = ({ focused }: { focused: boolean }) => (
  <View style={{ width: 26, height: 26, justifyContent: 'center', alignItems: 'center' }}>
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 22 }}>
      <View style={{ width: 5, height: 10, borderRadius: 1.5, backgroundColor: focused ? colors.primary : '#999' }} />
      <View style={{ width: 5, height: 14, borderRadius: 1.5, backgroundColor: focused ? colors.primary : '#999' }} />
      <View style={{ width: 5, height: 19, borderRadius: 1.5, backgroundColor: focused ? colors.primary : '#999' }} />
    </View>
  </View>
);

const SettingsIcon = ({ focused }: { focused: boolean }) => (
  <View style={{ width: 26, height: 26, justifyContent: 'center', alignItems: 'center' }}>
    <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 1.8, borderColor: focused ? colors.primary : '#999', justifyContent: 'center', alignItems: 'center' }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, borderWidth: 1.5, borderColor: focused ? colors.primary : '#999' }} />
    </View>
  </View>
);

// Bookshelf Stack: Bookshelf → BookNotes
function BookshelfStack() {
  return (
    <Stack.Navigator screenOptions={{
      headerShown: false,
      contentStyle: { backgroundColor: colors.bg },
      animation: 'none',
    }}>
      <Stack.Screen name="BookshelfMain" component={BookshelfScreen} />
      <Stack.Screen name="BookNotes" component={BookNotesScreen} />
    </Stack.Navigator>
  );
}

// Stats Stack (standalone tab)
function StatsStack() {
  return (
    <Stack.Navigator screenOptions={{
      headerShown: false,
      contentStyle: { backgroundColor: colors.bg },
      animation: 'none',
    }}>
      <Stack.Screen name="StatsMain" component={StatsScreen} />
    </Stack.Navigator>
  );
}

// Profile Stack (standalone tab)
function ProfileStack() {
  return (
    <Stack.Navigator screenOptions={{
      headerShown: false,
      contentStyle: { backgroundColor: colors.bg },
      animation: 'none',
    }}>
      <Stack.Screen name="SettingsMain" component={SettingsScreen} />
    </Stack.Navigator>
  );
}

export default function AppNavigator() {
  return (
    <NavigationContainer
      theme={{
        dark: false,
        colors: {
          primary: colors.primary,
          background: colors.bg,
          card: colors.surface,
          text: colors.textPrimary,
          border: colors.border,
          notification: colors.primary,
        },
        fonts: {
          regular: { fontFamily: 'System', fontWeight: '400' },
          medium: { fontFamily: 'System', fontWeight: '500' },
          bold: { fontFamily: 'System', fontWeight: '700' },
          heavy: { fontFamily: 'System', fontWeight: '900' },
        },
      }}
    >
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: '#999',
          lazy: false,
          tabBarStyle: {
            height: 83,
            paddingBottom: 28,
            paddingTop: 8,
            borderTopWidth: 0.5,
            borderTopColor: colors.border,
            backgroundColor: colors.surface,
            elevation: 0,
            shadowColor: 'transparent',
          },
          tabBarItemStyle: {
            backgroundColor: 'transparent',
          },
          tabBarActiveBackgroundColor: 'transparent',
          tabBarInactiveBackgroundColor: 'transparent',
          tabBarButton: (props: BottomTabBarButtonProps) => (
            <PlatformPressable {...props} pressColor="transparent" pressOpacity={1} />
          ),
          tabBarLabelStyle: {
            fontSize: 12,
            fontWeight: '500',
          },
        }}
      >
        <Tab.Screen
          name="BookshelfTab"
          component={BookshelfStack}
          options={{
            tabBarLabel: '书架',
            tabBarIcon: BookIcon,
          }}
        />
        <Tab.Screen
          name="StatsTab"
          component={StatsStack}
          options={{
            tabBarLabel: '统计',
            tabBarIcon: StatsIcon,
          }}
        />
        <Tab.Screen
          name="ProfileTab"
          component={ProfileStack}
          options={{
            tabBarLabel: '我的',
            tabBarIcon: SettingsIcon,
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
