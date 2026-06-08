import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Book, Note, SortField, BookFilter, ExportFormat } from '../types';

// ====== Books Slice ======

interface BooksState {
  books: Book[];
  filter: BookFilter;
  sortField: SortField;
  selectMode: boolean;
  selectedIds: string[];
}

const initialBooksState: BooksState = {
  books: [],
  filter: 'reading',
  sortField: 'date',
  selectMode: false,
  selectedIds: [],
};

const booksSlice = createSlice({
  name: 'books',
  initialState: initialBooksState,
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
      const filtered = getFilteredBooks(state.books, state.filter);
      state.selectedIds = filtered.map(b => b.id);
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
  },
});

function getFilteredBooks(books: Book[], filter: BookFilter): Book[] {
  if (filter === 'all') return books;
  return books.filter(b => b.status === filter);
}

export const {
  setBooks, setFilter, setSortField,
  enterSelectMode, toggleSelection, selectAll, deselectAll,
  exitSelectMode, removeBooks,
} = booksSlice;

export default booksSlice.reducer;

// ====== Notes Slice ======

interface NotesState {
  notes: Note[];
  selectMode: boolean;
  selectedIds: string[];
  currentBookId: string | null;
}

const initialNotesState: NotesState = {
  notes: [],
  selectMode: false,
  selectedIds: [],
  currentBookId: null,
};

const notesSlice = createSlice({
  name: 'notes',
  initialState: initialNotesState,
  reducers: {
    setNotes(state, action: PayloadAction<Note[]>) {
      state.notes = action.payload;
    },
    setCurrentBookId(state, action: PayloadAction<string>) {
      state.currentBookId = action.payload;
    },
    enterNotesSelectMode(state, action: PayloadAction<string>) {
      state.selectMode = true;
      state.selectedIds = [action.payload];
    },
    toggleNoteSelection(state, action: PayloadAction<string>) {
      const id = action.payload;
      if (state.selectedIds.includes(id)) {
        state.selectedIds = state.selectedIds.filter(i => i !== id);
      } else {
        state.selectedIds.push(id);
      }
    },
    selectAllNotes(state) {
      state.selectedIds = state.notes.map(n => n.id);
    },
    exitNotesSelectMode(state) {
      state.selectMode = false;
      state.selectedIds = [];
    },
    removeNotes(state, action: PayloadAction<string[]>) {
      state.notes = state.notes.filter(n => !action.payload.includes(n.id));
      state.selectedIds = [];
      state.selectMode = false;
    },
  },
});

export const {
  setNotes, setCurrentBookId,
  enterNotesSelectMode, toggleNoteSelection, selectAllNotes,
  exitNotesSelectMode, removeNotes,
} = notesSlice;

export default notesSlice.reducer;

// ====== Export Slice ======

interface ExportState {
  isExporting: boolean;
  format: ExportFormat;
  error: string | null;
}

const initialExportState: ExportState = {
  isExporting: false,
  format: 'pdf',
  error: null,
};

const exportSlice = createSlice({
  name: 'export',
  initialState: initialExportState,
  reducers: {
    startExport(state, action: PayloadAction<ExportFormat>) {
      state.isExporting = true;
      state.format = action.payload;
      state.error = null;
    },
    exportSuccess(state) {
      state.isExporting = false;
    },
    exportFailure(state, action: PayloadAction<string>) {
      state.isExporting = false;
      state.error = action.payload;
    },
  },
});

export const { startExport, exportSuccess, exportFailure } = exportSlice;
export default exportSlice.reducer;
