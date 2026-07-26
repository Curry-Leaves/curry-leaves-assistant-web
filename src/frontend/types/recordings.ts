export interface Recording {
  id: string;
  name: string;
  status: 'recording' | 'saved' | 'interrupted';  // 'interrupted' = crashed mid-capture, awaiting user Save/Discard
  createdAt: string;
  savedAt: string | null;
  duration: number | null;
  tags: string[];
  notes?: string;
  links?: RecordingLink[];
  attachments?: RecordingAttachment[];
  attendees?: string[];        // people in the meeting; drives attribution + transcription bias
  saveToKnowledge?: boolean;
  templateId?: string | null;   // primary meeting template (first of templateIds; owns the summary)
  templateIds?: string[];       // all meeting templates driving the copilot's outputs
  agentIds?: string[] | null;  // bound agents for this recording; null = all trigger-matched agents
  language?: string | null;    // per-recording transcription language override; falsy = use Settings → Recording default
  audioPath?: string | null;
  transcript: string | null;
  summary: string | null;
  actionItems: { id: string; text: string; done: boolean }[];
  outputs?: string[];  // output keys that have produced an artifact (names only, no content)
}

export interface RecordingOutput {
  agentId: string;
  key: string;         // tab identity: <agentId> or <agentId>.<section>
  section?: string | null;
  title: string;
  updatedAt: string | null;
  jobId?: string | null;
  content: string;
}

export interface RecordingLink { url: string; title?: string }
export interface RecordingAttachment { name: string; mdPath?: string; size?: number; chars?: number }

export interface WhisperModelInfo { name: string; backend: string; sizeLabel: string; downloaded: boolean; active: boolean }

/** A vocabulary term mined from the user's meeting notes. `active` = past the sighting
 *  threshold and not blocked, i.e. actually biasing transcription right now. */
export interface LearnedTerm { term: string; count: number; last: string; blocked: boolean; active: boolean }
