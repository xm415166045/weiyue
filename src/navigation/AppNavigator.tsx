import { colors } from '../theme/colors';
import React, { useMemo } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { PlatformPressable } from '@react-navigation/elements';
import type { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import { View, Text, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BookshelfScreen from '../screens/BookshelfScreen';
import SettingsScreen from '../screens/SettingsScreen';
import BookNotesScreen from '../screens/BookNotesScreen';
import StatsScreen from '../screens/StatsScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

// Tab Icons — 统一 22×22 线性图标，线宽 1.7，三个图形视觉重量一致
const INACTIVE = '#9AA0A6';
const tint = (focused: boolean) => (focused ? colors.primary : INACTIVE);

const BookIcon = ({ focused }: { focused: boolean }) => {
  const c = tint(focused);
  return (
    <View style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{
        width: 16, height: 18, borderRadius: 3, borderWidth: 1.7, borderColor: c,
        overflow: 'hidden', alignItems: 'flex-start',
      }}>
        <View style={{ width: 1.7, height: 18, backgroundColor: c, marginLeft: 3 }} />
      </View>
    </View>
  );
};

const StatsIcon = ({ focused }: { focused: boolean }) => {
  const c = tint(focused);
  return (
    <View style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2.4, height: 16 }}>
        <View style={{ width: 3.6, height: 7, borderRadius: 1.8, backgroundColor: c }} />
        <View style={{ width: 3.6, height: 11, borderRadius: 1.8, backgroundColor: c }} />
        <View style={{ width: 3.6, height: 16, borderRadius: 1.8, backgroundColor: c }} />
      </View>
    </View>
  );
};

const SettingsIcon = ({ focused }: { focused: boolean }) => {
  const c = tint(focused);
  return (
    <View style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: 7.5, height: 7.5, borderRadius: 3.75, borderWidth: 1.7, borderColor: c }} />
      <View style={{
        width: 15, height: 7.5, marginTop: 1.6,
        borderWidth: 1.7, borderColor: c, borderBottomWidth: 0,
        borderTopLeftRadius: 7.5, borderTopRightRadius: 7.5,
      }} />
    </View>
  );
};

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

/**
 * Tab 导航放在 NavigationContainer 内部，确保 useSafeAreaInsets 拿到真实 insets。
 * 横屏时压缩 Tab 栏高度并按左右安全区缩进，避免贴到刘海 / 挖孔。
 */
function AppTabs() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const sideInset = Math.max(insets.left, insets.right, 0);
  // 竖屏对齐微信读书的轻薄底栏，横屏进一步压低。
  // 底部安全区给下限兜底：部分 ROM 手势导航下 insets.bottom 会返回 0，
  // 之前没有下限时标签文字会顶到屏幕最底、被系统栏或窗口边缘切掉。
  const bottomInset = isLandscape
    ? Math.max(insets.bottom, 6)
    : Math.max(insets.bottom, 12);

  const tabBarStyle = useMemo(() => ({
    // 高度留足内容：图标 20 + 间距 3 + 文字行高 14 = 37，再加 paddingTop 6，
    // 50 的净高不会挤压文字（以前 46 高在放大字体时会把标签裁掉）。
    height: (isLandscape ? 44 : 50) + bottomInset,
    paddingBottom: bottomInset,
    paddingTop: isLandscape ? 4 : 6,
    // 内容不顶满整屏宽度：竖屏左右各留 26，横屏各留 56，
    // 避免 3 个 tab 被均分到屏幕两端、显得空旷（对齐微信读书的收拢感）。
    paddingLeft: sideInset + (isLandscape ? 56 : 26),
    paddingRight: sideInset + (isLandscape ? 56 : 26),
    borderTopWidth: 0.5,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    elevation: 0,
    shadowColor: 'transparent',
  }), [isLandscape, bottomInset, sideInset]);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: INACTIVE,
        lazy: false,
        tabBarStyle,
        tabBarItemStyle: {
          backgroundColor: 'transparent',
        },
        tabBarActiveBackgroundColor: 'transparent',
        tabBarInactiveBackgroundColor: 'transparent',
        tabBarButton: (props: BottomTabBarButtonProps) => (
          <PlatformPressable {...props} pressColor="transparent" pressOpacity={1} />
        ),
        tabBarLabelStyle: {
          fontSize: isLandscape ? 9.5 : 10.5,
          lineHeight: isLandscape ? 13 : 14,
          fontWeight: '500',
          marginTop: isLandscape ? 2 : 3,
        },
        // 关键：关掉系统字体缩放。系统字号放大时标签会撑高、被底栏裁掉半截。
        tabBarAllowFontScaling: false,
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
      <AppTabs />
    </NavigationContainer>
  );
}
