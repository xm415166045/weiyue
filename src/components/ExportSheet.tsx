import { colors } from '../theme/colors';
/**
 * 导出选项面板 — 统一 UI 风格
 * 底部弹出卡片，选择导出格式后直接执行
 */
import React from 'react';
import {
  View, Text, TouchableOpacity, Modal,
  ScrollView, StyleSheet, ActivityIndicator, useWindowDimensions,
} from 'react-native';

export interface ExportOption {
  key: string;
  label: string;
  icon: React.ReactNode;
  subtitle?: string;
}

interface ExportSheetProps {
  visible: boolean;
  title: string;
  options: ExportOption[];
  exporting?: boolean;
  exportFormat?: string;
  onSelect: (key: string) => void;
  onClose: () => void;
}

export default function ExportSheet({
  visible, title, options, exporting, exportFormat, onSelect, onClose,
}: ExportSheetProps) {
  const { height } = useWindowDimensions();
  // 横屏可用高度骤减，限制面板高度并让选项区可滚动
  const sheetMaxHeight = height * 0.82;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.backdrop} />
      </TouchableOpacity>

      <View style={[styles.sheet, { maxHeight: sheetMaxHeight }]}>
        {/* 标题栏 — 取消在右侧，与全选对齐 */}
        <View style={styles.header}>
          <View style={styles.handleBar} />
          <View style={styles.headerRow}>
            <View style={styles.headerSpacer} />
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity onPress={onClose} style={styles.headerCancel}>
              <Text style={styles.headerCancelText}>取消</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 导出中状态 */}
        {exporting ? (
          <View style={styles.exportingState}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.exportingTitle}>正在导出{exportFormat ? ` ${exportFormat}` : ''}...</Text>
            <Text style={styles.exportingHint}>文件将保存到设备本地</Text>
            <View style={styles.progressBarBg}>
              <View style={styles.progressBarTrack} />
            </View>
          </View>
        ) : (
          /* 选项列表：横屏高度受限时可滚动 */
          <ScrollView bounces={false} style={{ flexGrow: 0 }}>
            <View style={styles.optionsList}>
              {options.map((opt, i) => (
              <React.Fragment key={opt.key}>
                {i > 0 && <View style={styles.divider} />}
                <TouchableOpacity
                  style={styles.optionRow}
                  onPress={() => onSelect(opt.key)}
                  activeOpacity={0.6}
                >
                  <View style={styles.optionIcon}>{opt.icon}</View>
                  <View style={styles.optionContent}>
                    <Text style={styles.optionLabel}>{opt.label}</Text>
                    {opt.subtitle && (
                      <Text style={styles.optionSubtitle}>{opt.subtitle}</Text>
                    )}
                  </View>
                  <Text style={styles.optionArrow}>›</Text>
                </TouchableOpacity>
              </React.Fragment>
              ))}
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.overlay,
  },
  sheet: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 8,
  },
  header: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  handleBar: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.border, marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row', alignItems: 'center',
    width: '100%', paddingHorizontal: 16,
  },
  headerSpacer: {
    width: 50,
  },
  title: {
    flex: 1,
    fontSize: 17, fontWeight: '600', color: colors.textPrimary,
    textAlign: 'center',
  },
  headerCancel: {
    width: 50, alignItems: 'flex-end',
  },
  headerCancelText: {
    fontSize: 17, color: colors.primary, fontWeight: '700',
  },

  optionsList: {
    paddingTop: 8,
    paddingBottom: 16,
  },
  optionRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 16, paddingHorizontal: 20,
  },
  optionIcon: {
    width: 44, height: 28,
    justifyContent: 'center', alignItems: 'center',
    marginRight: 12,
  },
  optionContent: { flex: 1 },
  optionLabel: {
    fontSize: 16, fontWeight: '500', color: colors.textPrimary,
  },
  optionSubtitle: {
    fontSize: 12, color: colors.textSecondary, marginTop: 2,
  },
  optionArrow: {
    fontSize: 24, color: colors.textTertiary, fontWeight: '300',
  },
  divider: {
    height: 0.5, backgroundColor: colors.divider,
    marginLeft: 76, marginRight: 20,
  },

  exportingState: {
    alignItems: 'center', paddingVertical: 32, paddingHorizontal: 20,
  },
  exportingTitle: {
    fontSize: 17, fontWeight: '600', color: colors.textPrimary, marginTop: 16,
  },
  exportingHint: {
    fontSize: 13, color: colors.textSecondary, marginTop: 6,
  },
  progressBarBg: {
    width: '80%', height: 4, borderRadius: 2,
    backgroundColor: colors.border, marginTop: 20, overflow: 'hidden',
  },
  progressBarTrack: {
    width: '60%', height: 4, borderRadius: 2,
    backgroundColor: colors.primary,
  },
});
