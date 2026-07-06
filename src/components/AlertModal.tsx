import { colors } from '../theme/colors';
/**
 * 系统风格 Alert 弹窗 — 统一 UI 风格
 * 居中弹出，用于确认/结果提示等场景
 * 按钮为蓝色、加粗、大号字体，与系统 UI 风格一致
 */
import React from 'react';
import {
  View, Text, TouchableOpacity, Modal,
  StyleSheet,
} from 'react-native';

interface AlertButton {
  text: string;
  onPress?: () => void;
  /** iOS 风格：'cancel' 加粗蓝色，'default' 普通蓝色，'destructive' 红色 */
  style?: 'default' | 'cancel' | 'destructive';
}

interface AlertModalProps {
  visible: boolean;
  title: string;
  message: string;
  buttons?: AlertButton[];
  onClose?: () => void;
}

export default function AlertModal({
  visible, title, message, buttons = [{ text: '好的' }], onClose,
}: AlertModalProps) {
  const handlePress = (btn: AlertButton) => {
    if (btn.onPress) btn.onPress();
    onClose?.();
  };

  const isSingle = buttons.length === 1;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose}>
          <View style={styles.backdrop} />
        </TouchableOpacity>

        <View style={styles.alertBox}>
          {/* 内容区 */}
          <View style={styles.content}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.message}>{message}</Text>
          </View>

          {/* 按钮区 */}
          <View style={styles.divider} />
          {isSingle ? (
          <TouchableOpacity
            style={styles.singleBtn}
            onPress={() => handlePress(buttons[0])}
            activeOpacity={0.7}
          >
            <Text style={[styles.btnText, styles.btnTextPrimary]}>{buttons[0].text}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.buttonRow}>
            {buttons.map((btn, i) => {
              const isLast = i === buttons.length - 1;
              const isCancel = btn.style === 'cancel';
              return (
                <React.Fragment key={i}>
                  {i > 0 && <View style={styles.buttonDivider} />}
                  <TouchableOpacity
                    style={[styles.multiBtn, isLast && styles.multiBtnLast]}
                    onPress={() => handlePress(btn)}
                    activeOpacity={0.7}
                  >
                    <Text style={[
                      styles.btnText,
                      isCancel ? styles.btnTextCancel : styles.btnTextPrimary,
                      isCancel && styles.btnTextBold,
                    ]}>
                      {btn.text}
                    </Text>
                  </TouchableOpacity>
                </React.Fragment>
              );
            })}
          </View>
        )}
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
  alertBox: {
    width: 270,
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
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  divider: {
    height: 0.5,
    backgroundColor: colors.border,
  },
  singleBtn: {
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    height: 48,
  },
  multiBtn: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  multiBtnLast: {
    flex: 1,
  },
  buttonDivider: {
    width: 0.5,
    backgroundColor: colors.border,
  },
  btnText: {
    fontSize: 18,
    fontWeight: '600',
  },
  btnTextPrimary: {
    color: colors.primary,
    fontWeight: '700',
  },
  btnTextCancel: {
    color: colors.primary,
  },
  btnTextBold: {
    fontWeight: '700',
  },
});
