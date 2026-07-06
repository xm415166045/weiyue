import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Note } from '../../types';

interface NotesState {
  notes: Note[];
  selectMode: boolean;
  selectedIds: string[];
  currentBookId: string | null;
}

const initialState: NotesState = {
  notes: [],
  selectMode: false,
  selectedIds: [],
  currentBookId: null,
};

const notesSlice = createSlice({
  name: 'notes',
  initialState,
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
      // 全选当前书籍的所有笔记（使用 notes.length 而非显示过滤后的列表长度，因为当前视图已包含该书所有笔记）
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
} = notesSlice.actions;

export default notesSlice.reducer;
