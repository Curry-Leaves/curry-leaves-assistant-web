/**
 * Backend client. Lightweight request/response is HTTP against the FastAPI server; the
 * live streams (app events, chat, audio) ride the shared WebSocket in api/socket.ts.
 *
 * One module per domain (mirroring src/curry_leaves_assistant/api/'s routers); this file just
 * assembles them into the single `api` object every screen already imports.
 * Add a new endpoint in its domain module, not here.
 */
import { base } from './http';
import { authApi } from './auth';
import { artifactsApi } from './artifacts';
import { recordingsApi } from './recordings';
import { agentsApi } from './agents';
import { toolsApi } from './tools';
import { dashboardApi } from './dashboard';
import { tasksApi } from './tasks';
import { chatApi } from './chat';
import { transcriptionApi } from './transcription';
import { knowledgeApi } from './knowledge';
import { skillsApi } from './skills';
import { settingsApi } from './settings';
import { providersApi } from './providers';
import { templatesApi } from './templates';
import { searchApi } from './search';
import { filesApi } from './files';
import { backupApi } from './backup';
import { systemApi, subscribeEvents } from './system';

export const api = {
  baseUrl: base,
  ...authApi,
  ...artifactsApi,
  ...recordingsApi,
  ...agentsApi,
  ...toolsApi,
  ...dashboardApi,
  ...tasksApi,
  ...chatApi,
  ...transcriptionApi,
  ...knowledgeApi,
  ...skillsApi,
  ...settingsApi,
  ...providersApi,
  ...templatesApi,
  ...searchApi,
  ...filesApi,
  ...backupApi,
  ...systemApi,
};

export { subscribeEvents };
