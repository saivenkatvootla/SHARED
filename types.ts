
export enum AppStatus {
  IDLE = 'IDLE',
  MONITORING = 'MONITORING',
  ERROR = 'ERROR'
}

export interface JobMode {
  id: string;
  name: string;
  guidelines: string; // User-provided guidelines in text box
  fileContent?: string; // Extracted text from uploaded file for RAG
  fileName?: string;
}

export interface UserProfile {
  name: string;
  email: string;
  picture: string;
}

export interface Insight {
  id: string;
  type: 'voice' | 'screen';
  timestamp: number;
  question: string;
  answer: string;
  feedback?: 'positive' | 'negative';
  policyApplied?: string;
}

export interface ReinforcementPolicy {
  successfulPatterns: string[];
  lastUpdate: number;
}
