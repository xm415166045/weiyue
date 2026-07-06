import { colors } from '../theme/colors';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, FlatList,
  StyleSheet, Alert, Image, ActivityIndicator, TextInput,
  Dimensions, PanResponder, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useAppDispatch, useAppSelector } from '../hooks';
import {
  setBooks, setFilter, setSortField,
  enterSelectMode, toggleSelection, selectAll, deselectAll,
  exitSelectMode, removeBooks, setSelectedIds,
} from '../store/slices';
import { getBooks, deleteBooks as deleteBooksFromStorage } from '../services/storage';
import { exportBooksMarkdown, exportBooksPDF, exportBooksEPUB, exportBooksToIma, saveFile } from '../services/export-service';
import ExportSheet from '../components/ExportSheet';
import ConfirmSheet from '../components/ConfirmSheet';
import Toast, { ToastConfig } from '../components/Toast';
import { ExportIcon, DeleteIcon } from '../components/ActionIcons';
import { prefetchCoversProgressive, getCoverUri, CoverCacheResult } from '../services/cover-cache';
import type { Book, BookFilter, SortField } from '../types';

const FILTERS: { key: BookFilter; label: string }[] = [
  { key: 'reading', label: '正在读' },
  { key: 'finished', label: '已读完' },
  { key: 'all', label: '全部' },
];

export default function BookshelfScreen({ navigation }: any) {
  const dispatch = useAppDispatch();
  const { books, filter, sortField, selectMode, selectedIds } = useAppSelector(s => s.books);
  const [sortVisible, setSortVisible] = useState(false);
  const [exportVisible, setExportVisible] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<ToastConfig | null>(null);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [exportFormatLabel, setExportFormatLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [coverCache, setCoverCache] = useState<Map<string, CoverCacheResult>>(new Map());
  const insets = useSafeAreaInsets();

  const loadBooks = useCallback(async () => {
    try {
      const data = await getBooks();
      dispatch(setBooks(data));
    } catch (e: any) {
      Alert.alert('加载失败', e.message || '无法读取书架数据');
    } finally {
      setLoading(false);
    }
  }, [dispatch]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadBooks();
    } finally {
      setRefreshing(false);
    }
  }, [loadBooks]);

  // 若当前 filter 已不存在（如旧版遗留的 'not-yet'），自动回退到 'reading'
  useEffect(() => {
    if (!FILTERS.some(f => f.key === filter)) {
      dispatch(setFilter('reading'));
    }
  }, [filter, dispatch]);

  useFocusEffect(
    useCallback(() => {
      loadBooks();
    }, [loadBooks])
  );

  // 封面预加载（即时渲染：每下载完一本即时更新状态）
  const preloadCovers = useCallback(async () => {
    if (books.length === 0) return;
    // 先标记所有已缓存的封面（内存+磁盘），避免不必要的网络请求
    const cachedResults = new Map<string, CoverCacheResult>();
    const uncached: typeof books = [];
    await Promise.all(
      books.map(async (b) => {
        if (!b.id || !b.coverUrl) return;
        // 只查缓存，不走网络
        const result = await getCoverUri(b.id, b.coverUrl).catch(() => null);
        if (result?.cached) {
          cachedResults.set(b.id, result);
        } else {
          uncached.push(b);
        }
      }),
    );
    // 立即渲染所有已缓存的封面
    if (cachedResults.size > 0) setCoverCache(cachedResults);

    // 对未缓存的封面，用 progressive worker 模式下载，每张下载完即时渲染
    if (uncached.length > 0) {
      await prefetchCoversProgressive(
        uncached,
        (bookId, uri) => {
          setCoverCache(prev => new Map(prev).set(bookId, { uri, cached: false }));
        },
        6,
      );
    }
  }, [books]);

  useEffect(() => {
    preloadCovers();
  }, [preloadCovers]);

  // 左右滑动切换筛选标签
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) =>
      Math.abs(g.dx) > 15 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderRelease: (_, g) => {
      const idx = FILTERS.findIndex(f => f.key === filter);
      if (g.dx > 50) {
        // 右滑 → 上一个标签
        const prev = (idx - 1 + FILTERS.length) % FILTERS.length;
        dispatch(setFilter(FILTERS[prev].key));
      } else if (g.dx < -50) {
        // 左滑 → 下一个标签
        const next = (idx + 1) % FILTERS.length;
        dispatch(setFilter(FILTERS[next].key));
      }
    },
  }), [filter, dispatch]);

  // Filtered and sorted books (filter + search + sort)
  const displayBooks = useMemo(() => {
    let filtered = filter === 'all' ? books
      : filter === 'reading' ? books.filter(b => b.status === 'reading' || b.status === 'not-yet')
      : books.filter(b => b.status === filter);
    // 搜索过滤
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      filtered = filtered.filter(
        b => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q),
      );
    }
    const sorted = [...filtered];
    switch (sortField) {
      case 'name': sorted.sort((a, b) => a.title.localeCompare(b.title)); break;
      case 'author': sorted.sort((a, b) => a.author.localeCompare(b.author)); break;
      case 'date': default: sorted.sort((a, b) => b.lastReadDate.localeCompare(a.lastReadDate)); break;
    }
    return sorted;
  }, [books, filter, sortField, searchQuery]);

  // Counts per filter
  const counts = useMemo(() => {
    const c: Record<BookFilter, number> = { reading: 0, finished: 0, 'not-yet': 0, all: books.length };
    books.forEach(b => { c[b.status]++; });
    // "正在读"计数包含 not-yet（加入书架但未开始读的书）
    c.reading = c.reading + c['not-yet'];
    return c;
  }, [books]);

  const handlePress = useCallback((book: Book) => {
    if (selectMode) {
      dispatch(toggleSelection(book.id));
    } else {
      navigation.navigate('BookNotes', { bookId: book.id, bookTitle: book.title });
    }
  }, [selectMode, dispatch, navigation]);

  const handleLongPress = useCallback((book: Book) => {
    if (!selectMode) {
      dispatch(enterSelectMode(book.id));
    }
  }, [selectMode, dispatch]);

  const handleBatchDelete = useCallback(() => {
    if (selectedIds.length === 0) {
      setToast({ message: '请先选择要删除的书籍', type: 'info' });
      return;
    }
    setConfirmVisible(true);
  }, [selectedIds]);

  const executeDelete = useCallback(async () => {
    setConfirmVisible(false);
    try {
      await deleteBooksFromStorage(selectedIds);
      dispatch(removeBooks(selectedIds));
      setToast({ message: `已删除 ${selectedIds.length} 本书`, type: 'success' });
    } catch (e: any) {
      setToast({ message: e.message || '删除失败', type: 'error' });
    }
  }, [selectedIds, dispatch]);

  const handleExport = useCallback(async (format: string, _action?: string) => {
    if (selectedIds.length === 0) {
      setToast({ message: '请先选择要导出的书籍', type: 'info' });
      setExportVisible(false);
      return;
    }

    // IMA 直接执行
    if (format === 'ima') {
      setExportVisible(false);
      setExporting(true);
      try {
        const result = await exportBooksToIma(selectedIds);
        dispatch(exitSelectMode());
        setToast({ message: `已导出 ${result.count} 本书到 IMA 知识库`, type: 'success' });
      } catch (e: any) {
        setToast({ message: e.message || '导出到 IMA 失败', type: 'error' });
      } finally {
        setExporting(false);
        setExportVisible(false);
      }
      return;
    }

    // PDF/Markdown/EPUB → 直接保存到本地（跳过二级菜单）
    setExportVisible(false);
    setExportFormatLabel(format.toUpperCase());
    setExporting(true);

    // 兜底超时：任何导出/保存操作挂起时，30秒后强制重置状态
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const startTimeout = () => {
      timeoutId = setTimeout(() => {
        setExporting(false);
        setExportVisible(false);
        setToast({ message: '导出超时，文件可能已保存，请检查本地文件', type: 'error' });
      }, 30000);
    };

    try {
      startTimeout();
      let result: { filePath: string; fileName: string; mimeType: string } | null = null;
      switch (format) {
        case 'markdown': result = await exportBooksMarkdown(selectedIds); break;
        case 'pdf': result = await exportBooksPDF(selectedIds); break;
        case 'epub': result = await exportBooksEPUB(selectedIds); break;
      }

      if (!result) throw new Error('导出失败');

      // 直接保存到本地
      const savedPath = await saveFile(result.filePath, result.fileName, result.mimeType);
      if (savedPath !== '') {
        setToast({ message: `文件已保存到「下载 / 微阅」：${result.fileName}`, type: 'success' });
      }

      dispatch(exitSelectMode());
    } catch (e: any) {
      setToast({ message: e.message || '导出失败', type: 'error' });
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      setExporting(false);
      setExportVisible(false);
    }
  }, [selectedIds, dispatch]);

  const handleSelectAll = useCallback(() => {
    if (selectedIds.length === displayBooks.length) {
      dispatch(deselectAll());
    } else {
      // 全选当前展示的书籍（尊重搜索 + 筛选条件）
      dispatch(setSelectedIds(displayBooks.map(b => b.id)));
    }
  }, [selectedIds, displayBooks, dispatch]);

  const renderBook = useCallback(({ item }: { item: Book }) => {
    const isSelected = selectedIds.includes(item.id);
    const cached = coverCache.get(item.id);
    return (
      <TouchableOpacity
        style={styles.bookCell}
        onPress={() => handlePress(item)}
        onLongPress={() => handleLongPress(item)}
        delayLongPress={400}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}，作者${item.author}`}
      >
        <View style={styles.coverWrap}>
          <BookCover item={item} cachedUri={cached?.uri} />
          {isSelected && (
            <View style={styles.selectOverlay}>
              <View style={styles.selectCheck}>
                <Text style={styles.selectCheckText}>✓</Text>
              </View>
            </View>
          )}
          {item.noteCount > 0 && (
            <View style={styles.noteBadge}>
              <Text style={styles.noteBadgeText}>{item.noteCount}</Text>
            </View>
          )}
        </View>
        <Text style={styles.bookTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.bookMeta} numberOfLines={1}>
          {item.status === 'reading' ? (
            <Text style={{ color: colors.primary, fontWeight: '700' }}>正在读</Text>
          ) : item.status === 'finished' ? (
            <Text style={{ color: colors.textSecondary, fontWeight: '700' }}>已读完</Text>
          ) : (
            <Text style={{ color: colors.textTertiary, fontWeight: '500' }}>未读</Text>
          )}
        </Text>
      </TouchableOpacity>
    );
  }, [selectedIds, handlePress, handleLongPress]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} {...panResponder.panHandlers}>
      {/* Nav Bar */}
      <View style={styles.navBar}>
        <View style={{ width: 44 }} />
        <Text style={styles.navTitle}>我的书架</Text>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => setSortVisible(!sortVisible)}
          >
            <Text style={styles.iconBtnText}>⇅</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Sort Dropdown */}
      {sortVisible && (
        <View style={styles.sortDropdown}>
          {(['date', 'name', 'author'] as SortField[]).map(f => (
            <TouchableOpacity
              key={f}
              style={[styles.sortOption, sortField === f && styles.sortOptionActive]}
              onPress={() => { dispatch(setSortField(f)); setSortVisible(false); }}
            >
              <Text style={[styles.sortOptionText, sortField === f && styles.sortOptionTextActive]}>
                {f === 'date' ? '时间' : f === 'name' ? '名称' : '作者'}
              </Text>
              {sortField === f && <Text style={styles.sortCheck}>✓</Text>}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Search Bar — 对齐书迹 */}
      <View style={styles.searchBar}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="搜索书名或作者"
          placeholderTextColor={colors.textTertiary}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Text style={styles.searchClear}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Metadata — 对齐书迹：N/M 本有记录的书 */}
      <View style={styles.metaBar}>
        <Text style={styles.metaText}>
          {displayBooks.length} / {books.length} 本{filter !== 'all' ? ` · ${FILTERS.find(f => f.key === filter)?.label}` : ''}
        </Text>
        {searchQuery.trim() && (
          <Text style={styles.metaHint}>搜索 "{searchQuery.trim()}"</Text>
        )}
      </View>

      {/* Status Tabs */}
      <View style={styles.statusTabs}>
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f.key}
            style={[styles.statusTab, filter === f.key && styles.statusTabActive]}
            onPress={() => dispatch(setFilter(f.key))}
          >
            <Text style={[styles.statusTabText, filter === f.key && styles.statusTabTextActive]}>
              {f.label}
            </Text>
            <Text style={[styles.statusTabCount, filter === f.key && styles.statusTabCountActive]}>
              {counts[f.key]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Select Mode Bar */}
      {selectMode && (
        <View style={styles.selectAllBar}>
          <Text style={styles.selectAllLabel}>已选 {selectedIds.length} 项</Text>
          <View style={styles.selectAllRight}>
            <View style={styles.selectAllCapsule}>
              <TouchableOpacity onPress={handleSelectAll}>
                <Text style={styles.selectAllBtn}>
                  {selectedIds.length === displayBooks.length ? '取消全选' : '全选'}
                </Text>
              </TouchableOpacity>
              <View style={styles.selectAllCapsuleDivider} />
              <TouchableOpacity onPress={() => dispatch(exitSelectMode())}>
                <Text style={styles.selectAllCancelBtn}>取消</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Book Grid */}
      <FlatList
        data={displayBooks}
        renderItem={renderBook}
        keyExtractor={item => item.id}
        numColumns={4}
        windowSize={5}
        maxToRenderPerBatch={8}
        removeClippedSubviews={true}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.grid}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
        ListEmptyComponent={
          loading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>暂无书籍</Text>
            </View>
          )
        }
      />

      {/* Bottom Action Bar (Select Mode) */}
      {selectMode && (
        <View style={styles.bottomBar} pointerEvents="auto">
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
        title="导出书籍笔记"
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
        onClose={() => setExportVisible(false)}
      />

      {/* 自定义 Toast */}
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      {/* 删除确认面板 */}
      <ConfirmSheet
        visible={confirmVisible}
        title="确认删除"
        message={`确定删除选中的 ${selectedIds.length} 本书？此操作不可恢复。`}
        onConfirm={executeDelete}
        onCancel={() => setConfirmVisible(false)}
      />
    </View>
  );
}

const ITEMS_PER_ROW = 4;
const SCREEN_PADDING = 24; // 左右各12
const GAP = 10;
const CELL_WIDTH = (Dimensions.get('window').width - SCREEN_PADDING - (ITEMS_PER_ROW - 1) * GAP) / ITEMS_PER_ROW;

// 封面组件：带图片加载失败回退 + 缓存支持
const BookCover: React.FC<{ item: Book; cachedUri?: string }> = ({ item, cachedUri }) => {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const gradientColors = (item.coverColor ?? '#007AFF,#5AC8FA,#A0D4FF').split(',');
  const displayUri = cachedUri || item.coverUrl;
  return (
    <View style={[styles.coverImg, { backgroundColor: gradientColors[0] || colors.primary }]}>
      {displayUri && !failed ? (
        <Image
          source={{ uri: displayUri, cache: 'force-cache' }}
          style={[styles.coverImage, !loaded && { opacity: 0 }]}
          resizeMode="cover"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : null}
      {/* 未加载完成或加载失败时显示渐变占位 */}
      {(!loaded || failed || !displayUri) && (
        <>
          <View style={[styles.coverGradient, { backgroundColor: gradientColors[1] || colors.primaryLight }]} />
          <Text style={styles.coverText} numberOfLines={3}>{item.title}</Text>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  navBar: {
    height: 44, backgroundColor: '#FFF',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  navTitle: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  iconBtn: { width: 32, height: 32, justifyContent: 'center', alignItems: 'center', borderRadius: 8 },
  iconBtnText: { fontSize: 18, color: colors.textPrimary },
  sortDropdown: {
    position: 'absolute', top: 44, right: 16, zIndex: 100,
    backgroundColor: '#FFF', borderRadius: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03, shadowRadius: 8,
    elevation: 1, minWidth: 100, paddingVertical: 4,
  },
  sortOption: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 10,
  },
  sortOptionActive: {},
  sortOptionText: { fontSize: 14, color: colors.textPrimary, flex: 1 },
  sortOptionTextActive: { color: colors.primary, fontWeight: '500' },
  sortCheck: { fontSize: 13, color: colors.primary },

  // Search Bar — 对齐书迹
  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginTop: 10,
    backgroundColor: '#FFF', borderRadius: 14,
    paddingHorizontal: 12, height: 40,
  },
  searchIcon: { fontSize: 14, marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: colors.textPrimary, paddingVertical: 0 },
  searchClear: { fontSize: 16, color: colors.textTertiary, padding: 4 },

  // Meta Bar
  metaBar: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: 8, paddingBottom: 4,
  },
  metaText: { fontSize: 12, color: colors.textSecondary },
  metaHint: { fontSize: 12, color: colors.primary },

  // Status Tabs — 微信读书风格
  statusTabs: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    gap: 28, paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: '#FFF', borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  statusTab: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 6, paddingHorizontal: 16, borderRadius: 16,
  },
  statusTabActive: { backgroundColor: colors.primaryBg },
  statusTabText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  statusTabTextActive: { color: colors.primary, fontWeight: '700' },
  statusTabCount: { fontSize: 12, color: colors.textTertiary, marginLeft: 3 },
  statusTabCountActive: { color: colors.primary },

  selectAllBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: '#FFF', borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  selectAllLabel: { fontSize: 14, color: colors.textPrimary, fontWeight: '500' },
  selectAllBtn: { fontSize: 14, color: '#FFF', fontWeight: '600', paddingHorizontal: 6 },
  selectAllRight: { flexDirection: 'row', alignItems: 'center' },
  selectAllCapsule: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.primary, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  selectAllCapsuleDivider: {
    width: 1, height: 16, backgroundColor: 'rgba(255,255,255,0.3)', marginHorizontal: 8,
  },
  selectAllCancelBtn: { fontSize: 14, color: '#FFF', fontWeight: '600', paddingHorizontal: 6 },

  // Book Grid — 微信读书紧凑风格
  grid: { paddingHorizontal: 12, paddingVertical: 12, paddingBottom: 120 },
  row: { gap: GAP, marginBottom: 16, justifyContent: 'flex-start' },
  bookCell: { width: CELL_WIDTH, alignItems: 'center' },
  coverWrap: { position: 'relative', marginBottom: 6 },
  coverImg: {
    width: CELL_WIDTH, height: CELL_WIDTH * 1.33, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
    overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.025, shadowRadius: 4, elevation: 1,
  },
  coverImage: { width: '100%', height: '100%', borderRadius: 12 },
  coverGradient: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.5,
  },
  coverText: {
    fontSize: 13, fontWeight: '700', color: '#FFF',
    textAlign: 'center', lineHeight: 18,
    paddingHorizontal: 6, zIndex: 1,
  },
  selectOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(10,132,255,0.25)', borderRadius: 12,
    justifyContent: 'center', alignItems: 'center', zIndex: 2,
  },
  selectCheck: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center',
  },
  selectCheckText: { color: '#FFF', fontSize: 14 },
  noteBadge: {
    position: 'absolute', top: -4, right: -4,
    backgroundColor: colors.primary, borderRadius: 10,
    minWidth: 20, height: 20, paddingHorizontal: 5,
    justifyContent: 'center', alignItems: 'center',
  },
  noteBadgeText: { color: '#FFF', fontSize: 10, fontWeight: '700' },
  bookTitle: {
    fontSize: 13, fontWeight: '500', color: colors.textPrimary,
    textAlign: 'center', paddingHorizontal: 2,
  },
  bookMeta: {
    fontSize: 11, color: colors.textSecondary,
    textAlign: 'center', marginTop: 2,
  },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 100 },
  emptyText: { fontSize: 15, color: colors.textSecondary },
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
    flexDirection: 'row', gap: 12,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32,
    backgroundColor: '#FFF', borderTopWidth: 0.5, borderTopColor: colors.border,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
  },
  exportBtn: {
    flex: 1, height: 44, borderRadius: 12,
    flexDirection: 'row',
    backgroundColor: colors.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  exportBtnText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  deleteBtn: {
    flex: 1, height: 44, borderRadius: 12,
    flexDirection: 'row',
    backgroundColor: colors.error, justifyContent: 'center', alignItems: 'center',
  },
  deleteBtnText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
});
