import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

/**
 * Credentials for the local backend.
 *
 * Kept in memory only on purpose. The packaged app generates a fresh token on
 * every launch (`src-tauri/src/lib.rs`) and the sidecar listens on an
 * OS-chosen port, so persisting either would be stale — and localStorage is
 * the wrong place for a secret. `baseApi` fills this in the first time it
 * resolves the target, so components can read it with `useAppSelector`.
 */
export type BackendCredentials = {
  baseUrl: string;
  token: string | null;
};

interface AppState {
  backendBaseUrl: string | null;
  backendToken: string | null;
}

const initialState: AppState = {
  backendBaseUrl: null,
  backendToken: null,
};

export const appSlice = createSlice({
  name: "app",
  initialState,
  reducers: {
    setBackend: (state, action: PayloadAction<BackendCredentials>) => {
      state.backendBaseUrl = action.payload.baseUrl;
      state.backendToken = action.payload.token;
    },
    clearBackend: (state) => {
      state.backendBaseUrl = null;
      state.backendToken = null;
    },
  },
});

export const { setBackend, clearBackend } = appSlice.actions;

export default appSlice;
