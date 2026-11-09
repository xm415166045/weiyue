import { colors } from '../theme/colors';
import React, { useCallback, useState, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, SectionList,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useAppDispatch, useAppSelector } from '../hooks';
import {
  setNotes, setCurrentBookId,
  enterNotesSelectMode, toggleNoteSelection, selectAllNotes,
  exitNotesSelectMode, removeNotes, updateBookNoteCount,
} from '../store/slices';
import { getNotesByBookId, deleteNotes as deleteNotesFromStorage, updateBookNoteCount as persistBookNoteCount } from '../services/storage';
import { exportBooksMarkdown, exportBooksPDF, exportBooksEPUB, exportBooksToIma, saveFile } from '../services/export-service';
import ExportSheet from '../components/ExportSheet';
import ConfirmSheet from '../components/ConfirmSheet';
import Toast, { ToastConfig } from '../components/Toast';
import { ExportIcon, DeleteIcon, CopyIcon } from '../components/ActionIcons';
import * as Clipboard from 'expo-clipboard';
import type { Note } from '../types';

const NOTE_TYPE_COLORS: Record<string, string> = {
  highlight: colors.primary,
  thought: colors.success,
  bookmark: colors.accent,
};

interface NoteSection {
  title: string;
  data: Note[];
}

export default function BookNotesScreen({ route, navigation }: any) {
  const { bookId, bookTitle } = route.params;
  const dispatch = useAppDispatch();
  const { notes, selectMode, selectedIds } = useAppSelector(s => s.notes);
  const [exportVisible, setExportVisible] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportFormatLabel, setExportFormatLabel] = useState('');
  const [toast, setToast] = useState<ToastConfig | null>(null);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const insets = useSafeAreaInsets();

  const loadNotes = useCallback(async () => {
    try {
      const data = await getNotesByBookId(bookId);
      dispatch(setNotes(data));
      dispatch(updateBookNoteCount({ bookId, noteCount: data.length }));
      persistBookNoteCount(bookId, data.length).catch(e => {
        if (__DEV__) console.warn('[BookNotes] 持久化笔记数失败:', e);
      });
    } catch (e: any) {
      if (__DEV__) console.error('[BookNotes] 加载笔记失败:', e);
      Alert.alert('加载失败', '无法读取笔记数据');
      dispatch(setNotes([]));
    } finally {
      setLoading(false);
    }
  }, [bookId, dispatch]);

  useFocusEffect(
    useCallback(() => {
      dispatch(setCurrentBookId(bookId));
      loadNotes();
    }, [bookId, dispatch, loadNotes])
  );

  // 按章节分组（未知章节放最后）
  const sections = useMemo<NoteSection[]>(() => {
    const groups = new Map<string, Note[]>();
    for (const n of notes) {
      const chapter = n.chapter || '其他';
      if (!groups.has(chapter)) groups.set(chapter, []);
      groups.get(chapter)!.push(n);
    }
    const result: NoteSection[] = [];
    for (const [title, items] of groups) {
      result.push({ title, data: items });
    }
    // 把"其他"排到最后
    result.sort((a, b) => {
      if (a.title === '其他') return 1;
      if (b.title === '其他') return -1;
      return a.title.localeCompare(b.title);
    });
    return result;
  }, [notes]);

  const handlePress = useCallback((note: Note) => {
    if (selectMode) {
      dispatch(toggleNoteSelection(note.id));
    }
  }, [selectMode, dispatch]);

  const handleLongPress = useCallback((note: Note) => {
    if (!selectMode) {
      dispatch(enterNotesSelectMode(note.id));
    }
  }, [selectMode, dispatch]);

  const handleBatchDelete = useCallback(() => {
    if (selectedIds.length === 0) {
      setToast({ message: '请先选择要删除的笔记', type: 'info' });
      return;
    }
    setConfirmVisible(true);
  }, [selectedIds]);

  const handleCopy = useCallback(async () => {
    if (selectedIds.length === 0) {
      setToast({ message: '请先选择要复制的笔记', type: 'info' });
      return;
    }
    const selectedNotes = notes.filter(n => selectedIds.includes(n.id));
    const text = selectedNotes.map(n => n.text).join('\n\n');
    try {
      await Clipboard.setStringAsync(text);
      setToast({ message: `已复制 ${selectedNotes.length} 条笔记`, type: 'success' });
    } catch {
      setToast({ message: '复制失败', type: 'error' });
    }
  }, [selectedIds, notes]);

  const executeDelete = useCallback(async () => {
    const deletedCount = selectedIds.length;
    setConfirmVisible(false);
    await deleteNotesFromStorage(selectedIds);
    const newCount = notes.length - deletedCount;
    dispatch(removeNotes(selectedIds));
    dispatch(updateBookNoteCount({ bookId, noteCount: newCount }));
    persistBookNoteCount(bookId, newCount).catch(e => {
      if (__DEV__) console.warn('[BookNotes] 持久化笔记数失败:', e);
    });
    setToast({ message: `已删除 ${deletedCount} 条笔记`, type: 'success' });
  }, [selectedIds, notes, bookId, dispatch]);

  const handleExport = useCallback(async (format: string, _action?: string) => {
    if (notes.length === 0) {
      setToast({ message: '没有笔记可以导出', type: 'info' });
      setExportVisible(false);
      return;
    }

    // IMA 直接执行
    if (format === 'ima') {
      setExportVisible(false);
      setExporting(true);
      try {
        await exportBooksToIma([bookId], selectedIds);
        dispatch(exitNotesSelectMode());
        setToast({ message: '笔记已导出到 IMA 知识库', type: 'success' });
      } catch (e: any) {
        setToast({ message: e.message || '导出到 IMA 失败', type: 'error' });
      } finally {
        setExporting(false);
      }
      return;
    }

    // PDF/Markdown/EPUB → 直接保存到本地（跳过二级菜单）
    setExportVisible(false);
    setExportFormatLabel(format.toUpperCase());
    setExporting(true);

    try {
      let result: { filePath: string; fileName: string; mimeType: string } | null = null;
      switch (format) {
        case 'markdown': result = await exportBooksMarkdown([bookId], selectedIds); break;
        case 'pdf': result = await exportBooksPDF([bookId], selectedIds); break;
        case 'epub': result = await exportBooksEPUB([bookId], selectedIds); break;
      }

      if (!result) throw new Error('导出失败');

      const savedPath = await saveFile(result.filePath, result.fileName, result.mimeType);
      if (savedPath !== '') {
        setToast({ message: `文件已保存到「下载 / 微阅」：${result.fileName}`, type: 'success' });
      }

      dispatch(exitNotesSelectMode());
    } catch (e: any) {
      setToast({ message: e.message || '导出失败', type: 'error' });
    } finally {
      setExporting(false);
    }
  }, [notes, bookId, selectedIds, dispatch]);

  const renderNote = useCallback(({ item }: { item: Note }) => {
    const isSelected = selectedIds.includes(item.id);

    return (
      <TouchableOpacity
        style={[styles.noteBlock, isSelected && styles.noteBlockSelected]}
        onPress={() => handlePress(item)}
        onLongPress={() => handleLongPress(item)}
        delayLongPress={400}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="笔记"
      >
        {/* 选择模式 checkbox */}
        {selectMode && (
          <View style={styles.checkboxRow}>
            <View style={[styles.checkbox, isSelected && styles.checkboxChecked]}>
              {isSelected && <Text style={styles.checkboxCheck}>✓</Text>}
            </View>
          </View>
        )}

        {/* 正文 — 衬线字体，阅读感 */}
        <Text style={styles.noteText}>{item.text}</Text>
      </TouchableOpacity>
    );
  }, [selectedIds, selectMode, handlePress, handleLongPress]);

  const renderSectionHeader = ({ section }: { section: NoteSection }) => (
    <View style={styles.sectionHeader}>
      {/* 章节上方装饰分隔线 */}
      <View style={styles.sectionHeaderDivider} />
      <Text style={styles.sectionHeaderText}>{section.title}</Text>
      <Text style={styles.sectionHeaderCount}>{section.data.length}条</Text>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Nav Bar */}
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => { dispatch(exitNotesSelectMode()); navigation.goBack(); }}>
          <Text style={styles.navBack}>{'\u2039'}</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle} numberOfLines={1}>{bookTitle}</Text>
        {selectMode ? (
          <View style={{ width: 60 }} />
        ) : (
          <TouchableOpacity
            onPress={() => {
              if (notes.length > 0) dispatch(enterNotesSelectMode(notes[0].id));
            }}
          >
            <Text style={styles.navAction}>编辑</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Select All Bar */}
      {selectMode && (
        <View style={styles.selectAllBar}>
          <Text style={styles.selectAllLabel}>已选 {selectedIds.length} 项</Text>
          <View style={styles.selectAllRight}>
            <View style={styles.selectAllCapsule}>
              <TouchableOpacity onPress={() => dispatch(selectAllNotes())}>
                <Text style={styles.selectAllBtn}>
                  {selectedIds.length === notes.length ? '取消全选' : '全选'}
                </Text>
              </TouchableOpacity>
              <View style={styles.selectAllCapsuleDivider} />
              <TouchableOpacity onPress={() => dispatch(exitNotesSelectMode())}>
                <Text style={styles.selectAllCancelBtn}>取消</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Notes grouped by chapter */}
      <SectionList
        sections={sections}
        renderItem={renderNote}
        renderSectionHeader={renderSectionHeader}
        windowSize={10}
        removeClippedSubviews={true}
        keyExtractor={item => item.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          loading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>📝</Text>
              <Text style={styles.emptyTitle}>暂无笔记</Text>
              <Text style={styles.emptyHint}>
                在微信读书中划线或写想法后，{'\n'}重新导入即可看到笔记内容
              </Text>
              {__DEV__ && (
                <Text style={styles.emptyDebug}>
                  书籍ID: {bookId}
                </Text>
              )}
            </View>
          )
        }
      />

      {/* Bottom Action Bar */}
      {selectMode && (
        <View style={styles.bottomBar}>
          <TouchableOpacity style={styles.copyBtn} onPress={handleCopy}>
            <CopyIcon size={18} color="#FFF" />
            <Text style={[styles.copyBtnText, { marginLeft: 6 }]}>复制</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.exportBtn} onPress={() => setExportVisible(true)}>
            <ExportIcon size={18} color="#FFF" />
            <Text style={[styles.exportBtnText, { marginLeft: 6 }]}>导出</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.deleteBtn} onPress={handleBatchDelete}>
            <DeleteIcon size={18} color="#FFF" />
            <Text style={[styles.deleteBtnText, { marginLeft: 6 }]}>删除</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 导出选项面板 */}
      <ExportSheet
        visible={exportVisible}
        title="导出笔记"
        exporting={exporting}
        exportFormat={exportFormatLabel}
        options={[
          {
            key: 'pdf', label: '导出为 PDF', subtitle: '保存到本地',
            icon: <View style={{width:18, height:22, borderRadius:2, borderWidth:1.8, borderColor:colors.primary}}>
              <View style={{position:'absolute', right:-1, top:-1, width:9, height:9, borderRightWidth:1.8, borderTopWidth:1.8, borderColor:colors.primary, borderTopRightRadius:2}} />
            </View>,
          },
          {
            key: 'markdown', label: '导出为 Markdown', subtitle: '保存到本地',
            icon: <View style={{justifyContent:'center', alignItems:'center'}}>
              <View style={{width:20, height:2, backgroundColor:colors.primary, borderRadius:1, marginBottom:5}} />
              <View style={{width:14, height:2, backgroundColor:colors.primary, borderRadius:1}} />
            </View>,
          },
          {
            key: 'epub', label: '导出为 EPUB', subtitle: '保存到本地',
            icon: <View style={{width:16, height:20, borderRadius:2, borderWidth:1.8, borderColor:colors.primary, borderLeftWidth:3, borderLeftColor:colors.primary}} />,
          },
          {
            key: 'ima', label: '导出到 IMA 知识库', subtitle: '上传到云端',
            icon: <View style={{width:24, height:16, borderRadius:9, borderWidth:1.8, borderColor:colors.primary, justifyContent:'center', alignItems:'center'}}>
              <View style={{width:10, height:6, borderRadius:3, borderWidth:1.2, borderColor:colors.primary}} />
            </View>,
          },
        ]}
        onSelect={handleExport}
        onClose={() => { if (!exporting) setExportVisible(false); }}
      />

      {/* 自定义 Toast */}
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      {/* 删除确认面板 */}
      <ConfirmSheet
        visible={confirmVisible}
        title="确认删除"
        message={`确定删除选中的 ${selectedIds.length} 条笔记？此操作不可恢复。`}
        onConfirm={executeDelete}
        onCancel={() => setConfirmVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAFA' },
  navBar: {
    height: 38, backgroundColor: '#FAFAFA',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, borderBottomWidth: 0.5, borderBottomColor: '#E8E8E8',
  },
  navBack: { fontSize: 28, color: '#1C1C1E', fontWeight: '300', lineHeight: 30 },
  navTitle: { fontSize: 16, fontWeight: '500', color: '#1C1C1E', flex: 1, textAlign: 'center', marginHorizontal: 8, fontFamily: 'Microsoft YaHei' },
  navAction: { fontSize: 14, color: '#114498', fontWeight: '500' },
  selectAllBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: '#FAFAFA', borderBottomWidth: 0.5, borderBottomColor: '#E8E8E8',
  },
  selectAllLabel: { fontSize: 13, color: '#1C1C1E', fontWeight: '400' },
  selectAllBtn: { fontSize: 13, color: '#FFF', fontWeight: '500', paddingHorizontal: 6 },
  selectAllRight: { flexDirection: 'row', alignItems: 'center' },
  selectAllCapsule: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#114498', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  selectAllCapsuleDivider: {
    width: 1, height: 14, backgroundColor: 'rgba(255,255,255,0.3)', marginHorizontal: 6,
  },
  selectAllCancelBtn: { fontSize: 13, color: '#FFF', fontWeight: '500', paddingHorizontal: 6 },

  // Section Headers — 极细风格：分隔线 + 标题 + 蓝色笔记数
  sectionHeader: {
    paddingHorizontal: 20, paddingTop: 4, paddingBottom: 4,
  },
  sectionHeaderDivider: {
    height: 0.5, backgroundColor: '#D3D1C7',
    marginBottom: 16, marginTop: 6,
  },
  sectionHeaderText: {
    fontSize: 14, fontWeight: '500', color: '#1C1C1E',
    fontFamily: 'Microsoft YaHei', marginBottom: 2,
  },
  sectionHeaderCount: {
    fontSize: 10, color: '#114498',
    fontFamily: 'system-ui',
  },

  // Note Blocks — 纯文本流，无分割线，仅靠间距
  list: { paddingBottom: 120 },
  noteBlock: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 14,
  },
  noteBlockSelected: { backgroundColor: '#EEF1F7' },
  checkboxRow: { marginBottom: 6 },
  checkbox: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 1.5, borderColor: '#C7C7CC',
    justifyContent: 'center', alignItems: 'center',
  },
  checkboxChecked: { backgroundColor: '#114498', borderColor: '#114498' },
  checkboxCheck: { color: '#FFF', fontSize: 11, fontWeight: '600' },
  noteText: {
    fontSize: 13, lineHeight: 22, color: '#444444',
    fontFamily: 'Microsoft YaHei', letterSpacing: 0.2,
  },

  // Empty State
  emptyState: { alignItems: 'center', paddingTop: 80 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: '#1C1C1E', marginBottom: 8 },
  emptyHint: { fontSize: 13, color: '#8E8E93', textAlign: 'center', lineHeight: 20 },
  emptyDebug: { fontSize: 10, color: '#C7C7CC', textAlign: 'center', marginTop: 16 },

  // Bottom Bar
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: 12,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32,
    backgroundColor: '#FAFAFA', borderTopWidth: 0.5, borderTopColor: '#E8E8E8',
  },
  exportBtn: {
    flex: 1, height: 44, borderRadius: 10,
    flexDirection: 'row',
    backgroundColor: '#114498', justifyContent: 'center', alignItems: 'center',
  },
  exportBtnText: { color: '#FFF', fontSize: 14, fontWeight: '500' },
  copyBtn: {
    flex: 1, height: 44, borderRadius: 10,
    flexDirection: 'row',
    backgroundColor: '#8E8E93', justifyContent: 'center', alignItems: 'center',
  },
  copyBtnText: { color: '#FFF', fontSize: 14, fontWeight: '500' },
  deleteBtn: {
    flex: 1, height: 44, borderRadius: 10,
    flexDirection: 'row',
    backgroundColor: '#FF3B30', justifyContent: 'center', alignItems: 'center',
  },
  deleteBtnText: { color: '#FFF', fontSize: 14, fontWeight: '500' },
});
