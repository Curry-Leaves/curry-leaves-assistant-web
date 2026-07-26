/** Sandboxed read-only file browsing, for the chat composer's `@file` picker.
 *  Only a few fixed folders are reachable and only on a local deployment — the backend
 *  enforces both (stores/files_store.py); `capabilities().fileBrowse` says whether to
 *  offer the option at all. */
import { j } from './http';

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number | null;
}

export const filesApi = {
  /** One directory's contents. Omit `path` for the browsable roots. */
  browseFiles: (path?: string) =>
    j<{ path: string; parent: string | null; entries: FileEntry[] }>(
      `/files/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`,
    ),
};
