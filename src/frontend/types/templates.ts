export interface TemplateSection {
  id: string;
  title: string;
}

export interface MeetingTemplate {
  id: string;
  name: string;
  description: string;
  sections: TemplateSection[];
  extract: { todos: boolean; reminders: boolean };
  live: { watch: string[] };
  agents?: string[];
  body?: string;       // present on GET /templates/{id}; omitted from the list
  createdAt?: string;
  updatedAt?: string;
}

export interface TemplateList {
  defaultTemplateId: string | null;
  templates: MeetingTemplate[];
}
