/** Backup & restore of the ~/.curry-leaves data directory. */
import { authHeader } from '../auth';
import { base, j } from './http';

export interface BackupInfo {
  dataDir: string;
  totalBytes: number;
  categories: { name: string; bytes: number; files: number }[];
  excluded: string[];
}

export const backupApi = {
  backupInfo: () => j<BackupInfo>('/backup/info'),

  /** Fetch the backup zip with auth and hand it to the browser as a download. */
  exportBackup: async (): Promise<void> => {
    const res = await fetch(`${await base()}/backup/export`, { headers: { ...authHeader() } });
    if (!res.ok) throw new Error((await res.text().catch(() => '')) || `export → ${res.status}`);
    const name = /filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') ?? '')?.[1]
      ?? 'curry-leaves-backup.zip';
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  },

  restoreBackup: async (file: File): Promise<{ ok: boolean; safetyCopy: string; note: string }> => {
    const body = new FormData();
    body.append('file', file);
    // No Content-Type header — the browser sets the multipart boundary itself.
    const res = await fetch(`${await base()}/backup/restore`, { method: 'POST', headers: { ...authHeader() }, body });
    if (!res.ok) throw new Error((await res.text().catch(() => '')) || `restore → ${res.status}`);
    return res.json();
  },
};
