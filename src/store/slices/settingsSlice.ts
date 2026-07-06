import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { AppSettings, ReadingStats } from '../../types';
import type { ImportProgress } from '../../services/weread-api';

interface SettingsState {
  settings: AppSettings | null;
  stats: ReadingStats | null;
  loading: boolean;
  verifying: boolean;
  apiKeyStatus: 'unknown' | 'valid' | 'invalid';
  syncing: boolean;
  synced: boolean;
  importing: boolean;
  importProgress: ImportProgress | null;
  error: string | null;
}

const initialState: SettingsState = {
  settings: null,
  stats: null,
  loading: true,
  verifying: false,
  apiKeyStatus: 'unknown',
  syncing: false,
  synced: false,
  importing: false,
  importProgress: null,
  error: null,
};

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    setSettings(state, action: PayloadAction<AppSettings>) {
      state.settings = action.payload;
    },
    setImportProgress(state, action: PayloadAction<ImportProgress | null>) {
      state.importProgress = action.payload;
    },
    clearError(state) {
      state.error = null;
    },
    setApiKeyStatus(state, action: PayloadAction<'unknown' | 'valid' | 'invalid'>) {
      state.apiKeyStatus = action.payload;
    },
    resetImportState(state) {
      state.importing = false;
      state.importProgress = null;
    },
  },
});

export const {
  setSettings,
  setImportProgress,
  clearError,
  setApiKeyStatus,
  resetImportState,
} = settingsSlice.actions;

export default settingsSlice.reducer;
