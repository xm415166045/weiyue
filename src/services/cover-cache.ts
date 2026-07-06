/**
 * 封面缓存服务 — 磁盘 + 内存双层缓存
 *
 * 缓存策略:
 *   1. 内存 LRU: 同一 session 内避免重复解码
 *   2. 磁盘持久: expo-file-system 下载到 covers/ 目录，下次直接读本地
 *   3. CDN 缩略图: 在 URL 上追加 imageMogr2 参数减小传输体积
 *
 * 缓存键: bookId（不是 URL，因为 URL 可能变化但 bookId 不变）
 *
 * 容错增强（2026-06-14）:
 *   - File.downloadFileAsync 加 10s 超时，防止单张封面挂起阻塞后续
 *   - 多 CDN fallback，主 CDN 超时自动切换到备用 CDN
 *   - Image.prefetch 预加载辅助函数
 */

import { File, Directory, Paths } from 'expo-file-system';
import { Image } from 'react-native';

// ====== 常量 ======

/** 单张封面下载超时（毫秒） */
const DOWNLOAD_TIMEOUT = 10000;
/** 内存 LRU 最多缓存条目数 */
const MEMORY_CACHE_MAX = 100;

// ====== 内存 LRU 缓存 ======

const memoryCache = new Map<string, string>();

function getFromMemory(bookId: string): string | undefined {
  return memoryCache.get(bookId);
}

function setToMemory(bookId: string, localPath: string): void {
  // LRU: 先删除旧记录再插入
  if (memoryCache.has(bookId)) {
    memoryCache.delete(bookId);
  } else if (memoryCache.size >= MEMORY_CACHE_MAX) {
    // 删除最久未使用的（Map 的第一个 key）
    const firstKey = memoryCache.keys().next().value;
    if (firstKey !== undefined) memoryCache.delete(firstKey);
  }
  memoryCache.set(bookId, localPath);
}

// ====== 封面缓存目录 ======

let _coversDir: Directory | null = null;

async function getCoversDir(): Promise<Directory> {
  if (!_coversDir) {
    _coversDir = new Directory(Paths.document, 'covers');
    if (!_coversDir.exists) _coversDir.create({ intermediates: true });
  }
  return _coversDir;
}

/** 获取 bookId 对应的本地缓存路径 */
function getLocalPath(bookId: string): string {
  // 直接用 bookId 做文件名，不含目录分隔符
  const safeId = bookId.replace(/[/\\:?*"<>|]/g, '_');
  // 使用裸路径，后续通过 getCoversDir().uri 拼接
  return `${safeId}.jpg`;
}

// ====== CDN 缩略图 URL 优化 ======

/**
 * 给微信读书 CDN 封面 URL 追加 imageMogr2 缩略图参数
 * 缩小图片尺寸以加快下载速度
 */
function optimizeCoverUrl(url: string): string {
  if (!url) return url;
  if (url.includes('myqcloud.com')) {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}imageMogr2/thumbnail/x168`;
  }
  return url;
}

// ====== CDN 故障转移 ======

/**
 * 多 CDN 候选列表
 * 主域名超时/失败时自动尝试备用域名
 */
function getFallbackUrls(bookId: string): string[] {
  return [
    `https://weread-1258476243.cos.ap-shanghai.myqcloud.com/bookcover/${bookId}/cover`,
  ];
}

// ====== 带超时的下载 ======

/**
 * 带超时的文件下载
 * 超时后自动 throw，由调用方切换到备用 CDN 或降级
 */
async function downloadWithTimeout(url: string, dest: File): Promise<void> {
  // expo-file-system 的 downloadFileAsync 不支持 AbortController，
  // 用 Promise.race 实现超时
  await Promise.race([
    File.downloadFileAsync(url, dest),
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error(`Download timeout: ${url}`)), DOWNLOAD_TIMEOUT),
    ),
  ]);
}

// ====== 对外接口 ======

export type CoverCacheResult = {
  /** 最终用于 Image source 的 URI（本地路径或原始 URL） */
  uri: string;
  /** 是否来自缓存 */
  cached: boolean;
};

/**
 * 获取封面 URI — 走三级缓存策略
 *
 * 1. 内存 LRU → 2. 磁盘缓存 → 3. CDN 下载（带超时 + 多 CDN fallback）
 */
export async function getCoverUri(bookId: string, coverUrl?: string): Promise<CoverCacheResult> {
  // Step 1: 内存缓存命中
  const mem = getFromMemory(bookId);
  if (mem) return { uri: mem, cached: true };

  // Step 2: 磁盘缓存命中
  const coversDir = await getCoversDir();
  const fileName = getLocalPath(bookId);
  const cachedFile = new File(coversDir, fileName);
  if (cachedFile.exists) {
    const localUri = cachedFile.uri;
    setToMemory(bookId, localUri);
    return { uri: localUri, cached: true };
  }

  // Step 3: 从网络下载（没有 coverUrl 则放弃）
  if (!coverUrl) return { uri: '', cached: false };

  // 构建候选 URL 列表：优先使用传入的 coverUrl，再尝试 CDN fallback
  const urlsToTry = [optimizeCoverUrl(coverUrl), ...getFallbackUrls(bookId)];
  // 去重
  const uniqueUrls = [...new Set(urlsToTry)];

  for (const url of uniqueUrls) {
    try {
      await downloadWithTimeout(url, cachedFile);
      const localUri = cachedFile.uri;
      setToMemory(bookId, localUri);
      return { uri: localUri, cached: false };
    } catch {
      // 当前 URL 超时/失败，尝试下一个候选 URL
      continue;
    }
  }

  // 全部 CDN 都失败，返回原始 URL 让 RN Image 自行处理
  return { uri: coverUrl, cached: false };
}

/**
 * 预加载封面并即时回调（不等待全部完成）
 * 每下载完一张就调用 onProgress(bookId, uri)
 */
export async function prefetchCoversProgressive(
  books: { id: string; coverUrl?: string }[],
  onProgress: (bookId: string, uri: string) => void,
  concurrency = 6,
): Promise<void> {
  const pending = books.filter(b => b.id && b.coverUrl);
  let index = 0;

  const worker = async () => {
    while (index < pending.length) {
      const i = index++;
      const b = pending[i];
      try {
        const result = await getCoverUri(b.id, b.coverUrl);
        if (result.uri) {
          onProgress(b.id, result.uri);
        }
      } catch {
        // 静默忽略
      }
    }
  };

  await Promise.all(Array(concurrency).fill(0).map(() => worker()));
}

/**
 * 预加载一批封面到缓存（并发下载，每本独立超时）
 * 不再分批次阻塞，改用 Worker 池模式
 */
export async function prefetchCovers(
  books: { id: string; coverUrl?: string }[],
  onProgress?: (bookId: string) => void,
): Promise<void> {
  const pending = books.filter(b => b.id && b.coverUrl);
  let index = 0;
  const CONCURRENCY = 6;

  const worker = async () => {
    while (index < pending.length) {
      const i = index++;
      const b = pending[i];
      try {
        await getCoverUri(b.id, b.coverUrl);
        onProgress?.(b.id);
      } catch {
        // 静默忽略
      }
    }
  };

  await Promise.all(Array(CONCURRENCY).fill(0).map(() => worker()));
}

/**
 * 清除封面缓存（磁盘清理）
 */
export async function clearCoverCache(): Promise<void> {
  const coversDir = await getCoversDir();
  if (coversDir.exists) {
    const files = coversDir.list();
    for (const f of files) {
      try { f.delete(); } catch {}
    }
  }
  memoryCache.clear();
}
