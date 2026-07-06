import { colors } from '../theme/colors';
/**
 * 自定义 Toast 提示 — 统一 App 风格
 * 底部浮动通知，自动消失
 */
import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, Animated, TouchableOpacity,
} from 'react-native';

export interface ToastConfig {
  message: string;
  type?: 'success' | 'error' | 'info';
  duration?: number;
}

interface ToastProps {
  toast: ToastConfig | null;
  onDismiss: () => void;
}

const COLORS: Record<string, { bg: string; text: string; icon: string }> = {
  success: { bg: colors.primary, text: '#FFF', icon: '✓' },
  error: { bg: colors.error, text: '#FFF', icon: '✕' },
  info: { bg: colors.primary, text: '#FFF', icon: 'ℹ' },
};

export default function Toast({ toast, onDismiss }: ToastProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    if (!toast) return;

    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 30, duration: 200, useNativeDriver: true }),
      ]).start(() => onDismiss());
    }, toast.duration || 3000);

    return () => clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;

  const { bg, text, icon } = COLORS[toast.type || 'info'];

  return (
    <Animated.View style={[styles.container, { opacity, transform: [{ translateY }] }]}>
      <TouchableOpacity
        style={[styles.toast, { backgroundColor: bg }]}
        onPress={onDismiss}
        activeOpacity={0.9}
      >
        <Text style={[styles.icon]}>{icon}</Text>
        <Text style={[styles.message, { color: text }]} numberOfLines={2}>
          {toast.message}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute', bottom: 32, left: 20, right: 20,
    alignItems: 'center', zIndex: 9999,
  },
  toast: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 14, paddingHorizontal: 18, paddingVertical: 14,
    minWidth: 200, maxWidth: '100%',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12, shadowRadius: 8, elevation: 6,
  },
  icon: {
    fontSize: 16, fontWeight: '700', color: '#FFF', marginRight: 10,
  },
  message: {
    fontSize: 14, fontWeight: '500', flex: 1, lineHeight: 20,
  },
});
