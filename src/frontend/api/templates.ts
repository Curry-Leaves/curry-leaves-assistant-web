/** Meeting templates: list/get/CRUD plus describe-to-create and conversational revise. */
import type { MeetingTemplate, TemplateList } from '../types';
import { j } from './http';

export const templatesApi = {
  listTemplates: () => j<TemplateList>('/templates'),
  getTemplate: (id: string) => j<MeetingTemplate>(`/templates/${encodeURIComponent(id)}`),
  // Author a brand-new template from a plain-language description (the user never writes markdown).
  generateTemplate: (description: string) =>
    j<MeetingTemplate>('/templates/generate', { method: 'POST', body: JSON.stringify({ description }) }),
  // Revise a template conversationally. Pass a recordingId to also re-run the copilot on it
  // (the "something was missed" fix flow from a recording's outputs).
  reviseTemplate: (id: string, instruction: string, recordingId?: string) =>
    j<MeetingTemplate>(`/templates/${encodeURIComponent(id)}/revise`, {
      method: 'POST', body: JSON.stringify({ instruction, recordingId }),
    }),
  saveTemplate: (id: string, patch: Partial<MeetingTemplate>) =>
    j<MeetingTemplate>(`/templates/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deleteTemplate: (id: string) =>
    j<{ ok: boolean }>(`/templates/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  setDefaultTemplate: (templateId: string | null) =>
    j<{ defaultTemplateId: string | null }>('/templates/default', {
      method: 'POST', body: JSON.stringify({ templateId }),
    }),
};
