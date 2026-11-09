/**
 * 导出服务 — 统一管道：Markdown → 目标格式
 *
 * 保存策略（targetSdk 36，零权限），依据 Android 官方文档（storage use-cases / MediaStore）：
 *   Android 10+ 向 MediaStore.Downloads 写入「应用自有文件」无需任何存储权限，
 *   且 RELATIVE_PATH 可指定子文件夹（Download/微阅），对标微信静默保存。
 *   S1 【主路径】NativeModules.FileSaver → MediaStore.Downloads 静默写入 Download/微阅/（零权限零交互）
 *   S2 【兜底】已 SAF 授权过的 treeUri → 静默写入 Download/微阅/（个别 OEM 让 MediaStore 返回 null 时）
 *   S3 【兜底】首次 SAF 目录选择器（不预置 Download 根，避免 Android 11+ 限制）→ 授权后持久化
 *   S4 【终极兜底】文件始终备份到 weiyue-export/（应用持久目录），并告知用户取回路径
 *   注意：Android 11+ 禁止用 ACTION_OPEN_DOCUMENT_TREE 选择 Download 根目录，故不预置。
 */

import { Paths, Directory, File } from 'expo-file-system';
import * as FileSystem from 'expo-file-system';
// ⚠️ expo-file-system 56.x 将 SAF API 移到了 /legacy 子路径
const { StorageAccessFramework: Saf, readAsStringAsync: legacyReadAsync } = require('expo-file-system/legacy');
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { Platform, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveToDownloadsAsync, isSaveToDownloadsAvailable } from './file-saver';
import { getBooks, getNotes, getSettings } from './storage';
import { createMedia, uploadToCos, addKnowledgeToKb, utf8ByteLength } from './ima-api';
import type { Book, Note } from '../types';

// ====== 统一版本号（与 app.json 同步） ======
const APP_VERSION: string = (require('../../app.json') as any).expo.version || '2.0.0';

// ====== 工具 ======

function safeFilename(title: string): string {
  const cleaned = title
    .replace(/[\x00-\x1f]/g, '_')
    .replace(/[\\/:*?"<>|~$&+,:;=?@#|'<>.^*()%!]/g, '_')
    .trim();
  const collapsed = cleaned
    .replace(/\s+/g, ' ')
    .replace(/_+/g, '_')
    .trim()
    .replace(/^_|_$/g, '');
  return (collapsed || '未命名').slice(0, 80);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(iso: string): string {
  if (!iso) return '';
  // 直接截取 ISO 字符串前 10 位，避免本地时区转换导致日期偏移
  if (/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso.slice(0, 10);
  try {
    const d = new Date(iso);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch {
    return iso.slice(0, 10);
  }
}

function formatSeconds(s: number): string {
  if (s <= 0) return '0分钟';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0 && m > 0) return `${h}小时${m}分钟`;
  if (h > 0) return `${h}小时`;
  return `${m}分钟`;
}

let _exportDir: Directory | null = null;

async function getExportDir(): Promise<Directory> {
  if (!_exportDir) {
    const dir = new Directory(Paths.document, 'weiyue-export');
    if (!dir.exists) dir.create({ intermediates: true });
    _exportDir = dir;
  }
  return _exportDir;
}

/** 导出结果 */
export interface ExportResult {
  filePath: string;
  fileName: string;
  mimeType: string;
}

/** 文件信息 */
export interface FileInfo {
  exists: boolean;
  uri: string;
  size?: number;
}

/** 将 MIME 类型映射为更精确的值 */
function getMimeType(fileName: string, mimeType?: string): string {
  if (fileName.endsWith('.pdf')) return 'application/pdf';
  if (fileName.endsWith('.epub')) return 'application/epub+zip';
  if (fileName.endsWith('.md')) return 'text/markdown';
  return mimeType || 'application/octet-stream';
}

/**
 * 保存文件到设备本地（Android 16 / targetSdk 36 适配，零权限）
 *
 * 策略（按顺序尝试，前一个失败自动降级）：
 *   S1 原生 MediaStore.Downloads 静默保存（最佳，零交互，像微信）
 *   S2 持久化 SAF tree URI 静默写入（首次授权后永久静默）
 *   S3 SAF 目录选择器（首次授权，弹一次，之后走 S2）
 *   S4 expo-sharing 分享菜单（终极兜底）
 *   全部失败 → 弹出诊断信息（显示每一步的真实错误）
 *
 * 文件始终先备份到 weiyue-export/（应用持久目录），保证不丢失。
 *
 * @param sourcePath 源文件路径
 * @param fileName   目标文件名（含扩展名）
 * @param mimeType   MIME 类型
 * @returns 保存路径（content:// 或 file://），失败/取消返回空字符串
 */
const SAF_TREE_URI_KEY = 'weiyue_saf_tree_uri';
const SAF_DIR_URI_KEY = 'weiyue_saf_dir_uri';

async function loadTreeUri(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(SAF_TREE_URI_KEY);
  } catch {
    return null;
  }
}

async function persistTreeUri(uri: string): Promise<void> {
  try {
    await AsyncStorage.setItem(SAF_TREE_URI_KEY, uri);
  } catch {
    /* ignore */
  }
}

/** 清除已失效的 SAF tree URI 缓存（权限被回收 / OEM 清理后需重新授权，同时清子目录缓存） */
async function clearTreeUri(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SAF_TREE_URI_KEY);
    await AsyncStorage.removeItem(SAF_DIR_URI_KEY);
  } catch {
    /* ignore */
  }
}

/** 「微阅」子目录 URI 持久化（避免每次导出都新建同名文件夹） */
async function loadWeiyueDirUri(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(SAF_DIR_URI_KEY);
  } catch {
    return null;
  }
}

async function persistWeiyueDirUri(uri: string): Promise<void> {
  try {
    await AsyncStorage.setItem(SAF_DIR_URI_KEY, uri);
  } catch {
    /* ignore */
  }
}

async function clearWeiyueDirUri(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SAF_DIR_URI_KEY);
  } catch {
    /* ignore */
  }
}

/** 判断 SAF 错误是否属于"URI/权限失效"（应清除缓存并重授权） */
function isSafUriInvalidError(e: any): boolean {
  const msg = ((e?.message || String(e)) as string).toLowerCase();
  return (
    msg.includes("isn't writable") ||
    msg.includes("is not writable") ||
    msg.includes("rejected") ||
    msg.includes("permission denied") ||
    msg.includes("security exception") ||
    msg.includes("illegalargumentexception")
  );
}

export async function saveFile(sourcePath: string, fileName: string, mimeType?: string): Promise<string> {
  // Step 1: 复制到应用持久文档目录（兜底，保证文件不丢）
  const docDir = await getExportDir();
  const cleanSource = sourcePath.replace(/^file:\/\//, '');
  const destFile = new File(docDir, fileName);

  try {
    const bytes = new File(cleanSource).bytesSync();
    destFile.write(bytes);
  } catch {
    const bytes = new File(sourcePath).bytesSync();
    destFile.write(bytes);
  }

  const resolvedMime = getMimeType(fileName, mimeType);

  // ====== iOS：系统分享面板（原生支持"存储到文件"） ======
  if (Platform.OS === 'ios') {
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(destFile.uri, {
          mimeType: resolvedMime,
          dialogTitle: '保存文件',
        }).catch(() => {});
        return destFile.uri;
      }
    } catch {
      /* ignore */
    }
    Alert.alert('保存失败', 'iOS 分享不可用，文件已暂存在应用内（weiyue-export/）。');
    return '';
  }

  // ====== Android：官方推荐零权限方案 ======
  // 主路径：MediaStore.Downloads 静默写入 Download/微阅/（Android 10+ 零权限，对标微信）
  // 兜底：MediaStore 在个别 OEM 返回 null 时，用 SAF 目录授权（一次性）写入
  const errors: string[] = [];

  // S1: MediaStore.Downloads 静默保存（首选，零权限零交互）
  try {
    if (isSaveToDownloadsAvailable()) {
      const r = await saveToDownloadsAsync(destFile.uri, fileName, resolvedMime);
      if (r) {
        if (__DEV__) console.log('[Export] MediaStore 静默保存成功:', r);
        return r;
      }
      errors.push('• MediaStore 返回空（个别 OEM 限制 Downloads 写入，转 SAF 兜底）');
    } else {
      errors.push('• 原生模块未注册 (NativeModules.FileSaverModule 不可用)');
    }
  } catch (e: any) {
    errors.push('• MediaStore 异常: ' + (e?.message || String(e)));
  }

  // S2: 已授权过的 SAF treeUri → 静默写入 Download/微阅/
  let needReauthSaf = false; // 标记：旧 URI 失效，需要重新走 S3 授权
  try {
    const treeUri = await loadTreeUri();
    if (treeUri) {
      const r = await safWriteFile(treeUri, destFile.uri, fileName, resolvedMime);
      if (__DEV__) console.log('[Export] SAF 持久写入结果:', r || '(null)');
      if (r) return r;
      const failReason = r === null ? '未知原因' : '见下方';
      errors.push('• 已授权文件夹写入失败 (' + failReason + ')');
    }
  } catch (e: any) {
    if (isSafUriInvalidError(e)) {
      // URI / 权限已失效（OEM 回收权限、系统清理等）→ 清除旧缓存，标记需重授权
      await clearTreeUri();
      needReauthSaf = true;
      errors.push('• SAF 授权已失效（' + (e?.message || String(e)) + '），将重新请求授权');
    } else {
      errors.push('• SAF 持久写入异常: ' + (e?.message || String(e)));
    }
  }

  // S3: SAF 目录选择器（needReauthSaf=true 时自动触发，不弹确认；否则先征求用户同意）
  const granted = needReauthSaf
    ? true
    : await new Promise<boolean>((resolve) => {
    Alert.alert(
      '选择保存位置',
      '系统自动保存不可用，请手动选择保存位置。\n\n请选择「下载」文件夹本身（选中「下载」即可，不要点进「微阅」子文件夹后再选）。应用会自动在下载下新建「微阅」文件夹，之后文件都保存在 下载/微阅/。\n\n只需授权一次。',
      [
        { text: '暂不保存', style: 'cancel', onPress: () => resolve(false) },
        { text: '去选择', onPress: () => resolve(true) },
      ],
    );
  });

  if (granted) {
    try {
      // 关键：不预置 Download 根（Android 11+ 禁止 ACTION_OPEN_DOCUMENT_TREE 选择 Download 根）
      const saf = await Saf.requestDirectoryPermissionsAsync();
      if (saf.granted && saf.directoryUri) {
        await persistTreeUri(saf.directoryUri);
        const r = await safWriteFile(saf.directoryUri, destFile.uri, fileName, resolvedMime);
        if (__DEV__) console.log('[Export] SAF 授权后写入结果:', r || '(null)');
        if (r) {
          if (__DEV__) console.log('[Export] SAF 授权后写入成功:', r);
          return r;
        }
        const failReason = r === null ? '未知原因' : '见下方';
        errors.push('• 授权成功但写入失败 (' + failReason + ')');
      } else {
        errors.push('• 用户取消了文件夹选择');
      }
    } catch (e: any) {
      errors.push('• SAF 授权异常: ' + (e?.message || String(e)));
    }
  } else {
    errors.push('• 用户未授权');
  }

  // S4: 终极兜底 — 文件已安全保存在 Step 1 的应用专属目录（documentDirectory）
  // 借鉴 MusicFree 方案：Android 10+ 作用域存储下，应用对自己外部存储目录拥有零权限自由读写权。
  // 路径示例：/storage/emulated/0/Android/data/com.weiyue.app/files/weiyue-export/<文件名>
  // 用户可通过系统文件管理器 → Android/data/com.weiyue.app/files/weiyue-export/ 找到文件。
  if (__DEV__) console.log('[Export] 全部公共目录方案失败，返回应用内备份路径:', destFile.uri);
  Alert.alert(
    '已保存到应用内目录',
    '无法写入公共「下载」文件夹（' + errors.length + ' 个原因见下方）。\n\n' +
      '✅ 文件已安全保存在应用内，可通过以下路径找到：\n' +
      '📂 系统文件管理器 → Android → data → com.weiyue.app → files → weiyue-export\n\n' +
      '技术信息：\n' + errors.join('\n'),
  );
  return destFile.uri;
}

/**
 * 通过 expo-file-system/legacy 的官方 SAF API 将文件写入授权目录下的「微阅」子文件夹。
 *
 * 使用 Expo 官方封装（makeDirectoryAsync / createFileAsync / writeAsStringAsync），
 * 替代自定义原生模块的 DocumentsContract 方案，确保 Android 16 兼容性。
 */
async function safWriteFile(
  treeUri: string,
  sourcePath: string,
  fileName: string,
  mimeType: string,
): Promise<string | null> {
  try {
    // ⚠️ expo-file-system 的 SAF 命名空间只有 readDirectoryAsync（返回 URI 字符串数组），
    //    没有 listFilesAsync（那是别的库的 API）。之前误用 listFilesAsync 抛错被吞，
    //    导致每次都走到 makeDirectoryAsync 新建「微阅 (N)」——正是"不停新建文件夹"的根因。
    const writeInto = async (dirUri: string): Promise<string | null> => {
      try {
        const fileUri = await Saf.createFileAsync(dirUri, fileName, mimeType);
        const content = await legacyReadAsync(sourcePath, { encoding: 'base64' });
        await Saf.writeAsStringAsync(fileUri, content, { encoding: 'base64' });
        if (__DEV__) console.log('[SAF] 写入成功:', fileUri);
        return fileUri;
      } catch (e: any) {
        if (__DEV__) console.log('[SAF] 写入失败:', dirUri, e?.message);
        return null;
      }
    };

    // 关键修复：判断用户授权的目录本身是不是就叫「微阅」
    //   - 用户选「下载」根 → 在其下建/复用「微阅」子目录（目标：下载/微阅/）
    //   - 用户误选了「微阅」文件夹本身 → 直接往该目录写，绝不再建子文件夹（避免 微阅/微阅 嵌套）
    const treeDecoded = decodeURIComponent(treeUri).replace(/\/+$/, '');
    const userPickedWeiyue = treeDecoded.endsWith('微阅');

    // 1) 优先复用持久化的「微阅」子目录 URI（创建一次后永久复用，绝不再 makeDirectory）
    const savedDir = await loadWeiyueDirUri();
    if (savedDir) {
      const ok = await writeInto(savedDir);
      if (ok) return ok;
      await clearWeiyueDirUri();
    }

    // 2) 用户直接选了「微阅」文件夹 → 直接写，持久化该目录（不再建子文件夹，避免嵌套）
    if (userPickedWeiyue) {
      const ok = await writeInto(treeUri);
      if (ok) {
        await persistWeiyueDirUri(treeUri);
        return ok;
      }
      throw new Error('SAF write into selected 微阅 dir failed');
    }

    // 3) 扫描已存在的「微阅」子目录（用户选的是下载根）；取「最浅」的那个，
    //    避免命中之前误产生的嵌套 微阅/微阅。
    if (typeof Saf.readDirectoryAsync === 'function') {
      try {
        const children: string[] = await Saf.readDirectoryAsync(treeUri);
        const candidates = children
          .filter((uri) => decodeURIComponent(uri).replace(/\/+$/, '').endsWith('微阅'))
          .sort(
            (a, b) =>
              decodeURIComponent(a).split('/').length - decodeURIComponent(b).split('/').length,
          );
        const existing = candidates[0];
        if (existing) {
          const ok = await writeInto(existing);
          if (ok) {
            await persistWeiyueDirUri(existing);
            return ok;
          }
        }
      } catch (e: any) {
        if (__DEV__) console.log('[SAF] readDirectoryAsync 异常:', e?.message);
      }
    }

    // 4) 不存在才在下载根下创建「微阅」子目录并持久化（makeDirectory 失败=权限失效，向上抛触发重授权）
    try {
      const newDir = await Saf.makeDirectoryAsync(treeUri, '微阅');
      await persistWeiyueDirUri(newDir);
      const ok = await writeInto(newDir);
      if (ok) return ok;
    } catch (e: any) {
      throw e;
    }

    return null;
  } catch (e: any) {
    // 将真实错误重新抛出，让调用方捕获并显示到诊断弹窗
    throw e;
  }
}

async function getNotesMap(bookIds: string[], filterNoteIds?: string[]): Promise<Map<string, Note[]>> {
  const allNotes = await getNotes();
  const filterSet = filterNoteIds ? new Set(filterNoteIds) : null;
  const map = new Map<string, Note[]>();
  for (const n of allNotes) {
    if (bookIds.includes(n.bookId) && (!filterSet || filterSet.has(n.id))) {
      if (!map.has(n.bookId)) map.set(n.bookId, []);
      map.get(n.bookId)!.push(n);
    }
  }
  return map;
}

// ====== Markdown 生成（单一数据源） ======

function groupNotesByChapter(notes: Note[]): { title: string; items: Note[] }[] {
  const map = new Map<string, Note[]>();
  for (const n of notes) {
    const key = n.chapter || '其他笔记';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(n);
  }
  return Array.from(map.entries()).map(([title, items]) => ({ title, items }));
}

/** 生成完整的书籍笔记 Markdown（极简纯文本风格，无分割线） */
function buildMarkdown(book: Book, notes: Note[]): string {
  const lines: string[] = [];

  // 标题
  lines.push(`# ${book.title} — ${book.author}`);
  lines.push('');

  // 笔记内容
  if (notes.length === 0) {
    lines.push('暂无可导出的划线或想法。');
    lines.push('');
  } else {
    const groups = groupNotesByChapter(notes);
    for (const group of groups) {
      lines.push(`## ${group.title}`);
      lines.push('');
      for (const n of group.items) {
        lines.push(n.text);
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

/** 生成上传到 IMA 知识库的 Markdown（去掉页脚，首行为 # 标题） */
function buildImaMarkdown(book: Book, notes: Note[]): string {
  const md = buildMarkdown(book, notes);
  const lines = md.split('\n');
  const h1Idx = lines.findIndex(l => l.startsWith('# '));
  if (h1Idx >= 0) return lines.slice(h1Idx).join('\n');
  return md;
}

// ====== 1. Markdown 导出 ======

export async function exportBooksMarkdown(bookIds: string[], noteIds?: string[]): Promise<ExportResult> {
  const dir = await getExportDir();
  const books = await getBooks();
  const selected = books.filter(b => bookIds.includes(b.id));
  if (selected.length === 0) throw new Error('未选择书籍');

  const notesMap = await getNotesMap(bookIds, noteIds);
  const mimeType = '*/*';

  if (selected.length === 1) {
    const book = selected[0];
    const md = buildMarkdown(book, notesMap.get(book.id) || []);
    const fileName = safeFilename(book.title) + '.md';
    const file = new File(dir, fileName);
    file.write(md);
    return { filePath: file.uri, fileName, mimeType };
  } else {
    const allMD = selected.map(b => buildMarkdown(b, notesMap.get(b.id) || [])).join('\n\n\\newpage\n\n');
    const fileName = `读书笔记_${selected.length}本.md`;
    const file = new File(dir, fileName);
    file.write(allMD);
    return { filePath: file.uri, fileName, mimeType };
  }
}

// ====== 2. PDF 导出（CSS 对齐 @skill:md2pdf-weasyprint） ======

/**
 * PDF 极简书页 CSS — 无分割线
 */
const MD2PDF_CSS = `
body {
  font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
  font-size: 11pt; line-height: 1.7; color: #444;
  padding: 20px; max-width: 500px; margin: 0 auto;
}
h1 { font-size: 18pt; font-weight: 500; color: #1C1C1E; margin-top: 0; margin-bottom: 8px; }
h2 { font-size: 14pt; font-weight: 500; color: #1C1C1E; margin-top: 20pt; margin-bottom: 8px; }
p { margin: 0 0 16pt 0; line-height: 1.7; }
.footer { text-align: center; color: #B4B2A9; font-size: 8pt; margin-top: 30pt; }
`;

/** 将单本书的笔记转换为极简书页 HTML */
function markdownToPdfHtml(book: Book, notes: Note[]): string {
  let html = `<h1>${escapeHtml(book.title)} — ${escapeHtml(book.author)}</h1>\n`;

  if (notes.length === 0) {
    html += '<p>暂无可导出的划线或想法。</p>\n';
  } else {
    const groups = groupNotesByChapter(notes);
    for (const group of groups) {
      html += `<h2>${escapeHtml(group.title)}</h2>\n`;
      for (const n of group.items) {
        html += `<p>${escapeHtml(n.text)}</p>\n`;
      }
    }
  }

  html += `<p class="footer">由 微阅 v${APP_VERSION} 导出</p>\n`;
  return html;
}

export async function exportBooksPDF(bookIds: string[], noteIds?: string[]): Promise<ExportResult> {
  const books = await getBooks();
  const selected = books.filter(b => bookIds.includes(b.id));
  if (selected.length === 0) throw new Error('未选择书籍');

  const notesMap = await getNotesMap(bookIds, noteIds);

  const htmlParts: string[] = [];
  for (let i = 0; i < selected.length; i++) {
    const book = selected[i];
    const notes = notesMap.get(book.id) || [];
    htmlParts.push(markdownToPdfHtml(book, notes));
    if (i < selected.length - 1) htmlParts.push('<div class="page-break"></div>');
  }

  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<style>${MD2PDF_CSS}</style></head><body>${htmlParts.join('\n')}</body></html>`;

  const { uri } = await Print.printToFileAsync({
    html,
    width: 595,   // A4 width in points
    height: 842,  // A4 height
    margins: {
      top: 20, left: 20, right: 20, bottom: 20,
    },
  });
  const fileName = selected.length === 1
    ? safeFilename(selected[0].title) + '.pdf'
    : `读书笔记_${selected.length}本.pdf`;

  return { filePath: uri, fileName, mimeType: '*/*' };
}

// ====== 3. EPUB 导出（章节解析 + 结构对齐 @skill:markdown-to-epub-converter） ======

/**
 * EPUB 极简书页 CSS — 无分割线
 */
const EPUBCONVERTER_CSS = `
body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; font-size: 85%; line-height: 1.6; margin: 0; padding: 1em; color: #444; }
h1 { font-size: 1.4em; font-weight: 500; margin: 1em 0 0.5em 0; color: #1C1C1E; }
h2 { font-size: 1.15em; font-weight: 500; margin: 1.2em 0 0.5em 0; color: #1C1C1E; }
p { margin: 0 0 1.2em 0; line-height: 1.6; }
.footer { text-align: center; color: #B4B2A9; font-size: 0.75em; margin-top: 2em; }
`;

function epubId(i: number): string { return `c${String(i).padStart(3, '0')}`; }

/** 单本书 XHTML 章节（极简书页风格，无分割线） */
function epubChapterXhtml(book: Book, notes: Note[]): string {
  let html = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN">
<head><meta charset="UTF-8"/><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
<h1>${escapeHtml(book.title)} — ${escapeHtml(book.author)}</h1>`;

  if (notes.length === 0) {
    html += '<p>暂无可导出的划线或想法。</p>';
  } else {
    const groups = groupNotesByChapter(notes);
    for (const group of groups) {
      html += `<h2>${escapeHtml(group.title)}</h2>`;
      for (const n of group.items) {
        html += `<p>${escapeHtml(n.text)}</p>`;
      }
    }
  }

  html += `<div class="footer">由 微阅 v${APP_VERSION} 导出</div></body></html>`;
  return html;
}

export async function exportBooksEPUB(bookIds: string[], noteIds?: string[]): Promise<ExportResult> {
  const dir = await getExportDir();
  const books = await getBooks();
  const selected = books.filter(b => bookIds.includes(b.id));
  if (selected.length === 0) throw new Error('未选择书籍');

  const notesMap = await getNotesMap(bookIds, noteIds);
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const now = new Date();
  const dateISO = now.toISOString();
  const dateStr = dateISO.slice(0, 10);
  const uuid = `urn:uuid:${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
  const bookTitle = selected.length === 1 ? selected[0].title : '微信读书笔记导出';

  // 1. mimetype（不压缩）
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  // 2. META-INF/container.xml
  zip.file('META-INF/container.xml',
    '<?xml version="1.0" encoding="UTF-8"?>'
    + '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
    + '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>'
    + '</container>');

  const oebps = zip.folder('OEBPS')!;

  // 3. 生成章节
  const manifestItems: string[] = [];
  const spineItems: string[] = [];
  const ncxPoints: string[] = [];

  oebps.file('style.css', EPUBCONVERTER_CSS);
  manifestItems.push('<item id="css" href="style.css" media-type="text/css"/>');

  let navHtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN">
<head><meta charset="UTF-8"/><title>目录</title></head>
<body><nav epub:type="toc"><h1>目录</h1><ol>`;

  for (let i = 0; i < selected.length; i++) {
    const book = selected[i];
    const notes = notesMap.get(book.id) || [];
    const cid = epubId(i);
    const xhtml = epubChapterXhtml(book, notes);

    oebps.file(`${cid}.xhtml`, xhtml);
    manifestItems.push(`<item id="${cid}" href="${cid}.xhtml" media-type="application/xhtml+xml"/>`);
    spineItems.push(`<itemref idref="${cid}"/>`);
    ncxPoints.push(`<navPoint id="nav-${cid}" playOrder="${i + 1}"><navLabel><text>${escapeHtml(book.title)}</text></navLabel><content src="${cid}.xhtml"/></navPoint>`);
    navHtml += `<li><a href="${cid}.xhtml">${escapeHtml(book.title)}</a></li>`;
  }

  navHtml += '</ol></nav></body></html>';
  oebps.file('nav.xhtml', navHtml);
  manifestItems.push('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>');

  // NCX（EPUB 2 兼容）
  oebps.file('toc.ncx', `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx version="2005-1" xmlns="http://www.daisy.org/z3986/2005/ncx/">
<head><meta name="dtb:uid" content="${uuid}"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>
<docTitle><text>${escapeHtml(bookTitle)}</text></docTitle><navMap>${ncxPoints.join('')}</navMap></ncx>`);
  manifestItems.push('<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>');

  // 4. content.opf
  oebps.file('content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" prefix="rendition: http://www.idpf.org/vocab/rendition/#">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
<dc:identifier id="book-id">${uuid}</dc:identifier>
<dc:title>${escapeHtml(bookTitle)}</dc:title>
<dc:creator>微信读书</dc:creator>
<dc:language>zh-CN</dc:language>
<dc:date>${dateStr}</dc:date>
<dc:publisher>微信读书</dc:publisher>
<dc:description>微信读书笔记导出 — ${selected.length} 本书籍</dc:description>
<meta property="dcterms:modified">${dateISO}</meta>
<meta name="generator" content="微阅 v${APP_VERSION}"/>
<meta property="rendition:layout">reflowable</meta>
</metadata>
<manifest>${manifestItems.join('\n')}</manifest>
<spine toc="ncx">${spineItems.join('\n')}</spine>
</package>`);

  // 5. 打包
  const arrayBuffer = await zip.generateAsync({ type: 'arraybuffer' });
  const uint8 = new Uint8Array(arrayBuffer);
  const fileName = selected.length === 1 ? safeFilename(selected[0].title) : `读书笔记_${selected.length}本`;
  const file = new File(dir, `${fileName}.epub`);
  file.write(uint8);
  const fullFileName = `${fileName}.epub`;
  return { filePath: file.uri, fileName: fullFileName, mimeType: '*/*' };
}

// ====== 4. IMA 导出（直接文件上传到个人知识库，不经过笔记） ======

export async function exportBooksToIma(bookIds: string[], noteIds?: string[]): Promise<{ count: number; title: string }> {
  const settings = await getSettings();
  if (!settings.ima.apiKey || !settings.ima.clientId) {
    throw new Error('请先在设置中配置 IMA API Key 和 Client ID');
  }

  const defaultKb = settings.sync.defaultKnowledgeBase;
  if (!defaultKb) {
    throw new Error('请先在设置中选择默认知识库（个人知识库）');
  }

  const books = await getBooks();
  const selected = books.filter(b => bookIds.includes(b.id));
  if (selected.length === 0) throw new Error('未选择书籍');

  const notesMap = await getNotesMap(bookIds, noteIds);
  const mediaType = 7; // Markdown 文件
  const contentType = 'text/markdown';
  const fileExt = 'md';
  let created = 0;
  let lastTitle = '';

  for (const book of selected) {
    try {
      const notes = notesMap.get(book.id) || [];
      const title = `《${book.title}》读书笔记`;
      const content = buildImaMarkdown(book, notes);
      const byteSize = utf8ByteLength(content);

      // 第1步：向 IMA 申请 COS 上传凭证
      const { mediaId, cosCredential } = await createMedia(
        settings.ima.clientId,
        settings.ima.apiKey,
        defaultKb,
        `${title}.md`,
        byteSize,
        mediaType,
        contentType,
        fileExt,
      );

      // 第2步：把 Markdown 内容直接 PUT 到 COS（HMAC-SHA1 签名）
      await uploadToCos(cosCredential, content, contentType);

      // 第3步：关联到个人知识库（直接进知识库，不经过笔记通道）
      await addKnowledgeToKb(
        settings.ima.clientId,
        settings.ima.apiKey,
        defaultKb,
        mediaId,
        title,
        mediaType,
      );

      created++;
      lastTitle = book.title;
    } catch (e) {
      if (__DEV__) console.warn(`[Export IMA] 导出《${book.title}》失败:`, e);
    }
  }

  if (created === 0) {
    throw new Error('所有书籍导出失败，请检查 IMA 配置');
  }

  return { count: created, title: lastTitle };
}
