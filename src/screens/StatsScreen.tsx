import { colors } from '../theme/colors';
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator,
  Image, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { getSettings, getBooks } from '../services/storage';
import { fetchReadingStats } from '../services/weread-api';
import { getCoverUri } from '../services/cover-cache';
import type { WeReadStats, ReadStatsMode, ReadingStats } from '../types';

const MODES: { key: ReadStatsMode; label: string }[] = [
  { key: 'monthly', label: '月' },
  { key: 'annually', label: '年' },
  { key: 'overall', label: '总' },
];

// preferTime 从6点开始排列，映射回0-23点
function shiftPreferTime(arr: number[]): number[] {
  if (arr.length < 24) return arr;
  return [...arr.slice(18), ...arr.slice(0, 18)]; // 6→0: 后6个(18-23) + 前18个(0-17)
}

function formatSeconds(s: number): string {
  if (s <= 0) return '-';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 100) return `${Math.round(h / 10) * 10}+h`;
  if (h > 0) return m > 0 ? `${h}h${m}m` : `${h}h`;
  return `${m}m`;
}

export default function StatsScreen(_props: any) {
  const [stats, setStats] = useState<WeReadStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ReadStatsMode>('monthly');
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  });
  const [summaryStats, setSummaryStats] = useState<ReadingStats | null>(null);
  const [coverCache, setCoverCache] = useState<Map<string, string>>(new Map());
  const [failedCovers, setFailedCovers] = useState<Set<string>>(new Set());
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const contentWidth = windowWidth - insets.left - insets.right;
  const metricColumns = contentWidth >= 700 ? 6 : contentWidth >= 520 ? 4 : 3;
  const cardWidth = (contentWidth - 16 * 2 - 8 * (metricColumns - 1)) / metricColumns;

  const loadStats = useCallback(async (m: ReadStatsMode, baseTime?: number) => {
    setLoading(true);
    setError(null);
    try {
      const settings = await getSettings();
      if (!settings.weread.apiKey) {
        setError('请先在设置中配置微信读书 API Key');
        return;
      }
      const result = await fetchReadingStats(settings.weread.apiKey, m, baseTime ?? 0);
      setStats(result);
    } catch (e: any) {
      setError(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  // 从本地书架数据计算阅读概览
  const loadSummaryStats = useCallback(async () => {
    try {
      const books = await getBooks();
      let totalReadingTime = books.reduce((sum, b) => sum + (b.readingTime || 0), 0);

      // 本地阅读时长为 0 时，尝试从 API 获取真实数据
      if (totalReadingTime === 0) {
        try {
          const settings = await getSettings();
          if (settings.weread.apiKey) {
            const apiStats = await fetchReadingStats(settings.weread.apiKey, 'overall');
            if (apiStats.totalReadTime > 0) {
              totalReadingTime = Math.round(apiStats.totalReadTime / 60);
            }
          }
        } catch (e) {
          if (__DEV__) console.warn('[Stats] API 获取阅读统计失败:', e);
        }
      }

      setSummaryStats({
        totalBooks: books.length,
        totalNotes: books.reduce((sum, b) => sum + b.noteCount, 0),
        totalReadingTime,
        finishedBooks: books.filter(b => b.status === 'finished').length,
        readingStreak: 0,
        avgReadingSpeed: 0,
      });
    } catch (e) {
      if (__DEV__) console.warn('[Stats] 加载本地概览失败:', e);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadStats(mode, cursor);
      loadSummaryStats();
    }, [loadStats, mode, cursor, loadSummaryStats])
  );

  // 当 stats 数据更新后，预加载"读得最多"的封面
  const preloadLongestCovers = useCallback(async (longest: WeReadStats['readLongest']) => {
    let changed = false;
    const newCache = new Map(coverCache);
    await Promise.all(
      longest.map(async (item) => {
        const bookId = item.book?.bookId || item.albumInfo?.albumId || '';
        const coverUrl = item.book?.cover || item.albumInfo?.cover || '';
        if (!bookId || !coverUrl || newCache.has(bookId)) return;
        const result = await getCoverUri(bookId, coverUrl).catch(() => null);
        if (result?.uri) {
          newCache.set(bookId, result.uri);
          changed = true;
        }
      }),
    );
    if (changed) setCoverCache(newCache);
  }, [coverCache]);

  // stats 加载完成后触发封面预加载
  useEffect(() => {
    if (stats?.readLongest?.length) {
      preloadLongestCovers(stats.readLongest);
    }
  }, [stats, preloadLongestCovers]);

  // 根据 cursor 获取当前模式下的显示文字
  const cursorDate = new Date(cursor);
  const periodLabel = useMemo(() => {
    if (mode === 'monthly') {
      return `${cursorDate.getFullYear()}年${cursorDate.getMonth() + 1}月`;
    }
    if (mode === 'annually') {
      return `${cursorDate.getFullYear()}年`;
    }
    return '';
  }, [mode, cursorDate]);

  const handleModeChange = (m: ReadStatsMode) => {
    setMode(m);
    if (m === 'overall') {
      loadStats(m);
    } else if (m === 'annually') {
      const baseTime = new Date(cursorDate.getFullYear(), 0, 1).getTime();
      setCursor(baseTime);
      loadStats(m, baseTime);
    } else if (m === 'monthly') {
      const baseTime = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1).getTime();
      setCursor(baseTime);
      loadStats(m, baseTime);
    }
  };

  const goPrev = () => {
    if (mode === 'overall') return;
    const d = new Date(cursor);
    if (mode === 'monthly') { d.setMonth(d.getMonth() - 1); }
    else if (mode === 'annually') { d.setFullYear(d.getFullYear() - 1); }
    d.setHours(0, 0, 0, 0);
    setCursor(d.getTime());
    loadStats(mode, d.getTime());
  };

  const goNext = () => {
    if (mode === 'overall') return;
    const d = new Date(cursor);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    if (mode === 'monthly') {
      const next = new Date(d); next.setMonth(next.getMonth() + 1);
      if (next > now) return;
      d.setMonth(d.getMonth() + 1);
    } else if (mode === 'annually') {
      const next = new Date(d); next.setFullYear(next.getFullYear() + 1);
      if (next > now) return;
      d.setFullYear(d.getFullYear() + 1);
    }
    d.setHours(0, 0, 0, 0);
    setCursor(d.getTime());
    loadStats(mode, d.getTime());
  };

  // 24小时阅读时段（6点起点 → 0点起点）
  const hourDistribution = useMemo(() => {
    if (!stats?.preferTime) return new Array(24).fill(0);
    return shiftPreferTime(stats.preferTime);
  }, [stats?.preferTime]);

  const hourMax = useMemo(() => Math.max(...hourDistribution, 1), [hourDistribution]);

  return (
    <View style={[S.container, {
      paddingTop: insets.top,
      paddingLeft: insets.left,
      paddingRight: insets.right,
    }]}>
      <View style={S.navBar}>
        <View style={{ width: 44 }} />
        <Text style={S.navTitle}>读书统计</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView style={S.content} showsVerticalScrollIndicator={false}>
        {/* 阅读概览卡片 */}
        {summaryStats && (
          <View style={S.statsCard}>
            <Text style={S.statsTitle}>阅读概览</Text>
            <View style={S.statsGrid}>
              <View style={S.statItem}>
                <StatValue value={summaryStats.totalBooks} />
                <Text style={S.statLabel}>书籍</Text>
              </View>
              <View style={S.statItem}>
                <StatValue value={summaryStats.totalNotes} />
                <Text style={S.statLabel}>笔记</Text>
              </View>
              <View style={S.statItem}>
                <StatValue value={Math.floor(summaryStats.totalReadingTime / 60) + 'h'} />
                <Text style={S.statLabel}>阅读</Text>
              </View>
              <View style={S.statItem}>
                <StatValue value={summaryStats.finishedBooks} />
                <Text style={S.statLabel}>已完</Text>
              </View>
            </View>
          </View>
        )}

        {/* 周期切换 */}
        <View style={S.modeTabs}>
          {MODES.map(p => (
            <TouchableOpacity
              key={p.key}
              style={[S.modeTab, mode === p.key && S.modeTabActive]}
              onPress={() => handleModeChange(p.key)}
            >
              <Text style={[S.modeTabText, mode === p.key && S.modeTabTextActive]}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* 周期选择器 — 微信读书风格 << 本周 M月D日至M月D日 >> */}
        {(mode === 'annually' || mode === 'monthly') && (
          <View style={S.datePicker}>
            <TouchableOpacity onPress={goPrev} style={S.dateArrowBtn}>
              <Text style={S.dateArrow}>‹</Text>
            </TouchableOpacity>
            <Text style={S.dateLabel}>{periodLabel}</Text>
            <TouchableOpacity onPress={goNext} style={S.dateArrowBtn}>
              <Text style={S.dateArrow}>›</Text>
            </TouchableOpacity>
          </View>
        )}

        {loading ? (
          <View style={S.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : error ? (
          <View style={S.errorContainer}>
            <Text style={S.errorIcon}>⚠️</Text>
            <Text style={S.errorText}>{error}</Text>
            <TouchableOpacity style={S.retryBtn} onPress={() => handleModeChange(mode)}>
              <Text style={S.retryText}>重试</Text>
            </TouchableOpacity>
          </View>
        ) : stats ? (
          <>
            {/* 核心指标 */}
            {(() => {
              // 收集所有指标项（避免 readStat 和自定义项重复）
              const items: { key: string; value: React.ReactNode; label: string }[] = [];

              // 添加 readStat 中的项
              stats.readStat.forEach((item, i) => {
                items.push({
                  key: `stat-${i}`,
                  value: item.counts,
                  label: item.stat,
                });
              });

              // 总阅读时长 — readStat 通常不包含，总是添加
              items.push({
                key: 'readTime',
                value: formatSeconds(stats.totalReadTime),
                label: '总阅读时长',
              });

              // 阅读天数 — 检查 readStat 中是否已有（通过值匹配）
              const hasReadDaysInStat = stats.readStat.some(
                s => s.counts === `${stats.readDays}天` || s.counts === String(stats.readDays)
              );
              if (!hasReadDaysInStat) {
                items.push({
                  key: 'readDays',
                  value: <>{stats.readDays}<Text style={{ fontSize: 13, color: colors.textSecondary }}>天</Text></>,
                  label: '阅读天数',
                });
              }

              // 日均时长 — API 返回 0 时自行计算
              let avgTimeValue: string;
              if (stats.dayAverageReadTime > 0) {
                avgTimeValue = formatSeconds(stats.dayAverageReadTime);
              } else if (stats.readDays > 0 && stats.totalReadTime > 0) {
                avgTimeValue = formatSeconds(Math.round(stats.totalReadTime / stats.readDays));
              } else {
                avgTimeValue = '-';
              }
              items.push({
                key: 'avgTime',
                value: avgTimeValue,
                label: '日均时长',
              });

              // 按当前宽度分档决定每行卡片数
              const rows: React.ReactNode[] = [];
              for (let i = 0; i < items.length; i += metricColumns) {
                const rowItems = items.slice(i, i + metricColumns);
                const isLastRow = i + metricColumns >= items.length;
                const rowJustify = rowItems.length === metricColumns
                  ? 'space-between' as const
                  : 'flex-start' as const;
                rows.push(
                  <View key={`row-${i}`} style={{
                    flexDirection: 'row',
                    justifyContent: rowJustify,
                    gap: isLastRow && rowItems.length < metricColumns ? 8 : 0,
                    marginBottom: 8,
                  }}>
                    {rowItems.map(item => (
                      <View key={item.key} style={[S.metricCard, { width: cardWidth }]}>
                        <Text style={S.metricValue}>{item.value}</Text>
                        <Text style={S.metricLabel}>{item.label}</Text>
                      </View>
                    ))}
                  </View>
                );
              }
              return <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>{rows}</View>;
            })()}

            {/* 24小时阅读时段 */}
            {hourMax > 0 && (
              <View style={S.section}>
                <Text style={S.sectionTitle}>阅读时段</Text>
                <View style={S.chartCard}>
                  <View style={S.hourChart}>
                    {hourDistribution.map((val, i) => {
                      const h = Math.max((val / hourMax) * 80, val > 0 ? 3 : 1);
                      return (
                        <View key={i} style={{ flex: 1, alignItems: 'center' }}>
                          <View style={[S.hourBar, { height: h }, val > 0 && S.hourBarActive, i >= 8 && i < 18 ? S.hourBarDay : undefined]} />
                          <Text style={[S.hourLabel, (i === 0 || i === 6 || i === 12 || i === 18) && S.hourLabelBold]}>
                            {i % 3 === 0 ? i : ''}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              </View>
            )}

            {/* 读得最多的书 */}
            {stats.readLongest.length > 0 && (
              <View style={S.section}>
                <Text style={S.sectionTitle}>读得最多</Text>
                <View style={S.longestCard}>
                {stats.readLongest.map((item, i) => {
                  const name = item.book?.title || item.albumInfo?.name || '';
                  const author = item.book?.author || item.albumInfo?.authorName || '';
                  const bookId = item.book?.bookId || item.albumInfo?.albumId || '';
                  const rawCoverUrl = item.book?.cover || item.albumInfo?.cover;
                  // 优先使用缓存 URI，其次原始 URL
                  const coverUri = coverCache.get(bookId) || rawCoverUrl || '';
                  const coverFailed = failedCovers.has(bookId);
                  const isLast = i === stats.readLongest.length - 1;
                  return (
                    <View key={i} style={[S.longestRow, isLast && { borderBottomWidth: 0 }]}>
                      <View style={S.longestRank}>
                        <Text style={S.longestRankText}>{i + 1}</Text>
                      </View>
                      {coverUri && !coverFailed ? (
                        <Image
                          source={{ uri: coverUri, cache: 'force-cache' }}
                          style={S.longestCover}
                          onError={() => setFailedCovers(prev => new Set(prev).add(bookId))}
                        />
                      ) : (
                        <View style={[S.longestCover, { backgroundColor: colors.border, justifyContent: 'center', alignItems: 'center' }]}>
                          <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textTertiary }}>
                            {name ? name.charAt(0) : '?'}
                          </Text>
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={S.longestTitle} numberOfLines={1}>{name}</Text>
                        <Text style={S.longestMeta}>
                          {author}{item.tags.length > 0 ? ` · ${item.tags.join(' · ')}` : ''}
                        </Text>
                      </View>
                      <Text style={S.longestTime}>{formatSeconds(item.readTime)}</Text>
                    </View>
                  );
                })}
                </View>
              </View>
            )}

            <View style={{ height: 40 }} />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const CARD = { backgroundColor: '#FFF', borderRadius: 16, padding: 16, marginHorizontal: 16, marginBottom: 12 };

/**
 * 概览数值：位数多时自动缩小字号，保证永远单行不换行
 * （如「10911 笔记」在窄卡片里曾折成两行，撑高整张卡片）。
 */
const StatValue: React.FC<{ value: number | string }> = ({ value }) => (
  <Text
    style={S.statValue}
    numberOfLines={1}
    adjustsFontSizeToFit
    minimumFontScale={0.55}
    allowFontScaling={false}
  >
    {value}
  </Text>
);

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loadingContainer: { paddingTop: 100, alignItems: 'center' },
  errorContainer: { paddingTop: 80, alignItems: 'center', paddingHorizontal: 32 },
  errorIcon: { fontSize: 32, marginBottom: 12 },
  errorText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginBottom: 16 },
  retryBtn: { backgroundColor: colors.primary, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 12 },
  retryText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  navBar: {
    height: 38, backgroundColor: '#FFF',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  navTitle: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  content: { flex: 1 },

  // Stats overview card — 从 Settings 移入
  statsCard: {
    backgroundColor: colors.primary, borderRadius: 16,
    padding: 20, marginHorizontal: 16, marginTop: 12, marginBottom: 4,
    overflow: 'hidden',
  },
  statsTitle: { fontSize: 17, fontWeight: '700', color: '#FFF', marginBottom: 14 },
  statsGrid: { flexDirection: 'row', gap: 8 },
  statItem: {
    flex: 1, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 8, paddingVertical: 12, paddingHorizontal: 4,
  },
  statValue: { fontSize: 22, fontWeight: '700', color: '#FFF', textAlign: 'center' },
  statLabel: { fontSize: 11, color: 'rgba(255,255,255,0.8)', marginTop: 4 },

  // Mode tabs
  modeTabs: { flexDirection: 'row', justifyContent: 'center', marginTop: 8, marginHorizontal: 16, gap: 8 },
  modeTab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 14, backgroundColor: colors.border },
  modeTabActive: { backgroundColor: colors.primary },
  modeTabText: { fontSize: 15, color: colors.textSecondary, fontWeight: '500' },
  modeTabTextActive: { color: '#FFF', fontWeight: '600' },

  // Date picker — 微信读书风格箭头切换
  datePicker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#FFF', marginHorizontal: 16, marginTop: 12,
    borderRadius: 16, paddingHorizontal: 12, paddingVertical: 14,
  },
  dateArrowBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  dateArrow: { fontSize: 22, color: colors.primary, fontWeight: '300' },
  dateLabel: { fontSize: 15, color: colors.textPrimary, fontWeight: '600', flex: 1, textAlign: 'center' },

  // Metrics grid
  metricCard: {
    alignItems: 'center', backgroundColor: '#FFF',
    borderRadius: 12, paddingVertical: 10, paddingHorizontal: 4,
  },
  metricValue: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  metricLabel: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },

  // Section
  section: { marginBottom: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },

  // Hour chart
  chartCard: { ...CARD, paddingVertical: 12 },
  hourChart: { flexDirection: 'row', alignItems: 'flex-end', height: 90, gap: 0 },
  hourBar: {
    width: '100%', borderRadius: 3, backgroundColor: colors.border, minHeight: 1,
  },
  hourBarActive: { backgroundColor: '#5AC8FA' },
  hourBarDay: { backgroundColor: '#F59E0B' },
  hourLabel: { fontSize: 9, color: colors.textTertiary, marginTop: 3 },
  hourLabelBold: { fontSize: 10, color: colors.textSecondary, fontWeight: '600' },

  // Category
  categoryCard: { ...CARD, gap: 10 },
  categoryRow: { flexDirection: 'row', alignItems: 'center' },
  categoryName: { width: 80, fontSize: 12, color: colors.textPrimary, fontWeight: '500', textAlign: 'right' },
  categoryBarWrap: { flex: 1, height: 8, backgroundColor: colors.divider, borderRadius: 4, marginHorizontal: 8 },
  categoryBar: { height: 8, backgroundColor: colors.primary, borderRadius: 4 },
  categoryBooks: { fontSize: 12, color: colors.textSecondary, width: 30, textAlign: 'right' },

  // Longest reads
  longestCard: { ...CARD, paddingVertical: 4, paddingHorizontal: 4 },
  longestRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 12,
    borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  longestRank: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center',
    marginRight: 12,
  },
  longestRankText: { fontSize: 13, fontWeight: '700', color: '#FFF' },
  longestCover: {
    width: 36, height: 48, borderRadius: 6,
    marginRight: 10, backgroundColor: colors.border,
  },
  longestTitle: { fontSize: 14, fontWeight: '600', color: colors.textPrimary, marginBottom: 2 },
  longestMeta: { fontSize: 12, color: colors.textSecondary },
  longestTime: { fontSize: 13, fontWeight: '600', color: colors.primary },
});
