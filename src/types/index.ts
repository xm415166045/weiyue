// ====== Core Data Types ======

export type ReadingStatus = 'reading' | 'not-yet' | 'finished';

export type ReadStatsMode = 'weekly' | 'monthly' | 'annually' | 'overall';
export type ReadStatsModeCN = '周' | '月' | '年' | '总';

export interface CategoryPref {
  categoryId: number;
  categoryTitle: string;
  val: number;
  readingTime: number;     // 秒
  readingCount: number;
}

export interface ReadLongestBook {
  book?: { bookId: string; title: string; author: string; cover: string; };
  albumInfo?: { albumId: string; name: string; authorName: string; cover: string; };
  readTime: number;        // 秒
  tags: string[];
}

export interface ReadStatItem {
  stat: string;
  counts: string;
  scheme?: string | null;
}

export interface WeReadStats {
  baseTime: number;
  mode: ReadStatsMode;
  readDays: number;
  totalReadTime: number;        // 秒
  dayAverageReadTime: number;   // 秒
  compare?: number | null;
  readTimes: Record<string, number>;     // key=ts, value=秒
  dailyReadTimes: Record<string, number>;
  readLongest: ReadLongestBook[];
  preferCategory: CategoryPref[];
  preferTime: number[];          // 24小时分布（秒），从6点开始
  readStat: ReadStatItem[];
  registTime: number;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  coverColor?: string; // 无封面时的渐变占位色（可选）
  coverUrl?: string;  // 微信读书封面 URL（可选）
  status: ReadingStatus;
  noteCount: number;
  rating: number; // 1-5
  readingTime?: number; // 阅读时长（分钟），从微信读书导入
  lastReadDate: string; // ISO date
  createdAt: string;
  updatedAt: string;
}

export interface Note {
  id: string;
  bookId: string;
  text: string;
  chapter?: string;
  page?: number;
  type: 'highlight' | 'thought' | 'bookmark';
  createdAt: string;
}

export interface ReadingStats {
  totalBooks: number;
  totalNotes: number;
  totalReadingTime: number; // minutes
  finishedBooks: number;
  readingStreak: number; // days
  avgReadingSpeed: number; // pages per hour
}

export interface MonthlyData {
  month: string; // YYYY-MM
  readingTime: number; // minutes
  booksFinished: number;
  notesCount: number;
}

export type ExportFormat = 'pdf' | 'markdown' | 'epub';

// ====== API Config ======

export interface WeReadConfig {
  apiKey: string;    // 微信读书 API Key（wrk- 开头）
}

export interface ImaConfig {
  apiKey: string;
  clientId: string;
  knowledgeBases?: KnowledgeBase[]; // 同步后的知识库列表
}

export interface KnowledgeBase {
  id: string;       // knowledge_base_id
  name: string;     // knowledge_base_name
  avatar?: string;  // 封面 URL
}

export interface SyncConfig {
  autoSync: boolean;
  defaultKnowledgeBase: string;
}

export interface AppSettings {
  weread: WeReadConfig;
  ima: ImaConfig;
  sync: SyncConfig;
}

// ====== UI State ======

export type SortField = 'date' | 'name' | 'author';
export type StatsPeriod = 'week' | 'month' | 'year' | 'all';
export type BookFilter = ReadingStatus | 'all';
