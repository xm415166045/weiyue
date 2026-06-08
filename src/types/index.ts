// ====== Core Data Types ======

export type ReadingStatus = 'reading' | 'not-yet' | 'finished';

export interface Book {
  id: string;
  title: string;
  author: string;
  coverColor: string; // gradient colors for placeholder
  status: ReadingStatus;
  noteCount: number;
  rating: number; // 1-5
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
  apiKey: string;
}

export interface ImaConfig {
  apiKey: string;
  clientId: string;
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
