import AsyncStorage from '@react-native-async-storage/async-storage';
import { Book, Note, AppSettings, ReadingStats, MonthlyData } from '../types';

const KEYS = {
  BOOKS: '@weread_books',
  NOTES: '@weread_notes',
  SETTINGS: '@weread_settings',
  STATS: '@weread_stats',
  MONTHLY_DATA: '@weread_monthly_data',
};

// ====== Default Settings ======

const defaultSettings: AppSettings = {
  weread: { apiKey: '' },
  ima: { apiKey: '', clientId: '' },
  sync: { autoSync: false, defaultKnowledgeBase: '' },
};

// ====== Books ======

export async function getBooks(): Promise<Book[]> {
  const data = await AsyncStorage.getItem(KEYS.BOOKS);
  return data ? JSON.parse(data) : [];
}

export async function saveBooks(books: Book[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.BOOKS, JSON.stringify(books));
}

export async function addBook(book: Book): Promise<void> {
  const books = await getBooks();
  books.push(book);
  await saveBooks(books);
}

export async function updateBook(updated: Book): Promise<void> {
  const books = await getBooks();
  const index = books.findIndex(b => b.id === updated.id);
  if (index !== -1) {
    books[index] = updated;
    await saveBooks(books);
  }
}

export async function deleteBooks(ids: string[]): Promise<void> {
  const books = await getBooks();
  await saveBooks(books.filter(b => !ids.includes(b.id)));
  // Also delete related notes
  const notes = await getNotes();
  await saveNotes(notes.filter(n => !ids.includes(n.bookId)));
}

// ====== Notes ======

export async function getNotes(): Promise<Note[]> {
  const data = await AsyncStorage.getItem(KEYS.NOTES);
  return data ? JSON.parse(data) : [];
}

export async function getNotesByBookId(bookId: string): Promise<Note[]> {
  const notes = await getNotes();
  return notes.filter(n => n.bookId === bookId);
}

export async function saveNotes(notes: Note[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.NOTES, JSON.stringify(notes));
}

export async function addNote(note: Note): Promise<void> {
  const notes = await getNotes();
  notes.push(note);
  await saveNotes(notes);
}

export async function deleteNotes(ids: string[]): Promise<void> {
  const notes = await getNotes();
  await saveNotes(notes.filter(n => !ids.includes(n.id)));
}

// ====== Settings ======

export async function getSettings(): Promise<AppSettings> {
  const data = await AsyncStorage.getItem(KEYS.SETTINGS);
  return data ? { ...defaultSettings, ...JSON.parse(data) } : defaultSettings;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await AsyncStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
}

// ====== Stats ======

export async function getStats(): Promise<ReadingStats | null> {
  const data = await AsyncStorage.getItem(KEYS.STATS);
  return data ? JSON.parse(data) : null;
}

export async function saveStats(stats: ReadingStats): Promise<void> {
  await AsyncStorage.setItem(KEYS.STATS, JSON.stringify(stats));
}

export async function getMonthlyData(): Promise<MonthlyData[]> {
  const data = await AsyncStorage.getItem(KEYS.MONTHLY_DATA);
  return data ? JSON.parse(data) : [];
}

export async function saveMonthlyData(data: MonthlyData[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.MONTHLY_DATA, JSON.stringify(data));
}

// ====== Seed Demo Data ======

export async function seedDemoData(): Promise<void> {
  const existingBooks = await getBooks();
  if (existingBooks.length > 0) return; // Already seeded

  const now = new Date().toISOString();

  const books: Book[] = [
    { id: 'b1', title: '深度学习', author: 'Ian Goodfellow', coverColor: '#1A4B6B,#0A84FF,#5AC8FA', status: 'reading', noteCount: 42, rating: 5, lastReadDate: '2024-04-27', createdAt: now, updatedAt: now },
    { id: 'b2', title: '算法导论', author: 'Thomas Cormen', coverColor: '#7C3AED,#A78BFA,#C4B5FD', status: 'reading', noteCount: 35, rating: 4, lastReadDate: '2024-04-26', createdAt: now, updatedAt: now },
    { id: 'b3', title: '设计模式', author: 'Erich Gamma', coverColor: '#059669,#34D399,#6EE7B7', status: 'reading', noteCount: 28, rating: 3, lastReadDate: '2024-04-24', createdAt: now, updatedAt: now },
    { id: 'b4', title: '人月神话', author: 'F. Brooks', coverColor: '#334155,#64748B,#CBD5E1', status: 'reading', noteCount: 3, rating: 4, lastReadDate: '2024-03-15', createdAt: now, updatedAt: now },
    { id: 'b5', title: '代码大全', author: 'Steve McConnell', coverColor: '#DC2626,#F87171,#FECACA', status: 'not-yet', noteCount: 0, rating: 0, lastReadDate: '', createdAt: now, updatedAt: now },
    { id: 'b6', title: '重构', author: 'Martin Fowler', coverColor: '#2563EB,#60A5FA,#BFDBFE', status: 'not-yet', noteCount: 0, rating: 0, lastReadDate: '', createdAt: now, updatedAt: now },
    { id: 'b7', title: '程序员修炼之道', author: 'Hunt & Thomas', coverColor: '#9333EA,#C084FC,#E9D5FF', status: 'not-yet', noteCount: 0, rating: 0, lastReadDate: '', createdAt: now, updatedAt: now },
    { id: 'b8', title: 'Clean Code', author: 'Robert Martin', coverColor: '#0D9488,#2DD4BF,#99F6E4', status: 'finished', noteCount: 56, rating: 5, lastReadDate: '2024-04-10', createdAt: now, updatedAt: now },
    { id: 'b9', title: '黑客与画家', author: 'Paul Graham', coverColor: '#EA580C,#FB923C,#FED7AA', status: 'finished', noteCount: 23, rating: 4, lastReadDate: '2024-03-28', createdAt: now, updatedAt: now },
    { id: 'b10', title: '编程珠玑', author: 'Jon Bentley', coverColor: '#4338CA,#818CF8,#C7D2FE', status: 'finished', noteCount: 18, rating: 5, lastReadDate: '2024-02-15', createdAt: now, updatedAt: now },
    { id: 'b11', title: '计算机程序设计艺术', author: 'Donald Knuth', coverColor: '#BE185D,#F472B6,#FBCFE8', status: 'finished', noteCount: 41, rating: 5, lastReadDate: '2024-01-20', createdAt: now, updatedAt: now },
    { id: 'b12', title: '架构整洁之道', author: 'Robert Martin', coverColor: '#1E40AF,#3B82F6,#93C5FD', status: 'finished', noteCount: 32, rating: 4, lastReadDate: '2024-01-05', createdAt: now, updatedAt: now },
  ];

  const notes: Note[] = [
    { id: 'n1', bookId: 'b1', text: '深度学习是机器学习的一个分支，它试图使用包含复杂结构或由多重非线性变换构成的多个处理层对数据进行高层抽象的算法。', chapter: '第1章 引言', type: 'highlight', createdAt: now },
    { id: 'n2', bookId: 'b1', text: '反向传播算法是训练神经网络的核心算法，它通过计算损失函数对每个权重的梯度来更新权重。', chapter: '第6章 深度前馈网络', type: 'highlight', createdAt: now },
    { id: 'n3', bookId: 'b1', text: '这里对卷积神经网络的解释非常清晰，池化层的设计思想值得深入思考。', chapter: '第9章 卷积网络', type: 'thought', createdAt: now },
    { id: 'n4', bookId: 'b8', text: '有意义的命名是代码可读性的基础。变量名应该揭示意图，而不是掩盖它。', chapter: '第2章 有意义的命名', type: 'highlight', createdAt: now },
    { id: 'n5', bookId: 'b8', text: '函数应该短小精悍，只做一件事，做好这件事，只做这一件事。', chapter: '第3章 函数', type: 'highlight', createdAt: now },
    { id: 'n6', bookId: 'b9', text: '创造财富的最佳途径不是通过掠夺现有的财富，而是通过创造新的财富。', chapter: '第6章 如何创造财富', type: 'highlight', createdAt: now },
    { id: 'n7', bookId: 'b2', text: '分治法是一种重要的算法设计范式，将问题分解为更小的子问题，递归求解后合并结果。', chapter: '第4章 分治策略', type: 'highlight', createdAt: now },
    { id: 'n8', bookId: 'b3', text: '观察者模式定义了对象之间的一对多依赖关系，当一个对象状态改变时，所有依赖者都会收到通知。', chapter: '第5章 观察者模式', type: 'highlight', createdAt: now },
  ];

  const stats: ReadingStats = {
    totalBooks: 12,
    totalNotes: 278,
    totalReadingTime: 2760,
    finishedBooks: 5,
    readingStreak: 7,
    avgReadingSpeed: 25,
  };

  const monthlyData: MonthlyData[] = [
    { month: '2024-01', readingTime: 420, booksFinished: 2, notesCount: 45 },
    { month: '2024-02', readingTime: 380, booksFinished: 1, notesCount: 38 },
    { month: '2024-03', readingTime: 520, booksFinished: 2, notesCount: 62 },
    { month: '2024-04', readingTime: 440, booksFinished: 1, notesCount: 55 },
    { month: '2024-05', readingTime: 300, booksFinished: 0, notesCount: 30 },
    { month: '2024-06', readingTime: 200, booksFinished: 0, notesCount: 18 },
    { month: '2024-07', readingTime: 0, booksFinished: 0, notesCount: 0 },
    { month: '2024-08', readingTime: 0, booksFinished: 0, notesCount: 0 },
    { month: '2024-09', readingTime: 0, booksFinished: 0, notesCount: 0 },
    { month: '2024-10', readingTime: 0, booksFinished: 0, notesCount: 0 },
    { month: '2024-11', readingTime: 0, booksFinished: 0, notesCount: 0 },
    { month: '2024-12', readingTime: 0, booksFinished: 0, notesCount: 0 },
  ];

  await saveBooks(books);
  await saveNotes(notes);
  await saveStats(stats);
  await saveMonthlyData(monthlyData);
}
