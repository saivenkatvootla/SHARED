
export enum AppStatus {
  IDLE = 'IDLE',
  MONITORING = 'MONITORING',
  ERROR = 'ERROR'
}

export interface JobMode {
  id: string;
  name: string;
  instruction: string;
  fileContent?: string;
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
  confidence?: number;
}

export interface AppState {
  isStealth: boolean;
  status: AppStatus;
  insights: Insight[];
  lastScreenUpdate: number;
  isVoiceActive: boolean;
}
