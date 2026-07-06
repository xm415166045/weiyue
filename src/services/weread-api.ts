/**
 * 微信读书 API 服务（weread-skills 官方 Agent API）
 * 统一入口：POST https://i.weread.qq.com/api/agent/gateway
 * 认证方式：Authorization: Bearer wrk-xxxxxxxx
 * 文档：weread-skills skill (skill_2057443495761997824)
 */
import { Book, Note, AppSettings, WeReadStats, ReadStatsMode, CategoryPref, ReadLongestBook, ReadStatItem } from '../types';

const GATEWAY = 'https://i.weread.qq.com/api/agent/gateway';
const SKILL_VERSION = '1.0.5';

// ====== 通用请求 ======

interface WereadResponse {
  errcode?: number;
  errmsg?: string;
  upgrade_info?: { message: string };
  [key: string]: any;
}

async function callAPI(
  apiKey: string,
  apiName: string,
  params: Record<string, any> = {},
): Promise<any> {
  const body: Record<string, any> = {
    api_name: apiName,
    skill_version: SKILL_VERSION,
    ...params,
  };

  if (__DEV__) console.log(`[WeRead API] 调用: ${apiName}`, JSON.stringify(body));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let res: Response;
  try {
    res = await fetch(GATEWAY, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e: any) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('微信读书 API 请求超时 (30s)');
    throw e;
  }
  clearTimeout(timer);

  if (!res.ok) {
    throw new Error(`微信读书 API 请求失败 (HTTP ${res.status})`);
  }

  const data: WereadResponse = await res.json();

  if (__DEV__) console.log(`[WeRead API] 返回: ${apiName}`, JSON.stringify(data).slice(0, 500));

  // 检查升级提示（必须优先处理）
  if (data.upgrade_info) {
    throw new Error(`需要更新 skill：${data.upgrade_info.message}`);
  }

  // 检查业务错误
  if (data.errcode && data.errcode !== 0) {
    if (data.errcode === 401 || data.errcode === 403) {
      throw new WeReadAuthError(data.errmsg || 'API Key 无效或已过期');
    }
    throw new Error(data.errmsg || `微信读书错误 (code: ${data.errcode})`);
  }

  return data;
}

// ====== 错误类 ======

export class WeReadAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WeReadAuthError';
  }
}

// ====== 验证 ======

/**
 * 验证 API Key 是否有效
 * 调用 /shelf/sync 检查鉴权
 */
export async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    await callAPI(apiKey, '/shelf/sync');
    return true;
  } catch (e: unknown) {
    if (e instanceof WeReadAuthError) return false;
    // 网络错误或其他异常均返回 false，由调用方根据错误类型处理
    return false;
  }
}

// ====== 书架（对齐书迹：使用 /user/notebooks 作为主要数据源） ======

/**
 * 从 /user/notebooks 获取有笔记的书籍列表（对齐书迹桌面版）
 * 
 * 与 /shelf/sync 的区别：notebooks 只返回有划线/想法的书，
 * 天然过滤掉无笔记的书籍，且自带各类型笔记数量。
 */
export async function fetchNotebookBooksAsShelf(apiKey: string): Promise<Book[]> {
  const allBooks: any[] = [];
  let lastSort: number | undefined;
  let hasMore = 1;

  while (hasMore === 1) {
    const params: Record<string, any> = { count: 100 };
    if (lastSort !== undefined) params.lastSort = lastSort;
    const data = await callAPI(apiKey, '/user/notebooks', params);

    if (data.books && Array.isArray(data.books)) {
      for (const b of data.books) {
        // /user/notebooks API: title/author/cover 嵌套在 b.book 子对象中
        const info: any = b.book || b;
        allBooks.push({
          bookId: b.bookId,
          title: info.title || '',
          author: info.author || '',
          cover: extractCover(info, b.bookId),
          reviewCount: b.reviewCount || 0,
          noteCount: b.noteCount || 0,         // API 可能使用 noteCount 命名
          bookmarkCount: b.bookmarkCount || 0,
          readingProgress: b.readingProgress || 0,
          markedStatus: b.markedStatus,          // 0=在读, 1=读完
          sort: b.sort || 0,
        });
      }
      const last = data.books[data.books.length - 1];
      if (last) lastSort = last.sort;
    }
    hasMore = data.hasMore || 0;
  }

  if (__DEV__) console.log(`[WeRead API] /user/notebooks 共 ${allBooks.length} 本有笔记的书籍`);

  // 额外获取书架列表以补充阅读时长、完成状态和最后阅读时间
  // 关键：/user/notebooks API 不返回 finishReading/markedStatus/readUpdateTime 等字段，
  // 必须从 /shelf/sync 获取准确的"已读完"标识
  // 使用与 fetchShelfBooks 完全一致的状态判定逻辑
  type ShelfEntry = { finishReading?: number; readUpdateTime?: string; readingTime?: number };
  const shelfMap = new Map<string, ShelfEntry>();
  try {
    const shelfData = await callAPI(apiKey, '/shelf/sync');
    if (shelfData.books && Array.isArray(shelfData.books)) {
      for (const b of shelfData.books) {
        if (b.bookId) {
          shelfMap.set(String(b.bookId), {
            finishReading: b.finishReading,
            readUpdateTime: b.readUpdateTime,
            readingTime: b.readingTime ? Math.round(b.readingTime / 60) : undefined,
          });
        }
      }
    }
    if (__DEV__) console.log(`[WeRead API] 从 /shelf/sync 获取到 ${shelfMap.size} 本书的状态数据`);
  } catch (e) {
    if (__DEV__) console.warn('[WeRead API] 获取书架数据失败，仅使用 notebooks 数据:', (e as Error).message);
  }

  const now = new Date().toISOString();
  return allBooks.map(b => {
    // 状态判定（与 fetchShelfBooks 完全一致）:
    // 1. finishReading === 1 → 已读完
    // 2. readUpdateTime 有值 → 在读中（最近有阅读记录）
    // 3. 否则 → 已读（/user/notebooks 只返回有笔记的书，必然读过）
    const shelf = shelfMap.get(String(b.bookId));
    let status: 'reading' | 'finished' | 'not-yet' = 'reading';
    if (shelf?.finishReading === 1) {
      status = 'finished';
    } else if (b.markedStatus === 1) {
      status = 'finished';
    } else if (shelf?.readUpdateTime) {
      status = 'reading';
    }

    const readingTime = shelf?.readingTime ?? 0;
    const lastReadDate = shelf?.readUpdateTime ? tsToDateStr(Number(shelf.readUpdateTime)) : '';

    return {
      id: `wr_${b.bookId}`,
      title: b.title || '',
      author: b.author || '',
      coverUrl: b.cover || getCoverFallback(b.bookId),
      status,
      noteCount: (b.reviewCount || 0) + (b.noteCount || 0) + (b.bookmarkCount || 0),
      rating: 0,
      readingTime,
      lastReadDate,
      createdAt: now,
      updatedAt: now,
    };
  });
}

/**
 * 获取书架列表（电子书 + 有声书/专辑）— 保留用于全量书架场景
 * 返回 App 的 Book[] 格式
 */
export async function fetchShelfBooks(apiKey: string): Promise<Book[]> {
  const data = await callAPI(apiKey, '/shelf/sync');
  const now = new Date().toISOString();
  const books: Book[] = [];

  if (__DEV__) console.log('[WeRead API] /shelf/sync 返回字段:', Object.keys(data).join(', '));

  // 电子书：books[]
  if (data.books && Array.isArray(data.books)) {
    if (__DEV__) console.log(`[WeRead API] 找到 ${data.books.length} 本电子书`);
    for (const b of data.books) {
      books.push({
        id: `wr_${b.bookId}`,
        title: b.title || '',
        author: b.author || '',
      coverUrl: extractCover(b, b.bookId),
      status: b.finishReading === 1 ? 'finished' : (b.readUpdateTime ? 'reading' : 'not-yet'),
        noteCount: 0, // 稍后通过 /user/notebooks 补充
        rating: 0,
        readingTime: b.readingTime ? Math.round(b.readingTime / 60) : 0, // API 返回秒，转为分钟
        lastReadDate: b.readUpdateTime
          ? tsToDateStr(b.readUpdateTime)
          : '',
        createdAt: now,
        updatedAt: now,
      });
    }
  } else {
    if (__DEV__) console.warn('[WeRead API] /shelf/sync 返回中没有找到 books 数组', data);
  }

  // 有声书/专辑：albums[]
  if (data.albums && Array.isArray(data.albums)) {
    if (__DEV__) console.log(`[WeRead API] 找到 ${data.albums.length} 个有声书专辑`);
    for (const a of data.albums) {
      const info = a.albumInfo || {};
      books.push({
        id: `wr_album_${info.albumId || ''}`,
        title: info.name || '未知专辑',
        author: info.authorName || '',
        coverUrl: extractCover(info, info.albumId || ''),
        status: info.finish === 1 ? 'finished' : 'reading',
        noteCount: 0,
        rating: 0,
        lastReadDate: info.updateTime
          ? tsToDateStr(info.updateTime)
          : '',
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  if (__DEV__) console.log(`[WeRead API] 总共获取到 ${books.length} 本书`);
  return books;
}

// ====== 有笔记的书籍列表 ======

/**
 * 获取"有笔记的书籍"概览（含笔记数量统计）
 * 用于补充书架书籍的 noteCount
 */
export async function fetchNotebookBooks(apiKey: string): Promise<{
  bookId: string;
  noteCount: number;
  reviewCount: number;
  bookmarkCount: number;
}[]> {
  const results: any[] = [];
  let lastSort: number | undefined;
  let hasMore = 1;

  while (hasMore === 1) {
    const params: Record<string, any> = { count: 100 };
    if (lastSort !== undefined) {
      params.lastSort = lastSort;
    }
    const data = await callAPI(apiKey, '/user/notebooks', params);
    if (data.books && Array.isArray(data.books)) {
      for (const b of data.books) {
        results.push({
          bookId: b.bookId,
          noteCount: (b.reviewCount || 0) + (b.noteCount || 0) + (b.bookmarkCount || 0),
          reviewCount: b.reviewCount || 0,
          bookmarkCount: b.bookmarkCount || 0,
        });
      }
    }
    hasMore = data.hasMore || 0;
    if (data.books && data.books.length > 0) {
      const last = data.books[data.books.length - 1];
      lastSort = last.sort;
    }
  }

  return results;
}

// ====== 笔记内容 ======

/**
 * 获取单本书的笔记内容
 * 同时调用 /book/bookmarklist（划线）和 /review/list/mine（想法/点评）
 * 两个 API 独立调用，一个失败不影响另一个
 * 返回 App 的 Note[] 格式 + 各 API 错误信息
 */
export interface FetchBookNotesResult {
  notes: Note[];
  /** 每个 API 的错误信息（空=成功） */
  errors: { api: string; error: string }[];
}

export async function fetchBookNotes(
  apiKey: string,
  bookId: string,
): Promise<FetchBookNotesResult> {
  const notes: Note[] = [];
  const errors: { api: string; error: string }[] = [];
  const now = new Date().toISOString();

  // 1. 获取划线（API 已自动过滤书签，只返回划线 type=1）
  try {
    const bmData = await callAPI(apiKey, '/book/bookmarklist', { bookId });

    // 建立 chapterUid → 章节标题 的映射
    const chapterMap = new Map<number, string>();
    if (bmData.chapters && Array.isArray(bmData.chapters)) {
      for (const ch of bmData.chapters) {
        if (ch.chapterUid != null && ch.title) {
          chapterMap.set(ch.chapterUid, ch.title);
        }
      }
    }

    if (bmData.updated && Array.isArray(bmData.updated)) {
      for (const item of bmData.updated) {
        const chapterName = item.chapterUid != null
          ? (chapterMap.get(item.chapterUid) || `第${item.chapterUid}章`)
          : '';
        notes.push({
          id: `wr_bm_${item.bookmarkId || item.createTime}`,
          bookId: `wr_${bookId}`,
          text: item.markText || '',
          chapter: chapterName,
          type: 'highlight',
          createdAt: item.createTime ? tsToISOString(item.createTime) : now,
        });
      }
    }
    if (__DEV__) console.log(`[WeRead API] /book/bookmarklist 获取到 ${bmData.updated?.length || 0} 条划线`);
  } catch (e: any) {
    const msg = e.message || '未知错误';
    errors.push({ api: '/book/bookmarklist', error: msg });
    if (__DEV__) console.warn(`[WeRead API] /book/bookmarklist 失败: ${msg}`);
  }

  // 2. 获取个人想法/点评（支持分页）
  // ⚠️ 注意：参数名是 bookid（全小写），不是 bookId 或 book.id
  try {
    let synckey = 0;
    let hasMore = 1;
    let thoughtCount = 0;
    while (hasMore === 1) {
      const params: Record<string, any> = {
        bookid: bookId,  // 关键：全小写 bookid
        synckey,
        count: 20,
      };
      const rvData = await callAPI(apiKey, '/review/list/mine', params);
      if (rvData.reviews && Array.isArray(rvData.reviews)) {
        for (const rv of rvData.reviews) {
          const review = rv.review || rv;
          notes.push({
            id: `wr_rv_${review.reviewId || review.createTime}`,
            bookId: `wr_${bookId}`,
            text: review.content || '',
            chapter: review.chapterName || '',
            type: 'thought',
            createdAt: review.createTime ? tsToISOString(review.createTime) : now,
          });
          thoughtCount++;
        }
      }
      hasMore = rvData.hasMore || 0;
      synckey = rvData.synckey || 0;
    }
    if (__DEV__) console.log(`[WeRead API] /review/list/mine 获取到 ${thoughtCount} 条想法`);
  } catch (e: any) {
    const msg = e.message || '未知错误';
    errors.push({ api: '/review/list/mine', error: msg });
    if (__DEV__) console.warn(`[WeRead API] /review/list/mine 失败: ${msg}`);
  }

  // 按创建时间排序
  notes.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (__DEV__) console.log(`[WeRead API] 书籍 ${bookId} 共获取 ${notes.length} 条笔记 (${errors.length} 个API失败)`);
  return { notes, errors };
}

// ====== 导入编排器 ======

export interface ImportProgress {
  phase: 'auth' | 'shelf' | 'notes' | 'done' | 'error';
  message: string;
  current: number;
  total: number;
}

/** 单本书导入结果 */
export interface BookImportResult {
  bookId: string;
  title: string;
  noteCount: number;
  notebookNoteCount: number; // /user/notebooks 报告的数量
  success: boolean;          // 笔记是否成功获取
  errors: { api: string; error: string }[];  // 各 API 具体错误
}

/**
 * 完整导入流程（对齐书迹：直接用 /user/notebooks 获取有笔记的书）
 * 1. 验证 API Key
 * 2. 获取笔记本列表（只含划线/想法的书）
 * 3. 逐本获取笔记内容
 */
export async function importFromWeRead(
  settings: AppSettings,
  onProgress: (progress: ImportProgress) => void,
): Promise<{ books: Book[]; notes: Note[]; bookResults: BookImportResult[] }> {
  const apiKey = settings.weread.apiKey;

  if (!apiKey || !apiKey.startsWith('wrk-')) {
    throw new WeReadAuthError('请先在设置中配置有效的微信读书 API Key（wrk- 开头）');
  }

  // Phase 1: 验证
  onProgress({ phase: 'auth', message: '验证 API Key...', current: 0, total: 3 });
  const valid = await validateApiKey(apiKey);
  if (!valid) {
    throw new WeReadAuthError('API Key 无效或已过期，请重新获取');
  }

  // Phase 2: 获取笔记本（有笔记的书籍 — 对齐书迹，不需要满书架）
  onProgress({ phase: 'shelf', message: '获取笔记本列表...', current: 1, total: 3 });
  const books = await fetchNotebookBooksAsShelf(apiKey);

  if (books.length === 0) {
    onProgress({ phase: 'done', message: '没有有笔记的书籍', current: 3, total: 3 });
    return { books: [], notes: [], bookResults: [] };
  }

  // Phase 3: 逐本获取笔记内容
  const allNotes: Note[] = [];
  const bookResults: BookImportResult[] = [];
  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    onProgress({
      phase: 'notes',
      message: `获取笔记 (${i + 1}/${books.length}): ${book.title}`,
      current: i + 1,
      total: books.length,
    });

    const notebookNoteCount = book.noteCount; // 保存 notebook 报告的原始数量
    try {
      const rawBookId = book.id.replace(/^wr_/, '').replace(/^wr_album_/, '');
      const { notes: bookNotes, errors: fetchErrors } = await fetchBookNotes(apiKey, rawBookId);
      // 创建笔记副本，避免修改 fetchBookNotes 返回的数组
      const notesWithBookId = bookNotes.map(n => ({ ...n, bookId: book.id }));
      allNotes.push(...notesWithBookId);
      book.noteCount = notesWithBookId.length;
      bookResults.push({
        bookId: book.id, title: book.title, noteCount: notesWithBookId.length,
        notebookNoteCount, success: fetchErrors.length === 0, errors: fetchErrors,
      });
    } catch (e: any) {
      book.noteCount = 0;
      bookResults.push({
        bookId: book.id, title: book.title, noteCount: 0,
        notebookNoteCount, success: false,
        errors: [{ api: 'fetchBookNotes', error: e.message || '未知错误' }],
      });
    }
  }

  onProgress({
    phase: 'done',
    message: `导入完成: ${books.length} 本书, ${allNotes.length} 条笔记`,
    current: books.length,
    total: books.length,
  });

  return { books, notes: allNotes, bookResults };
}

// ====== 阅读统计 ======

/** 获取 WeRead 阅读统计数据（对齐书迹桌面版 + weread-skills 文档） */
export async function fetchReadingStats(
  apiKey: string,
  mode: ReadStatsMode = 'monthly',
  baseTime: number = 0,
): Promise<WeReadStats> {
  const params: Record<string, any> = { mode };
  if (baseTime > 0) params.baseTime = Math.floor(baseTime / 1000);

  const data = await callAPI(apiKey, '/readdata/detail', params);

  const preferTime: number[] = [];
  if (Array.isArray(data.preferTime)) {
    for (const v of data.preferTime) {
      preferTime.push(typeof v === 'number' ? v : 0);
    }
  }
  if (preferTime.length === 0) {
    preferTime.length = 24;
    preferTime.fill(0);
  }

  const readTimes: Record<string, number> = {};
  if (data.readTimes && typeof data.readTimes === 'object') {
    for (const [k, v] of Object.entries(data.readTimes)) {
      readTimes[k] = typeof v === 'number' ? v : 0;
    }
  }

  const dailyReadTimes: Record<string, number> = {};
  if (data.dailyReadTimes && typeof data.dailyReadTimes === 'object') {
    for (const [k, v] of Object.entries(data.dailyReadTimes)) {
      dailyReadTimes[k] = typeof v === 'number' ? v : 0;
    }
  }

  const readLongest: ReadLongestBook[] = [];
  if (Array.isArray(data.readLongest)) {
    for (const item of data.readLongest) {
      readLongest.push({
        book: item.book ? {
          bookId: String(item.book.bookId || ''),
          title: String(item.book.title || ''),
          author: String(item.book.author || ''),
          cover: String(item.book.cover || ''),
        } : undefined,
        albumInfo: item.albumInfo ? {
          albumId: String(item.albumInfo.albumId || ''),
          name: String(item.albumInfo.name || ''),
          authorName: String(item.albumInfo.authorName || ''),
          cover: String(item.albumInfo.cover || ''),
        } : undefined,
        readTime: typeof item.readTime === 'number' ? item.readTime : 0,
        tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
      });
    }
  }

  const preferCategory: CategoryPref[] = [];
  if (Array.isArray(data.preferCategory)) {
    for (const item of data.preferCategory) {
      preferCategory.push({
        categoryId: item.categoryId || 0,
        categoryTitle: String(item.categoryTitle || item.parentCategoryTitle || ''),
        val: typeof item.val === 'number' ? item.val : 0,
        readingTime: typeof item.readingTime === 'number' ? item.readingTime : 0,
        readingCount: typeof item.readingCount === 'number' ? item.readingCount : 0,
      });
    }
  }

  const readStat: ReadStatItem[] = [];
  if (Array.isArray(data.readStat)) {
    for (const item of data.readStat) {
      readStat.push({
        stat: String(item.stat || ''),
        counts: String(item.counts || ''),
        scheme: item.scheme ? String(item.scheme) : undefined,
      });
    }
  }

  return {
    baseTime: typeof data.baseTime === 'number' ? data.baseTime : 0,
    mode,
    readDays: typeof data.readDays === 'number' ? data.readDays : 0,
    totalReadTime: typeof data.totalReadTime === 'number' ? data.totalReadTime : 0,
    dayAverageReadTime: typeof data.dayAverageReadTime === 'number' ? data.dayAverageReadTime : 0,
    compare: typeof data.compare === 'number' ? data.compare : undefined,
    readTimes,
    dailyReadTimes,
    readLongest,
    preferCategory,
    preferTime,
    readStat,
    registTime: typeof data.registTime === 'number' ? data.registTime : 0,
  };
}

// ====== 工具函数 ======

/** 从 API 返回对象中提取封面 URL，支持多种字段名 + CDN fallback */
function extractCover(item: any, bookId: string): string {
  // 直接取 cover 字段（最常见的 API 返回格式）
  if (item.cover && typeof item.cover === 'string' && item.cover.startsWith('http')) {
    return item.cover;
  }
  // 备选字段名
  const from = item.coverUrl || item.cover_url || item.cover_image || '';
  if (from && typeof from === 'string' && from.startsWith('http')) return from;
  // CDN fallback
  return getCoverFallback(bookId);
}

/** 微信读书封面 CDN fallback（多 URL 尝试） */
function getCoverFallback(bookId: string): string {
  if (!bookId) return '';
  // 主 CDN（新）: https://weread-1258476243.cos.ap-shanghai.myqcloud.com/bookcover/{bookId}/cover
  return `https://weread-1258476243.cos.ap-shanghai.myqcloud.com/bookcover/${bookId}/cover`;
}

function tsToDateStr(ts: number): string {
  if (!ts) return '';
  const ms = ts > 1e10 ? ts : ts * 1000;
  const d = new Date(ms);
  // 使用 UTC 避免设备时区导致日期偏移
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function tsToISOString(ts: number): string {
  if (!ts) return new Date().toISOString();
  const ms = ts > 1e10 ? ts : ts * 1000;
  return new Date(ms).toISOString();
}
