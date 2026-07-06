import { configureStore } from '@reduxjs/toolkit';
import { booksReducer, notesReducer, settingsReducer } from './slices';

export const store = configureStore({
  reducer: {
    books: booksReducer,
    notes: notesReducer,
    settings: settingsReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
