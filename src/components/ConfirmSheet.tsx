import { colors } from '../theme/colors';
/**
 * 确认操作面板 — 统一 UI 风格
 * 底部弹出卡片，用于删除、危险操作确认
 */
import React from 'react';
import {
  View, Text, TouchableOpacity, Modal,
  ScrollView, StyleSheet, useWindowDimensions,
} from 'react-native';

interface ConfirmSheetProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmColor?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmSheet({
  visible, title, message, confirmLabel = '确认', cancelLabel = '取消',
  confirmColor = colors.error, onConfirm, onCancel,
}: ConfirmSheetProps) {
  const { width, height } = useWindowDimensions();
  const boxWidth = Math.min(270, width * 0.8);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onCancel}>
          <View style={styles.backdrop} />
        </TouchableOpacity>

        <View style={[styles.sheet, { width: boxWidth, maxHeight: height * 0.8 }]}>
        {/* 内容区：横屏高度受限时可滚动 */}
        <ScrollView contentContainerStyle={styles.content} bounces={false}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
        </ScrollView>

        {/* 按钮区 */}
        <View style={styles.divider} />
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} activeOpacity={0.7}>
            <Text style={styles.cancelBtnText}>{cancelLabel}</Text>
          </TouchableOpacity>
          <View style={styles.buttonDivider} />
          <TouchableOpacity style={styles.confirmBtn} onPress={onConfirm} activeOpacity={0.7}>
            <Text style={[styles.confirmBtnText, { color: confirmColor }]}>{confirmLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.overlay,
  },
  sheet: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 10,
  },
  content: {
    padding: 24,
    alignItems: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  message: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  divider: {
    height: 0.5,
    backgroundColor: colors.border,
  },
  buttonRow: {
    flexDirection: 'row',
    height: 48,
  },
  cancelBtn: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmBtn: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonDivider: {
    width: 0.5,
    backgroundColor: colors.border,
  },
  cancelBtnText: {
    fontSize: 17,
    color: colors.primary,
    fontWeight: '700',
  },
  confirmBtnText: {
    fontSize: 17,
    fontWeight: '600',
  },
});
