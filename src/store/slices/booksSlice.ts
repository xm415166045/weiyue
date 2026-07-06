import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Book, SortField, BookFilter } from '../../types';

interface BooksState {
  books: Book[];
  filter: BookFilter;
  sortField: SortField;
  selectMode: boolean;
  selectedIds: string[];
}

const initialState: BooksState = {
  books: [],
  filter: 'reading',
  sortField: 'date',
  selectMode: false,
  selectedIds: [],
};

const booksSlice = createSlice({
  name: 'books',
  initialState,
  reducers: {
    setBooks(state, action: PayloadAction<Book[]>) {
      state.books = action.payload;
    },
    setFilter(state, action: PayloadAction<BookFilter>) {
      state.filter = action.payload;
    },
    setSortField(state, action: PayloadAction<SortField>) {
      state.sortField = action.payload;
    },
    enterSelectMode(state, action: PayloadAction<string>) {
      state.selectMode = true;
      state.selectedIds = [action.payload];
    },
    toggleSelection(state, action: PayloadAction<string>) {
      const id = action.payload;
      if (state.selectedIds.includes(id)) {
        state.selectedIds = state.selectedIds.filter(i => i !== id);
      } else {
        state.selectedIds.push(id);
      }
    },
    selectAll(state) {
      const filtered = state.filter === 'all' ? state.books
        : state.filter === 'reading'
          ? state.books.filter(b => b.status === 'reading' || b.status === 'not-yet')
          : state.books.filter(b => b.status === state.filter);
      state.selectedIds = filtered.map(b => b.id);
    },
    setSelectedIds(state, action: PayloadAction<string[]>) {
      state.selectedIds = action.payload;
    },
    deselectAll(state) {
      state.selectedIds = [];
    },
    exitSelectMode(state) {
      state.selectMode = false;
      state.selectedIds = [];
    },
    removeBooks(state, action: PayloadAction<string[]>) {
      state.books = state.books.filter(b => !action.payload.includes(b.id));
      state.selectedIds = [];
      state.selectMode = false;
    },
    updateBookNoteCount(state, action: PayloadAction<{ bookId: string; noteCount: number }>) {
      const book = state.books.find(b => b.id === action.payload.bookId);
      if (book) book.noteCount = action.payload.noteCount;
    },
  },
});

export const {
  setBooks, setFilter, setSortField,
  enterSelectMode, toggleSelection, selectAll, deselectAll,
  exitSelectMode, removeBooks, updateBookNoteCount,
  setSelectedIds,
} = booksSlice.actions;

export default booksSlice.reducer;
