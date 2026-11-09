import AsyncStorage from '@react-native-async-storage/async-storage';
import { Book, Note, AppSettings, ReadingStats, MonthlyData } from '../types';
import { markBooksDeleted, markNotesDeleted } from './sync-meta';

const KEYS = {
  BOOKS: '@weread_books',
  BOOKS_CHUNKS: '@weread_books_chunks',      // 书籍分片数
  NOTES: '@weread_notes',
  NOTES_CHUNKS: '@weread_notes_chunks',       // 笔记分片数
  SETTINGS: '@weread_settings',
  STATS: '@weread_stats',
  MONTHLY_DATA: '@weread_monthly_data',
};

// 内存缓存，减少 AsyncStorage 重复读取
let _notesCache: Note[] | null = null;
let _booksCache: Book[] | null = null;
let _cacheValid = false;

// 每片最大字节数（避免单个 JSON 超过 SQLite 行限制 ~2MB）
const MAX_CHUNK_BYTES = 1.5 * 1024 * 1024; // 1.5MB，留足余量
// 单条笔记文本最大字符数
const MAX_NOTE_TEXT_LENGTH = 10000;

// 按 bookId 分片存储笔记，避免全量加载
const NOTE_BOOK_PREFIX = '@weread_notes_book_';
const NOTE_BOOK_INDEX_KEY = '@weread_notes_book_index';
function noteBookChunkKey(bookId: string): string {
  return `${NOTE_BOOK_PREFIX}${bookId}`;
}

async function getNoteBookIndex(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(NOTE_BOOK_INDEX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    console.warn('[Storage] 笔记 bookId 索引损坏，已重置');
    return [];
  }
}

async function saveNoteBookIndex(bookIds: string[]): Promise<void> {
  const uniqueIds = Array.from(new Set(bookIds));
  await AsyncStorage.setItem(NOTE_BOOK_INDEX_KEY, JSON.stringify(uniqueIds));
}

// ====== Default Settings ======

const defaultSettings: AppSettings = {
  weread: { apiKey: '' },
  ima: { apiKey: '', clientId: '' },
  sync: { autoSync: false, defaultKnowledgeBase: '' },
};

// ====== Books (chunked storage) ======

/** 书籍分片 key */
function bookChunkKey(index: number): string {
  return `${KEYS.BOOKS}_${index}`;
}

/**
 * 计算字符串的 UTF-8 字节数。
 * 不依赖 Blob / TextEncoder —— Hermes 对二者的支持随 RN 版本变化，
 * 纯 JS 实现在 Android / iOS / Web 三端行为一致。
 */
function utf8ByteLength(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4; // 代理对 → 4 字节
        i++;
      } else {
        bytes += 3; // 孤立高位代理
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/**
 * 按序列化后字节大小将数组分片
 */
function chunkBySize<T>(items: T[], maxBytes: number): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentSize = 2; // '[' + ']' 的占位

  for (const item of items) {
    const itemJson = JSON.stringify(item);
    const itemBytes = utf8ByteLength(itemJson);
    const commaSize = current.length > 0 ? 1 : 0;
    const projectedSize = currentSize + commaSize + itemBytes;

    if (projectedSize > maxBytes && current.length > 0) {
      chunks.push(current);
      current = [item];
      currentSize = 2 + itemBytes;
    } else {
      current.push(item);
      currentSize = projectedSize;
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  // 如果数组为空，保留一个空分片以保持 key 存在
  if (chunks.length === 0) {
    chunks.push([]);
  }

  return chunks;
}

export async function saveBooks(books: Book[]): Promise<void> {
  try {
    const chunks = chunkBySize(books, MAX_CHUNK_BYTES);
    const oldChunks = parseInt(await AsyncStorage.getItem(KEYS.BOOKS_CHUNKS) || '0', 10);

    // 先写入新分片（保留旧分片作为回滚备份）
    for (let i = 0; i < chunks.length; i++) {
      await AsyncStorage.setItem(bookChunkKey(i), JSON.stringify(chunks[i]));
    }

    // 更新分片计数（此后读取端会使用新数据）
    await AsyncStorage.setItem(KEYS.BOOKS_CHUNKS, String(chunks.length));

    // 安全后再删除多余旧分片
    for (let i = chunks.length; i < oldChunks; i++) {
      await AsyncStorage.removeItem(bookChunkKey(i));
    }

    // 删除旧的单 key 格式（如果存在）
    await AsyncStorage.removeItem(KEYS.BOOKS).catch(() => {});

    // 更新缓存
    _booksCache = books;
  } catch (e) {
    console.error('[Storage] 保存书籍失败:', e);
    throw e;
  }
}

export async function getBooks(): Promise<Book[]> {
  if (_booksCache !== null) {
    return _booksCache;
  }

  // 新格式（分片）
  const chunksStr = await AsyncStorage.getItem(KEYS.BOOKS_CHUNKS);
  if (chunksStr) {
    const totalChunks = parseInt(chunksStr, 10);
    if (totalChunks > 0) {
      const allBooks: Book[] = [];
      for (let i = 0; i < totalChunks; i++) {
        const value = await AsyncStorage.getItem(bookChunkKey(i));
        if (value) {
          try { allBooks.push(...JSON.parse(value)); } catch (e) { console.error('[Storage] 书籍分片数据损坏:', bookChunkKey(i), e); }
        }
      }
      _booksCache = allBooks;
      return allBooks;
    }
  }

  // 回退：旧格式（单 key）→ 读取并迁移；若 CursorWindow 溢出则清空
  // 注意：AsyncStorage.getItem() 本身就可能因数据 >2MB 触发 CursorWindow，
  // 所以必须把整个读旧 key 的路径包在 try-catch 里（不能只包 JSON.parse）
  try {
    const data = await AsyncStorage.getItem(KEYS.BOOKS);
    if (data) {
      const oldBooks: Book[] = JSON.parse(data);
      if (oldBooks.length > 0) {
        await saveBooks(oldBooks);
      }
      _booksCache = oldBooks;
      return oldBooks;
    }
  } catch {
    console.warn('[Storage] 旧格式书籍数据过大或损坏（CursorWindow），已清除');
    await AsyncStorage.removeItem(KEYS.BOOKS).catch(() => {});
  }

  _booksCache = [];
  return [];
}

export async function addBook(book: Book): Promise<void> {
  try {
    const books = await getBooks();
    books.push(book);
    await saveBooks(books);
  } catch (e) {
    console.error('[Storage] 添加书籍失败:', e);
    throw new Error('添加书籍失败');
  }
}

export async function updateBook(updated: Book): Promise<void> {
  try {
    const books = await getBooks();
    const index = books.findIndex(b => b.id === updated.id);
    if (index !== -1) {
      books[index] = updated;
      await saveBooks(books);
    }
  } catch (e) {
    console.error('[Storage] 更新书籍失败:', e);
    throw new Error('更新书籍失败');
  }
}

/** 更新指定书籍的笔记数量（持久化到 AsyncStorage） */
export async function updateBookNoteCount(bookId: string, noteCount: number): Promise<void> {
  try {
    const books = await getBooks();
    const book = books.find(b => b.id === bookId);
    if (book) {
      book.noteCount = noteCount;
      await saveBooks(books);
    }
  } catch (e) {
    console.error('[Storage] 更新书籍笔记数量失败:', e);
    throw new Error('更新书籍笔记数量失败');
  }
}

export async function deleteBooks(ids: string[]): Promise<void> {
  try {
    const books = await getBooks();
    const notes = await getNotes();
    const newBooks = books.filter(b => !ids.includes(b.id));
    const newNotes = notes.filter(n => !ids.includes(n.bookId));

    // 先保存笔记（依赖数据），再保存书籍，确保失败时至少不会留下孤儿笔记
    await saveNotes(newNotes);
    await saveBooks(newBooks);

    // 记录删除墓碑：增量同步时不再把用户手动删掉的书自动拉回。
    // 墓碑写入失败不阻断删除本身，仅告警。
    try {
      await markBooksDeleted(ids);
    } catch (e) {
      console.warn('[Storage] 写入书籍删除墓碑失败:', e);
    }
  } catch (e) {
    console.error('[Storage] deleteBooks 失败，数据可能未一致:', e);
    throw new Error('删除书籍失败：数据未完全更新，请重试');
  }
}

// ====== Notes (chunked storage to avoid SQLite CursorWindow limit) ======

/** 截断超长笔记文本 */
function truncateNoteText(text: string): string {
  if (text.length <= MAX_NOTE_TEXT_LENGTH) return text;
  return text.slice(0, MAX_NOTE_TEXT_LENGTH) + '…[内容过长已截断]';
}

/** 笔记分片 key */
function noteChunkKey(index: number): string {
  return `${KEYS.NOTES}_${index}`;
}

/** 保存笔记（自动按字节大小分片） */
export async function saveNotes(notes: Note[]): Promise<void> {
  try {
    // 截断超长文本
    const safeNotes = notes.map(n => ({ ...n, text: truncateNoteText(n.text) }));

    // 同步更新按 bookId 分片缓存
    const oldBookIds = await getNoteBookIndex();
    const bookNotesMap = new Map<string, Note[]>();
    for (const n of safeNotes) {
      if (!bookNotesMap.has(n.bookId)) bookNotesMap.set(n.bookId, []);
      bookNotesMap.get(n.bookId)!.push(n);
    }
    const nextBookIds = Array.from(bookNotesMap.keys());
    for (const [bookId, bookNotes] of bookNotesMap) {
      await AsyncStorage.setItem(noteBookChunkKey(bookId), JSON.stringify(bookNotes));
    }
    for (const oldBookId of oldBookIds) {
      if (!bookNotesMap.has(oldBookId)) {
        await AsyncStorage.removeItem(noteBookChunkKey(oldBookId));
      }
    }
    await saveNoteBookIndex(nextBookIds);

    const chunks = chunkBySize(safeNotes, MAX_CHUNK_BYTES);
    const oldChunks = parseInt(await AsyncStorage.getItem(KEYS.NOTES_CHUNKS) || '0', 10);

    // 先写入新分片（保留旧分片作为回滚备份）
    for (let i = 0; i < chunks.length; i++) {
      await AsyncStorage.setItem(noteChunkKey(i), JSON.stringify(chunks[i]));
    }

    // 更新分片计数
    await AsyncStorage.setItem(KEYS.NOTES_CHUNKS, String(chunks.length));

    // 安全后再删除多余旧分片
    for (let i = chunks.length; i < oldChunks; i++) {
      await AsyncStorage.removeItem(noteChunkKey(i));
    }

    // 更新缓存
    _notesCache = safeNotes;
    _cacheValid = true;
  } catch (e) {
    console.error('[Storage] 保存笔记失败:', e);
    throw e;
  }
}

/** 读取全部笔记（合并所有分片） */
export async function getNotes(): Promise<Note[]> {
  if (_cacheValid && _notesCache !== null) {
    return _notesCache;
  }

  // 尝试新格式（分片）
  const chunksStr = await AsyncStorage.getItem(KEYS.NOTES_CHUNKS);
  if (chunksStr) {
    const totalChunks = parseInt(chunksStr, 10);
    if (totalChunks > 0) {
      const allNotes: Note[] = [];
      for (let i = 0; i < totalChunks; i++) {
        const value = await AsyncStorage.getItem(noteChunkKey(i));
        if (value) {
          try {
            allNotes.push(...JSON.parse(value));
          } catch (e) {
            console.error('[Storage] 笔记分片数据损坏:', noteChunkKey(i), e);
          }
        }
      }
      _notesCache = allNotes;
      _cacheValid = true;
      return allNotes;
    }
  }

  // 回退：旧格式（单 key）
  // 注意：AsyncStorage.getItem() 本身就可能因数据 >2MB 触发 CursorWindow
  try {
    const data = await AsyncStorage.getItem(KEYS.NOTES);
    if (data) {
      const oldNotes: Note[] = JSON.parse(data);
      // 迁移到新格式
      if (oldNotes.length > 0) {
        await saveNotes(oldNotes);
        // 删除旧 key 避免下次再读
        await AsyncStorage.removeItem(KEYS.NOTES);
      }
      _notesCache = oldNotes;
      _cacheValid = true;
      return oldNotes;
    }
  } catch {
    // 旧数据损坏或过大（CursorWindow），删除旧 key 并返回空
    console.warn('[Storage] 旧格式笔记数据过大或损坏（CursorWindow），已清除');
    await AsyncStorage.removeItem(KEYS.NOTES).catch(() => {});
  }

  _notesCache = [];
  _cacheValid = true;
  return [];
}

export async function getNotesByBookId(bookId: string): Promise<Note[]> {
  // 优先从按 bookId 分片的 key 读取
  try {
    const raw = await AsyncStorage.getItem(noteBookChunkKey(bookId));
    if (raw) return JSON.parse(raw);
  } catch {
    // fall through to full scan
  }
  // 回退：全量加载并过滤
  const allNotes = await getNotes();
  const bookNotes = allNotes.filter(n => n.bookId === bookId);
  // 异步写入分片 key 以供下次快速读取
  AsyncStorage.setItem(noteBookChunkKey(bookId), JSON.stringify(bookNotes)).catch(() => {});
  return bookNotes;
}

export async function addNote(note: Note): Promise<void> {
  try {
    const notes = await getNotes();
    notes.push(note);
    await saveNotes(notes);
  } catch (e) {
    console.error('[Storage] 添加笔记失败:', e);
    throw new Error('添加笔记失败');
  }
}

export async function deleteNotes(ids: string[]): Promise<void> {
  try {
    const notes = await getNotes();
    await saveNotes(notes.filter(n => !ids.includes(n.id)));
    try {
      await markNotesDeleted(ids);
    } catch (e) {
      console.warn('[Storage] 写入笔记删除墓碑失败:', e);
    }
  } catch (e) {
    console.error('[Storage] 删除笔记失败:', e);
    throw new Error('删除笔记失败');
  }
}

// ====== Settings ======

export async function getSettings(): Promise<AppSettings> {
  try {
    const data = await AsyncStorage.getItem(KEYS.SETTINGS);
    if (!data) return defaultSettings;
    const parsed = JSON.parse(data);
    return {
      weread: { ...defaultSettings.weread, ...(parsed.weread || {}) },
      ima: { ...defaultSettings.ima, ...(parsed.ima || {}) },
      sync: { ...defaultSettings.sync, ...(parsed.sync || {}) },
    };
  } catch {
    console.warn('[Storage] 设置数据损坏，使用默认值');
    return defaultSettings;
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
  } catch (e) {
    console.error('[Storage] 保存设置失败:', e);
    throw new Error('保存设置失败');
  }
}

// ====== Stats ======

export async function getStats(): Promise<ReadingStats | null> {
  try {
    const data = await AsyncStorage.getItem(KEYS.STATS);
    return data ? JSON.parse(data) : null;
  } catch {
    console.warn('[Storage] 统计数据损坏');
    return null;
  }
}

export async function saveStats(stats: ReadingStats): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.STATS, JSON.stringify(stats));
  } catch (e) {
    console.error('[Storage] 保存统计数据失败:', e);
    throw new Error('保存统计数据失败');
  }
}

export async function getMonthlyData(): Promise<MonthlyData[]> {
  try {
    const data = await AsyncStorage.getItem(KEYS.MONTHLY_DATA);
    return data ? JSON.parse(data) : [];
  } catch {
    console.warn('[Storage] 月度数据损坏');
    return [];
  }
}

export async function saveMonthlyData(data: MonthlyData[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.MONTHLY_DATA, JSON.stringify(data));
  } catch (e) {
    console.error('[Storage] 保存月度数据失败:', e);
    throw new Error('保存月度数据失败');
  }
}
