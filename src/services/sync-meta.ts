/**
 * 增量同步元数据与「删除墓碑」。
 *
 * 设计要点：
 * 1. 签名与展示值分离 —— Book.noteCount 是实际拉到的条数，不能直接与远端声明数比较，
 *    否则口径差异会导致每次都被判定为「有变化」，退化成全量导入。
 * 2. 墓碑记录用户在本地主动删除的书 / 笔记，增量同步时不再自动「复活」。
 *    强制全量重导以远端为准，会忽略并清空墓碑。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RemoteBookCounts, SyncMeta, BookSyncMeta } from '../types';

const SYNC_META_KEY = '@weread_sync_meta';
const DELETED_BOOKS_KEY = '@weread_deleted_books';
const DELETED_NOTES_KEY = '@weread_deleted_notes';

/** 墓碑上限，避免长期累积撑爆 AsyncStorage 单条记录 */
const MAX_TOMBSTONES = 5000;

const emptyMeta = (): SyncMeta => ({ version: 1, books: {} });

export function buildRemoteSignature(c: RemoteBookCounts): string {
  return [
    c.reviewCount || 0,
    c.noteCount || 0,
    c.bookmarkCount || 0,
    c.sort || 0,
  ].join(':');
}

export function makeBookSyncMeta(
  signature: string,
  localNoteCount: number,
  at: string = new Date().toISOString(),
): BookSyncMeta {
  return { remoteSignature: signature, localNoteCount, lastSyncAt: at };
}

// ====== 同步元数据 ======

export async function getSyncMeta(): Promise<SyncMeta> {
  try {
    const raw = await AsyncStorage.getItem(SYNC_META_KEY);
    if (!raw) return emptyMeta();
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || typeof parsed.books !== 'object' || !parsed.books) {
      return emptyMeta();
    }
    return parsed as SyncMeta;
  } catch {
    console.warn('[SyncMeta] 元数据损坏，已重置为全量基线');
    return emptyMeta();
  }
}

export async function saveSyncMeta(meta: SyncMeta): Promise<void> {
  await AsyncStorage.setItem(SYNC_META_KEY, JSON.stringify(meta));
}

// ====== 删除墓碑 ======

async function readIds(key: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    console.warn('[SyncMeta] 墓碑数据损坏，已重置:', key);
    return [];
  }
}

async function appendIds(key: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const merged = Array.from(new Set([...(await readIds(key)), ...ids]));
  // 超限时保留最近写入的部分
  const trimmed = merged.length > MAX_TOMBSTONES ? merged.slice(-MAX_TOMBSTONES) : merged;
  await AsyncStorage.setItem(key, JSON.stringify(trimmed));
}

export const getDeletedBookIds = () => readIds(DELETED_BOOKS_KEY);
export const getDeletedNoteIds = () => readIds(DELETED_NOTES_KEY);
export const markBooksDeleted = (ids: string[]) => appendIds(DELETED_BOOKS_KEY, ids);
export const markNotesDeleted = (ids: string[]) => appendIds(DELETED_NOTES_KEY, ids);

/** 强制全量重导后清空墓碑：以远端为准，恢复所有内容 */
export async function clearDeletedTombstones(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(DELETED_BOOKS_KEY),
    AsyncStorage.removeItem(DELETED_NOTES_KEY),
  ]);
}
