import { colors } from '../theme/colors';
import React, { useState, useCallback } from 'react';
import pkg from '../../package.json';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, TextInput, ActivityIndicator, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { getSettings, saveSettings, getBooks, saveBooks, getNotes, saveNotes } from '../services/storage';
import AlertModal from '../components/AlertModal';

/** 脱敏显示 API Key（对齐书迹：≤8位→****，否则前4+****+后4） */
function maskedSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '****';
  return value.slice(0, 4) + '****' + value.slice(-4);
}
import { validateApiKey, importFromWeRead, WeReadAuthError, ImportProgress } from '../services/weread-api';
import { fetchKnowledgeBases, validateImaCredentials } from '../services/ima-api';
import type { AppSettings, KnowledgeBase } from '../types';

export default function SettingsScreen(_props: any) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [apiKeyStatus, setApiKeyStatus] = useState<'unknown' | 'valid' | 'invalid'>('unknown');
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertConfig, setAlertConfig] = useState<{ title: string; message: string; buttons?: any[] } | null>(null);
  const insets = useSafeAreaInsets();

  const showAlert = (title: string, message: string, buttons?: any[]) => {
    setAlertConfig({ title, message, buttons });
    setAlertVisible(true);
  };

  const loadData = useCallback(async () => {
    try {
      const s = await getSettings();
      setSettings(s);
      setApiKeyStatus(s.weread.apiKey ? 'unknown' : 'unknown');
      setSynced(!!(s.ima.knowledgeBases && s.ima.knowledgeBases.length > 0));
    } catch (e: any) {
      showAlert('加载失败', e.message || '无法读取设置数据', [{ text: '好的' }]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const updateSetting = async (path: string[], value: string | boolean) => {
    if (!settings) return;
    const updated = structuredClone(settings);
    let obj: any = updated;
    for (let i = 0; i < path.length - 1; i++) {
      obj = obj[path[i]];
    }
    obj[path[path.length - 1]] = value;
    setSettings(updated);
    await saveSettings(updated);
  };

  const handleVerifyApiKey = async () => {
    if (!settings?.weread.apiKey) {
      showAlert('提示', '请先填写微信读书 API Key（wrk- 开头）', [{ text: '好的' }]);
      return;
    }
    setVerifying(true);
    try {
      const isValid = await validateApiKey(settings.weread.apiKey);
      setApiKeyStatus(isValid ? 'valid' : 'invalid');
      showAlert(
        isValid ? '验证成功' : '验证失败',
        isValid ? '微信读书 API Key 有效，可以正常导入' : 'API Key 无效或已过期，请重新获取',
        [{ text: '好的' }],
      );
    } catch (e: any) {
      setApiKeyStatus('invalid');
      showAlert('验证失败', e.message || '网络错误，请重试', [{ text: '好的' }]);
    } finally {
      setVerifying(false);
    }
  };

  const handleClearApiKey = async () => {
    if (!settings) return;
    const updated = structuredClone(settings);
    updated.weread = { apiKey: '' };
    setSettings(updated);
    setApiKeyStatus('unknown');
    await saveSettings(updated);
  };

  /** 从微信读书导入书架和笔记 */
  const handleImport = async () => {
    if (!settings?.weread.apiKey) {
      showAlert('提示', '请先填写微信读书 API Key（wrk- 开头）', [{ text: '好的' }]);
      return;
    }
    if (!settings.weread.apiKey.startsWith('wrk-')) {
      showAlert('提示', 'API Key 格式错误，需要 wrk- 开头', [{ text: '好的' }]);
      return;
    }

    showAlert(
      '从微信读书导入',
      '将导入微信读书书架中的所有书籍和笔记，已有书籍不会重复导入。是否继续？',
      [
        { text: '取消', style: 'cancel' },
        { text: '开始导入', style: 'default', onPress: () => doImport() },
      ]
    );
  };

  const doImport = async () => {
    setImporting(true);
    setImportProgress({ phase: 'auth', message: '验证登录状态...', current: 0, total: 3 });

    try {
      const currentSettings = await getSettings();
      const result = await importFromWeRead(currentSettings, (progress) => {
        setImportProgress(progress);
      });

      // 导入即全量替换（对齐书迹：每次导入都是完整同步）
      await saveBooks(result.books);
      await saveNotes(result.notes);

      const totalNotesImported = result.notes.length;
      const failedBooks = result.bookResults.filter(r => !r.success);

      // 收集所有 API 错误
      const allApiErrors = new Map<string, number>(); // api → count
      for (const fb of failedBooks) {
        for (const err of fb.errors) {
          allApiErrors.set(err.error, (allApiErrors.get(err.error) || 0) + 1);
        }
      }

      // 构建详细的导入摘要
      let summary = `共导入 ${result.books.length} 本书`;
      if (totalNotesImported > 0) {
        summary += `\n获取 ${totalNotesImported} 条笔记`;
      }
      if (failedBooks.length > 0) {
        summary += `\n\n⚠️ ${failedBooks.length} 本书笔记获取异常：`;
        // 显示前 3 本失败的书籍详情
        for (const fb of failedBooks.slice(0, 3)) {
          const apiErrors = fb.errors.map(e => e.error).join(' | ');
          summary += `\n• 《${fb.title}》：${apiErrors || '未知错误'}`;
        }
        if (failedBooks.length > 3) {
          summary += `\n• ...等 ${failedBooks.length} 本`;
        }
        // 集中展示 API 错误类型及频次
        if (allApiErrors.size > 0) {
          summary += `\n\n🔍 错误类型统计：`;
          for (const [err, count] of allApiErrors) {
            summary += `\n  ${err}（${count} 次）`;
          }
        }
      } else if (totalNotesImported === 0 && result.books.length > 0) {
        summary += `\n\n⚠️ 所有书籍均未获取到笔记内容`;
        summary += `\n可能原因：`;
        summary += `\n1. 这些书确实没有划线和想法`;
        summary += `\n2. API Key 权限不足（请到微信读书重新生成）`;
        summary += `\n3. 网络问题，请稍后重试`;
        summary += `\n\n💡 建议：重新生成 API Key 后再试`;
      }

      // 验证数据是否正确保存
      const savedBooks = await getBooks();
      const savedNotes = await getNotes();
      if (__DEV__) console.log(`[Import] 验证: 存储中有 ${savedBooks.length} 本书, ${savedNotes.length} 条笔记`);

      if (result.books.length === 0 && totalNotesImported === 0) {
        summary = '没有找到有笔记的书籍。\n\n可能原因：\n1. 书架为空\n2. 所有书籍已导入\n3. 微信读书中没有划线或想法';
      }

      // 如果获取到笔记但保存后验证为 0，说明存储有问题
      if (totalNotesImported > 0 && savedNotes.length === 0) {
        summary += `\n\n⚠️ 严重：获取了 ${totalNotesImported} 条笔记，但保存后验证为 0 条 — 存储模块可能存在问题`;
      }

      showAlert('导入结果', summary, [{ text: '好的' }]);

      // 刷新统计数据
      try {
        await loadData();
      } catch (e) {
        if (__DEV__) console.warn('[Import] 刷新统计失败:', e);
      }
    } catch (e: any) {
      if (e instanceof WeReadAuthError) {
        showAlert(
          '登录已过期',
          '微信读书 API Key 无效或已过期，请重新获取',
          [{ text: '确定' }]
        );
      } else {
        showAlert('导入失败', e.message || '未知错误，请重试', [{ text: '好的' }]);
      }
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  /** 同步 ima 知识库列表 */
  const handleSyncKnowledgeBases = async () => {
    if (!settings?.ima.apiKey || !settings?.ima.clientId) {
      showAlert('提示', '请先填写 ima API Key 和 Client ID', [{ text: '好的' }]);
      return;
    }
    setSyncing(true);
    try {
      const kbs = await fetchKnowledgeBases(settings.ima.clientId, settings.ima.apiKey);
      const updated = structuredClone(settings);
      updated.ima = { ...updated.ima, knowledgeBases: kbs };
      setSettings(updated);
      await saveSettings(updated);
      setSynced(true);
      if (kbs.length === 0) {
        showAlert(
          '同步完成',
          '未获取到知识库（0 个）。\n\n可能原因：\n1. IMA 账号下没有知识库\n2. API 返回格式变更，请检查更新\n3. Client ID / API Key 不匹配',
          [{ text: '确定' }]
        );
      } else {
        showAlert('同步成功', `获取到 ${kbs.length} 个知识库`, [{ text: '好的' }]);
      }
    } catch (e: any) {
      showAlert('同步失败', e.message || '请检查 API Key 和 Client ID 是否正确', [{ text: '好的' }]);
    } finally {
      setSyncing(false);
    }
  };

  /** 选择默认知识库 */
  const handleSelectDefaultKB = async (kb: KnowledgeBase) => {
    if (!settings) return;
    const updated = structuredClone(settings);
    updated.sync = { ...updated.sync, defaultKnowledgeBase: kb.id };
    setSettings(updated);
    await saveSettings(updated);
  };

  /** 清除 ima 配置 */
  const handleClearIma = async () => {
    if (!settings) return;
    const updated = structuredClone(settings);
    updated.ima = { apiKey: '', clientId: '', knowledgeBases: [] };
    updated.sync = { ...updated.sync, defaultKnowledgeBase: '' };
    setSettings(updated);
    setSynced(false);
    await saveSettings(updated);
  };

  const getDefaultKBName = (): string => {
    if (!settings?.sync.defaultKnowledgeBase || !settings?.ima.knowledgeBases) return '';
    const kb = settings.ima.knowledgeBases.find(
      k => k.id === settings.sync.defaultKnowledgeBase
    );
    return kb ? kb.name : '';
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.loadingContainer, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!settings) return null;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Nav Bar */}
      <View style={styles.navBar}>
        <View style={{ width: 44 }} />
        <Text style={styles.navTitle}>我的</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* ==================== 微信读书配置 ==================== */}
        <Text style={styles.groupTitle}>微信读书</Text>
        <View style={styles.card}>
          {/* API Key 认证行 */}
          <View style={styles.settingRow}>
            <View style={styles.settingRowLeft}>
              <Text style={styles.settingRowTitle}>API Key 认证</Text>
              <Text style={[
                styles.settingRowDesc,
                apiKeyStatus === 'valid' && styles.textSuccess,
                apiKeyStatus === 'invalid' && styles.textError,
              ]}>
                {apiKeyStatus === 'valid' ? '已验证'
                  : apiKeyStatus === 'invalid' ? '已失效'
                  : settings.weread.apiKey ? '未验证' : '未配置'}
              </Text>
            </View>
            <View style={styles.settingRowActions}>
              <TouchableOpacity
                style={styles.btnSmall}
                onPress={handleVerifyApiKey}
                disabled={verifying}
              >
                {verifying ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.btnSmallText}>验证</Text>
                )}
              </TouchableOpacity>
              {settings.weread.apiKey ? (
                <TouchableOpacity style={styles.btnSmallOutline} onPress={handleClearApiKey}>
                  <Text style={styles.btnSmallOutlineText}>清除</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          <View style={styles.separator} />

          {/* 输入框 */}
          <View style={styles.inputSection}>
            <TextInput
              style={styles.input}
              value={settings.weread.apiKey}
              onChangeText={v => updateSetting(['weread', 'apiKey'], v)}
              placeholder="输入 wrk-xxxxxxxx"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            {settings.weread.apiKey ? (
              <Text style={styles.maskedHint}>当前：{maskedSecret(settings.weread.apiKey)}</Text>
            ) : null}
          </View>

          <View style={styles.separator} />

          <TouchableOpacity
            style={[styles.primaryBtn, (!settings.weread.apiKey || importing) && styles.primaryBtnDisabled]}
            onPress={handleImport}
            disabled={!settings.weread.apiKey || importing}
            activeOpacity={0.7}
          >
            {importing ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Text style={styles.primaryBtnText}>从微信读书导入</Text>
            )}
          </TouchableOpacity>
          <Text style={styles.primaryBtnHint}>
            {!settings.weread.apiKey
              ? '请先配置 API Key 后再导入'
              : importing
                ? (importProgress?.message || '准备中...')
                : '将书架与笔记完整同步到本地'}
          </Text>
        </View>

        {/* ==================== ima 连接凭证 ==================== */}
        <Text style={styles.groupTitle}>ima 连接凭证</Text>
        <View style={styles.card}>
          {/* 凭证状态行 */}
          <View style={styles.settingRow}>
            <View style={styles.settingRowLeft}>
              <Text style={styles.settingRowTitle}>ima 凭证</Text>
              <Text style={[
                styles.settingRowDesc,
                settings.ima.apiKey && settings.ima.clientId && styles.textSuccess,
              ]}>
                {settings.ima.apiKey && settings.ima.clientId ? '已配置' : '未配置'}
              </Text>
            </View>
            <View style={styles.settingRowActions}>
              <TouchableOpacity
                style={[styles.btnSmall, (syncing || !settings.ima.apiKey || !settings.ima.clientId) && styles.btnSmallDisabled]}
                onPress={async () => {
                  if (!settings.ima.apiKey || !settings.ima.clientId) return;
                  setSyncing(true);
                  try {
                    const result = await validateImaCredentials(settings.ima.clientId, settings.ima.apiKey);
                    showAlert(result.valid ? '连接成功' : '连接失败', result.message || (result.valid ? 'ima 凭证有效' : '请检查凭证'), [{ text: '好的' }]);
                  } catch (e: any) {
                    showAlert('测试失败', e.message || '未知错误', [{ text: '好的' }]);
                  } finally {
                    setSyncing(false);
                  }
                }}
                disabled={syncing || !settings.ima.apiKey || !settings.ima.clientId}
              >
                <Text style={styles.btnSmallText}>{syncing ? '测试中' : '测试'}</Text>
              </TouchableOpacity>
              {settings.ima.apiKey || settings.ima.clientId ? (
                <TouchableOpacity style={styles.btnSmallOutline} onPress={handleClearIma}>
                  <Text style={styles.btnSmallOutlineText}>清除</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          <View style={styles.separator} />

          {/* 输入框区 */}
          <View style={styles.inputSection}>
            <View>
              <Text style={styles.inputLabel}>Client ID</Text>
              <TextInput
                style={styles.input}
                value={settings.ima.clientId}
                onChangeText={v => updateSetting(['ima', 'clientId'], v)}
                placeholder="粘贴 ima Client ID"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <View style={styles.inputGap} />
            <View>
              <Text style={styles.inputLabel}>API Key</Text>
              <TextInput
                style={styles.input}
                value={settings.ima.apiKey}
                onChangeText={v => updateSetting(['ima', 'apiKey'], v)}
                placeholder="粘贴 ima API Key"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />
            </View>
          </View>

          <View style={styles.separator} />

          {/* 获取指南 */}
          <View style={styles.guideBlock}>
            <Text style={styles.guideTitle}>如何获取 ima 凭证</Text>
            <View style={styles.guideStepRow}>
              <Text style={styles.guideNum}>1</Text>
              <Text style={styles.guideStep}>打开 ima.qq.com/agent-interface</Text>
            </View>
            <View style={styles.guideStepRow}>
              <Text style={styles.guideNum}>2</Text>
              <Text style={styles.guideStep}>登录后获取 Client ID 和 API Key</Text>
            </View>
            <View style={styles.guideStepRow}>
              <Text style={styles.guideNum}>3</Text>
              <Text style={styles.guideStep}>填入上方输入框，点击「测试连接」</Text>
            </View>
          </View>
        </View>

        {/* ==================== ima 知识库 ==================== */}
        <Text style={styles.groupTitle}>ima 知识库</Text>
        <View style={styles.card}>
          {/* 知识库列表行 */}
          <View style={styles.settingRow}>
            <View style={styles.settingRowLeft}>
              <Text style={styles.settingRowTitle}>知识库列表</Text>
              <Text style={[
                styles.settingRowDesc,
                settings.sync.defaultKnowledgeBase && styles.textSuccess,
              ]}>
                {settings.sync.defaultKnowledgeBase
                  ? `已选：${getDefaultKBName()}`
                  : '尚未选择'}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.btnSmall, (syncing || !settings.ima.apiKey || !settings.ima.clientId) && styles.btnSmallDisabled]}
              onPress={handleSyncKnowledgeBases}
              disabled={syncing || !settings.ima.apiKey || !settings.ima.clientId}
            >
              {syncing ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Text style={styles.btnSmallText}>{synced ? '刷新' : '同步'}</Text>
              )}
            </TouchableOpacity>
          </View>

          {settings.ima.apiKey && settings.ima.clientId ? (
            <>
              <View style={styles.separator} />
              {/* KB 列表 */}
              {settings.ima.knowledgeBases && settings.ima.knowledgeBases.length > 0 ? (
                <View style={styles.kbList}>
                  {settings.ima.knowledgeBases.map((kb, idx) => {
                    const isDefault = settings.sync.defaultKnowledgeBase === kb.id;
                    return (
                      <TouchableOpacity
                        key={kb.id}
                        style={[styles.kbRow, idx === 0 && styles.kbRowFirst, isDefault && styles.kbRowSelected]}
                        onPress={() => handleSelectDefaultKB(kb)}
                      >
                        <View style={styles.kbRowLeft}>
                          <View style={[styles.kbIndicator, isDefault && styles.kbIndicatorActive]}>
                            {isDefault && <Text style={styles.kbIndicatorText}>✓</Text>}
                          </View>
                          <View style={styles.kbRowInfo}>
                            <Text style={[styles.kbRowName, isDefault && styles.kbRowNameSelected]}>
                              {kb.name}
                            </Text>
                            <Text style={styles.kbRowId}>{kb.id}</Text>
                          </View>
                        </View>
                        {isDefault && (
                          <View style={styles.kbBadge}>
                            <Text style={styles.kbBadgeText}>默认</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : syncing ? (
                <ActivityIndicator size="small" color={colors.primary} style={{ paddingVertical: 16 }} />
              ) : (
                <View style={styles.kbEmpty}>
                  <Text style={styles.kbEmptyText}>
                    {synced
                      ? '没有个人知识库，请先在 ima 中创建'
                      : '保存凭证后点击「同步」获取列表'}
                  </Text>
                </View>
              )}

              <View style={styles.separator} />

              <Text style={styles.cardFootnote}>只显示个人知识库，共享知识库不会出现在这里</Text>
            </>
          ) : (
            <View style={styles.kbEmpty}>
              <Text style={styles.kbEmptyText}>请先配置 ima 凭证</Text>
            </View>
          )}
        </View>

        {/* ==================== 关于 ==================== */}
        <Text style={styles.groupTitle}>关于</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={styles.settingRowLeft}>
              <Text style={styles.settingRowTitle}>版本</Text>
            </View>
            <Text style={styles.settingRightValue}>{pkg.version}</Text>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Import Progress Modal */}
      <Modal visible={importing} transparent animationType="fade">
        <View style={styles.importOverlay}>
          <View style={styles.importCard}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.importTitle}>正在导入</Text>
            <Text style={styles.importMessage}>
              {importProgress?.message || '准备中...'}
            </Text>
            {importProgress && importProgress.total > 0 && (
              <View style={styles.progressBarBg}>
                <View style={[styles.progressBarFill, {
                  width: `${Math.round((importProgress.current / importProgress.total) * 100)}%`,
                }]} />
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* 系统风格 Alert */}
      <AlertModal
        visible={alertVisible}
        title={alertConfig?.title || ''}
        message={alertConfig?.message || ''}
        buttons={alertConfig?.buttons}
        onClose={() => setAlertVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // ─── 容器 ───
  container: { flex: 1, backgroundColor: colors.bg },
  loadingContainer: { justifyContent: 'center', alignItems: 'center' },

  // ─── 导航栏 ───
  navBar: {
    height: 44, backgroundColor: '#FFF',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  navTitle: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },

  // ─── 内容区 ───
  content: { flex: 1 },

  // ─── 分组标题 ───
  groupTitle: {
    paddingHorizontal: 20, paddingTop: 14, paddingBottom: 5,
    fontSize: 13, fontWeight: '600', color: colors.textSecondary,
  },

  // ─── 卡片 ───
  card: {
    backgroundColor: '#FFF', borderRadius: 14,
    marginHorizontal: 16, marginBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.02, shadowRadius: 3, elevation: 0,
    overflow: 'hidden',
  },

  // ─── 设置行（iOS 风格） ───
  settingRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, minHeight: 52,
  },
  settingRowLeft: { flex: 1, marginRight: 12 },
  settingRowTitle: { fontSize: 16, color: colors.textPrimary },
  settingRowDesc: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  settingRowActions: { flexDirection: 'row', gap: 6 },
  settingRightValue: { fontSize: 16, color: colors.textSecondary, fontWeight: '500' },

  // ─── 分隔线 ───
  separator: { height: 0.5, backgroundColor: colors.border, marginLeft: 16 },

  // ─── 按钮体系 ───
  btnSmall: {
    backgroundColor: colors.primary, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 7, minWidth: 52,
    alignItems: 'center', justifyContent: 'center',
  },
  btnSmallDisabled: { opacity: 0.5 },
  btnSmallText: { color: '#FFF', fontSize: 13, fontWeight: '600' },
  btnSmallOutline: {
    borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 14, paddingVertical: 7, minWidth: 52,
    alignItems: 'center', justifyContent: 'center',
  },
  btnSmallOutlineText: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },

  // ─── 主按钮（导入） ───
  primaryBtn: {
    backgroundColor: colors.primary, borderRadius: 12,
    marginHorizontal: 16, marginTop: 14,
    height: 48, justifyContent: 'center', alignItems: 'center',
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  primaryBtnHint: {
    fontSize: 12, color: colors.textSecondary, textAlign: 'center',
    marginHorizontal: 16, marginTop: 8, marginBottom: 14,
  },

  // ─── 输入框 ───
  inputSection: { paddingHorizontal: 16, paddingVertical: 10 },
  inputGap: { height: 10 },
  inputLabel: { fontSize: 12, color: colors.textSecondary, marginBottom: 4, fontWeight: '500' },
  input: {
    height: 44, borderWidth: 1.5, borderColor: colors.border, borderRadius: 12,
    paddingHorizontal: 12, fontSize: 15, color: colors.textPrimary, backgroundColor: '#FFF',
  },
  maskedHint: { fontSize: 11, color: colors.textSecondary, marginTop: 6 },

  // ─── 指南块 ───
  guideBlock: {
    paddingHorizontal: 16, paddingVertical: 10,
  },
  guideTitle: { fontSize: 14, fontWeight: '600', color: colors.textPrimary, marginBottom: 10 },
  guideStepRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    marginBottom: 6,
  },
  guideNum: {
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: colors.primaryBg, color: colors.primary,
    fontSize: 11, fontWeight: '700', textAlign: 'center', lineHeight: 18,
    marginRight: 8, marginTop: 1, overflow: 'hidden',
  },
  guideStep: {
    flex: 1, fontSize: 13, color: colors.textPrimary, lineHeight: 20,
  },

  // ─── 知识库列表 ───
  kbList: {},
  kbRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingLeft: 16, paddingRight: 16, paddingVertical: 12,
    borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  kbRowFirst: { borderTopWidth: 0 },
  kbRowSelected: { backgroundColor: colors.primaryBg },
  kbRowLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  kbIndicator: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 1.5, borderColor: colors.border,
    justifyContent: 'center', alignItems: 'center',
    marginRight: 12,
  },
  kbIndicatorActive: {
    backgroundColor: colors.primary, borderColor: colors.primary,
  },
  kbIndicatorText: { color: '#FFF', fontSize: 11, fontWeight: '700' },
  kbRowInfo: { flex: 1 },
  kbRowName: { fontSize: 15, color: colors.textPrimary, fontWeight: '500' },
  kbRowNameSelected: { color: colors.primary, fontWeight: '600' },
  kbRowId: { fontSize: 11, color: colors.textSecondary, marginTop: 1 },
  kbBadge: {
    backgroundColor: colors.primary, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  kbBadgeText: { color: '#FFF', fontSize: 11, fontWeight: '600' },
  kbEmpty: {
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  kbEmptyText: { fontSize: 13, color: colors.textSecondary, textAlign: 'center' },

  // ─── 卡片脚注 ───
  cardFootnote: {
    fontSize: 11, color: colors.textSecondary, textAlign: 'center',
    paddingHorizontal: 16, paddingVertical: 10,
  },

  // ─── 语义色 ───
  textSuccess: { color: colors.primary },
  textError: { color: colors.error },

  // ─── 导入弹窗 ───
  importOverlay: {
    flex: 1, backgroundColor: colors.overlay,
    justifyContent: 'center', alignItems: 'center',
  },
  importCard: {
    backgroundColor: '#FFF', borderRadius: 20,
    padding: 32, marginHorizontal: 40, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04, shadowRadius: 12, elevation: 2,
  },
  importTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginTop: 16 },
  importMessage: { fontSize: 14, color: colors.textSecondary, marginTop: 8, textAlign: 'center' },
  progressBarBg: {
    width: '100%', height: 6, borderRadius: 3,
    backgroundColor: colors.border, marginTop: 16, overflow: 'hidden',
  },
  progressBarFill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
});
