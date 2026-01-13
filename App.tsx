
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AppStatus, Insight, JobMode, UserProfile } from './types';
import { StealthUI } from './components/StealthUI';
import { analyzeScreenContent, getGeminiClient, encodeAudio, decodeAudio, decodeAudioData, processTypedQuestion } from './services/geminiService';
import { LiveServerMessage, Modality } from '@google/genai';

// Declare google for TypeScript
declare const google: any;

const INITIAL_MODES: JobMode[] = [
  { id: '1', name: 'Guidewire Expert', instruction: 'Answer as an expert Guidewire Developer. Focus on Gosu, configuration, and integration. Be extremely concise.' },
  { id: '2', name: 'General Assistant', instruction: 'Provide helpful, 1-sentence answers for any query.' },
  { id: '3', name: 'Senior Java Lead', instruction: 'Answer as a Senior Java Developer. Focus on Microservices and Spring. Minimal filler.' },
];

const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isStealth, setIsStealth] = useState(false);
  const [insights, setInsights] = useState<Insight[]>([]);
  
  // Real-time Voice States
  const [userInputBuffer, setUserInputBuffer] = useState<string>('');
  const [aiOutputBuffer, setAiOutputBuffer] = useState<string>('');
  const [latestAnswer, setLatestAnswer] = useState<{question: string, answer: string} | null>(null);
  const [typedQuestion, setTypedQuestion] = useState<string>('');
  const [isQuerying, setIsQuerying] = useState<boolean>(false);
  
  // Conversation History for Context
  const [history, setHistory] = useState<string[]>([]);
  
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [showLocalLogin, setShowLocalLogin] = useState(false);
  const [localNameInput, setLocalNameInput] = useState('');
  
  // Auth State
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);

  // Modes State
  const [modes, setModes] = useState<JobMode[]>(INITIAL_MODES);
  const [currentModeId, setCurrentModeId] = useState<string>(INITIAL_MODES[0].id);
  const [isModeDropdownOpen, setIsModeDropdownOpen] = useState(false);
  const [isManageModesOpen, setIsManageModesOpen] = useState(false);
  const [editingModeId, setEditingModeId] = useState<string | null>(null);

  const currentMode = modes.find(m => m.id === currentModeId) || modes[0];

  const screenStreamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureIntervalRef = useRef<number | null>(null);
  
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);

  const getStorageKey = (id: string) => `omnisense_v4_data_${id}`;

  // Initial Load
  useEffect(() => {
    const storedUser = localStorage.getItem('omnisense_user');
    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        loadUserData(parsedUser);
      } catch (e) {
        console.error("Failed to restore session", e);
      }
    }
    videoRef.current = document.createElement('video');
    canvasRef.current = document.createElement('canvas');
    return () => stopAll();
  }, []);

  const loadUserData = (profile: UserProfile) => {
    setUser(profile);
    const storedData = localStorage.getItem(getStorageKey(profile.email));
    if (storedData) {
      const { insights: savedInsights, modes: savedModes, lastModeId } = JSON.parse(storedData);
      if (savedInsights) setInsights(savedInsights);
      if (savedModes) setModes(savedModes);
      if (lastModeId) setCurrentModeId(lastModeId);
    }
  };

  // Data Persistence
  useEffect(() => {
    if (user) {
      setIsAutoSaving(true);
      const dataToSave = { insights, modes, lastModeId: currentModeId };
      localStorage.setItem(getStorageKey(user.email), JSON.stringify(dataToSave));
      const timeout = setTimeout(() => setIsAutoSaving(false), 800);
      return () => clearTimeout(timeout);
    }
  }, [insights, modes, currentModeId, user]);

  const stopAll = () => {
    if (captureIntervalRef.current) clearInterval(captureIntervalRef.current);
    if (screenStreamRef.current) screenStreamRef.current.getTracks().forEach(t => t.stop());
    if (sessionRef.current) sessionRef.current.close();
    setStatus(AppStatus.IDLE);
    setLatestAnswer(null);
    setUserInputBuffer('');
    setAiOutputBuffer('');
    setHistory([]);
    setTypedQuestion('');
    setErrorMessage(null);
  };

  const handleLocalLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!localNameInput.trim()) return;
    const profile: UserProfile = {
      name: localNameInput.trim(),
      email: `local_${Date.now()}`,
      picture: `https://api.dicebear.com/7.x/bottts/svg?seed=${localNameInput}`
    };
    setUser(profile);
    localStorage.setItem('omnisense_user', JSON.stringify(profile));
    loadUserData(profile);
    setShowLocalLogin(false);
  };

  const handleGoogleLogin = () => {
    if (typeof google === 'undefined') {
      alert("Auth Script Error. Use Local Profile.");
      return;
    }
    const clientId = "15001756060-dqphg9ncil15n1374lfuf6gkna7ntvmf.apps.googleusercontent.com";
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
      callback: async (tokenResponse: any) => {
         if (tokenResponse && tokenResponse.access_token) {
            try {
              const userInfo = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                 headers: { Authorization: `Bearer ${tokenResponse.access_token}` }
              }).then(res => res.json());
              const profile: UserProfile = { name: userInfo.name, email: userInfo.email, picture: userInfo.picture };
              setUser(profile);
              localStorage.setItem('omnisense_user', JSON.stringify(profile));
              loadUserData(profile);
            } catch (error) { console.error(error); }
         }
      },
      error_callback: () => alert("Google Auth restricted in this environment. Please use 'Local Profile'.")
    });
    client.requestAccessToken();
  };

  const handleSignOut = () => {
    stopAll();
    setUser(null);
    setIsProfileMenuOpen(false);
    localStorage.removeItem('omnisense_user');
  };

  const addInsight = useCallback((type: 'voice' | 'screen', question: string, answer: string) => {
    const newInsight: Insight = { id: Math.random().toString(36).substr(2, 9), type, timestamp: Date.now(), question, answer };
    setInsights(prev => [newInsight, ...prev].slice(0, 50));
    setLatestAnswer({ question, answer });
    // Update contextual history
    setHistory(prev => [...prev, `${type === 'voice' ? 'User' : 'Screen'}: ${question}`, `AI: ${answer}`].slice(-10));
  }, []);

  const handleSendTypedQuestion = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!typedQuestion.trim() || isQuerying) return;

    setIsQuerying(true);
    const activeMode = modes.find(m => m.id === currentModeId) || modes[0];
    
    // Process query with context from the last few conversation turns
    const answer = await processTypedQuestion(
      typedQuestion, 
      history, 
      activeMode.instruction, 
      activeMode.fileContent || ''
    );

    if (answer) {
      addInsight('voice', typedQuestion, answer);
      setTypedQuestion('');
    }
    setIsQuerying(false);
  };

  const startMonitoring = async () => {
    if (!user) return;
    setErrorMessage(null);
    try {
      // Simplified options to improve compatibility
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      });
      screenStreamRef.current = stream;
      
      // Stop monitoring if user stops sharing via browser UI
      stream.getTracks()[0].onended = () => {
        stopAll();
      };

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      
      await startVoiceSession();
      captureIntervalRef.current = window.setInterval(captureAndAnalyze, 12000);
      setStatus(AppStatus.MONITORING);
    } catch (err: any) {
      console.error(err);
      if (err.name === 'NotAllowedError') {
        setErrorMessage("Permission denied. Please allow screen and microphone access to start monitoring.");
      } else {
        setErrorMessage("An unexpected error occurred. Please check your connection and try again.");
      }
      setStatus(AppStatus.ERROR);
      // Don't auto-reset status immediately if there's an error message to show
      setTimeout(() => {
        if (status === AppStatus.ERROR) setStatus(AppStatus.IDLE);
      }, 5000);
    }
  };

  const captureAndAnalyze = async () => {
    if (!videoRef.current || !canvasRef.current || !screenStreamRef.current?.active) return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (video.videoWidth === 0) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const base64Image = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
    
    const activeMode = modes.find(m => m.id === currentModeId) || modes[0];
    const result = await analyzeScreenContent(base64Image, activeMode.instruction, activeMode.fileContent || '');
    if (result?.question) addInsight('screen', result.question, result.answer);
  };

  const startVoiceSession = async () => {
    const ai = getGeminiClient();
    inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    
    // Attempt to get mic stream early to trigger permission
    const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    const activeMode = modes.find(m => m.id === currentModeId) || modes[0];
    const systemInstruction = `YOU ARE IN '${activeMode.name}' MODE. ${activeMode.instruction}. 
    RULES: 
    1. Answer immediately. 
    2. Be extremely concise. 
    3. Do not use conversational filler (e.g., "I see", "Sure"). 
    4. If a question is asked, answer it directly.
    5. ALL RESPONSES MUST BE IN ENGLISH REGARDLESS OF INPUT LANGUAGE.`;

    const sessionPromise = ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction,
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
        outputAudioTranscription: {},
        inputAudioTranscription: {}, 
      },
      callbacks: {
        onopen: () => {
          const source = inputAudioContextRef.current!.createMediaStreamSource(micStream);
          const scriptProcessor = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);
          scriptProcessor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            const int16 = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
            sessionPromise.then(s => s.sendRealtimeInput({ 
              media: { data: encodeAudio(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' } 
            }));
          };
          source.connect(scriptProcessor);
          scriptProcessor.connect(inputAudioContextRef.current!.destination);
        },
        onmessage: async (message: LiveServerMessage) => {
          const audioBase = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
          if (audioBase && outputAudioContextRef.current) {
            const ctx = outputAudioContextRef.current;
            nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
            const buffer = await decodeAudioData(decodeAudio(audioBase), ctx, 24000, 1);
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(ctx.destination);
            source.start(nextStartTimeRef.current);
            nextStartTimeRef.current += buffer.duration;
            audioSourcesRef.current.add(source);
          }

          if (message.serverContent?.inputTranscription) {
            const text = message.serverContent.inputTranscription.text;
            setUserInputBuffer(prev => prev + text);
          }

          if (message.serverContent?.outputTranscription) {
            const text = message.serverContent.outputTranscription.text;
            setAiOutputBuffer(prev => prev + text);
          }

          if (message.serverContent?.turnComplete) {
            setUserInputBuffer(userText => {
              setAiOutputBuffer(aiText => {
                const q = userText.trim();
                const a = aiText.trim();
                if (q || a) {
                  addInsight('voice', q || 'Voice Query', a || '[Audio Response]');
                }
                return ''; 
              });
              return ''; 
            });
          }
        },
        onerror: (e) => {
          console.error("Live session error:", e);
          setErrorMessage("Voice connection error. Please restart radar.");
        },
        onclose: () => {
          console.log("Live session closed.");
        }
      }
    });
    sessionRef.current = await sessionPromise;
  };

  const handleCreateMode = () => {
    const newMode: JobMode = {
      id: Math.random().toString(36).substr(2, 9),
      name: 'New Custom Mode',
      instruction: 'Define the AI behavior for this mode...',
      fileName: '',
      fileContent: ''
    };
    setModes([...modes, newMode]);
    setEditingModeId(newMode.id);
  };

  const handleDeleteMode = (id: string) => {
    if (modes.length <= 1) return;
    const newModes = modes.filter(m => m.id !== id);
    setModes(newModes);
    if (currentModeId === id) setCurrentModeId(newModes[0].id);
    if (editingModeId === id) setEditingModeId(null);
  };

  const updateMode = (id: string, updates: Partial<JobMode>) => {
    setModes(modes.map(m => m.id === id ? { ...m, ...updates } : m));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, id: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      updateMode(id, { fileName: file.name, fileContent: text });
    } catch (err) {
      console.error("File reading error:", err);
      alert("Error reading document.");
    }
  };

  const grouped: Record<string, Insight[]> = insights.reduce((acc: Record<string, Insight[]>, insight) => {
    const date = new Date(insight.timestamp).toDateString();
    if (!acc[date]) acc[date] = [];
    acc[date].push(insight);
    return acc;
  }, {});

  const editingMode = modes.find(m => m.id === editingModeId);

  return (
    <div className="min-h-screen bg-black text-white font-sans flex flex-col overflow-hidden">
      {/* HUD Header */}
      <div className="h-20 border-b border-zinc-900 flex items-center justify-between px-10 bg-black/80 backdrop-blur-xl z-50">
        <button onClick={() => { setIsStealth(false); setStatus(AppStatus.IDLE); }} className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center shadow-[0_0_20px_rgba(37,99,235,0.5)]">
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          </div>
          <div className="text-left">
            <h1 className="text-2xl font-black tracking-tighter leading-none">OMNISENSE</h1>
            <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.3em] mt-1">Status: Online</p>
          </div>
        </button>

        {user && (
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isAutoSaving ? 'bg-blue-500 animate-pulse' : 'bg-zinc-700'}`} />
              <span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">{isAutoSaving ? 'Syncing' : 'Secure'}</span>
            </div>
            <div className="relative">
              <button onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)} className="flex items-center gap-3 bg-zinc-900/50 p-1.5 pr-4 rounded-full border border-zinc-800">
                <img src={user.picture} className="w-8 h-8 rounded-full border border-zinc-700" alt="User" />
                <span className="text-sm font-bold">{user.name}</span>
              </button>
              {isProfileMenuOpen && (
                <div className="absolute top-full right-0 mt-3 w-64 bg-zinc-950 border border-zinc-800 rounded-3xl shadow-2xl py-3 animate-in fade-in">
                  <button onClick={() => { setIsManageModesOpen(true); setIsProfileMenuOpen(false); }} className="w-full text-left px-6 py-3 hover:bg-zinc-900 flex items-center gap-3 text-sm font-bold">
                    <svg className="w-5 h-5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
                    Manage Modes
                  </button>
                  <button onClick={handleSignOut} className="w-full text-left px-6 py-3 hover:bg-red-950/20 text-red-500 flex items-center gap-3 text-sm font-bold">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {errorMessage && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-[100] w-full max-w-xl px-8 animate-in slide-in-from-top">
          <div className="bg-red-950/40 backdrop-blur-3xl border border-red-900/40 p-5 rounded-2xl flex items-center gap-4 text-red-500 shadow-2xl">
            <svg className="w-6 h-6 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            <p className="text-sm font-bold leading-snug">{errorMessage}</p>
            <button onClick={() => setErrorMessage(null)} className="ml-auto p-2 hover:bg-red-500/10 rounded-lg transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
      )}

      {!user ? (
        <div className="flex-1 flex flex-col items-center justify-center p-12 text-center animate-in fade-in duration-700">
          <div className="w-32 h-32 rounded-[2.5rem] bg-gradient-to-br from-blue-500 to-indigo-900 flex items-center justify-center shadow-2xl mb-12 rotate-3 hover:rotate-0 transition-transform duration-500">
            <svg className="w-16 h-16 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          </div>
          <h2 className="text-7xl font-black tracking-tighter mb-6">Initialize Intelligence.</h2>
          <p className="text-zinc-500 max-w-2xl text-xl mb-16 leading-relaxed">OmniSense is a persistent intelligence layer that monitors your environment to provide contextual support via voice and vision.</p>
          
          <div className="flex flex-col gap-6 w-full max-w-sm">
            <button onClick={handleGoogleLogin} className="group bg-white text-black py-5 rounded-3xl font-black flex items-center justify-center gap-4 hover:scale-105 active:scale-95 transition-all shadow-2xl">
              <svg className="w-6 h-6 group-hover:rotate-12 transition-transform" viewBox="0 0 24 24" fill="currentColor"><path d="M12.545,10.239v3.821h5.445c-0.712,2.315-2.647,3.972-5.445,3.972c-3.332,0-6.033-2.701-6.033-6.032s2.701-6.032,6.033-6.032c1.498,0,2.866,0.549,3.921,1.453l2.814-2.814C17.503,2.988,15.139,2,12.545,2C7.021,2,2.543,6.477,2.543,12s4.478,10,10.002,10c8.396,0,10.249-7.85,9.426-11.748L12.545,10.239z"/></svg>
              Google Auth Radar
            </button>
            <div className="flex items-center gap-4"><div className="h-px bg-zinc-800 flex-1"/><span className="text-[10px] font-black text-zinc-700 tracking-[0.4em] uppercase">Security Gate</span><div className="h-px bg-zinc-800 flex-1"/></div>
            <button onClick={() => setShowLocalLogin(true)} className="bg-zinc-900 border border-zinc-800 text-zinc-400 py-5 rounded-3xl font-bold hover:bg-zinc-800 hover:text-white transition-all">Launch Local Radar Profile</button>
          </div>

          {showLocalLogin && (
            <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[100] flex items-center justify-center p-6 animate-in fade-in">
              <form onSubmit={handleLocalLogin} className="bg-zinc-950 border border-zinc-800 p-12 rounded-[3rem] w-full max-md shadow-2xl">
                <h3 className="text-3xl font-black mb-2">Identify Radar</h3>
                <p className="text-zinc-600 mb-8 text-sm">Create a unique identity. Data will be encrypted locally in this session.</p>
                <input autoFocus type="text" value={localNameInput} onChange={e => setLocalNameInput(e.target.value)} placeholder="Enter Alias..." className="w-full bg-zinc-900 border border-zinc-800 p-5 rounded-2xl mb-8 text-white text-xl font-bold focus:outline-none focus:border-blue-600 transition-colors" />
                <div className="flex gap-4">
                  <button type="button" onClick={() => setShowLocalLogin(false)} className="flex-1 py-4 text-zinc-600 font-bold hover:text-white transition-colors">Abort</button>
                  <button type="submit" className="flex-[2] bg-blue-600 py-4 rounded-2xl font-black text-lg shadow-[0_0_20px_rgba(37,99,235,0.3)]">Confirm Alias</button>
                </div>
              </form>
            </div>
          )}
        </div>
      ) : (
        <StealthUI isVisible={isStealth} onToggle={() => setIsStealth(!isStealth)}>
          <div className="max-w-6xl mx-auto w-full flex flex-col h-full animate-in fade-in">
            {/* HUD Dashboard */}
            <div className="py-12 flex items-center justify-between px-8">
              <div>
                <h2 className="text-5xl font-black tracking-tighter">Command Center</h2>
                <div className="flex items-center gap-3 mt-2 text-zinc-500 text-xs font-bold uppercase tracking-widest">
                  Active Profile: <span className="text-blue-400">{user.name}</span>
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="relative">
                  <button onClick={() => setIsModeDropdownOpen(!isModeDropdownOpen)} className="px-6 py-3 rounded-2xl bg-zinc-900/60 border border-zinc-800 text-sm font-black flex items-center gap-3 hover:border-blue-900 transition-all">
                    <span className="text-zinc-600 text-[10px] tracking-widest">MODE:</span>
                    <span className="text-white">{currentMode.name}</span>
                    <svg className={`w-4 h-4 transition-transform ${isModeDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" /></svg>
                  </button>
                  {isModeDropdownOpen && (
                    <div className="absolute top-full left-0 mt-3 w-72 bg-zinc-950 border border-zinc-800 rounded-[2rem] shadow-2xl overflow-hidden z-50 py-2 animate-in fade-in">
                      {modes.map(m => (
                        <button key={m.id} onClick={() => { setCurrentModeId(m.id); setIsModeDropdownOpen(false); }} className="w-full text-left px-6 py-3 hover:bg-zinc-900 text-sm font-bold flex items-center justify-between group">
                          <span className={currentModeId === m.id ? 'text-blue-500' : 'text-zinc-400 group-hover:text-white'}>{m.name}</span>
                          {currentModeId === m.id && <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_#3b82f6]" />}
                        </button>
                      ))}
                      <div className="border-t border-zinc-900 mt-2">
                        <button onClick={() => { setIsManageModesOpen(true); setIsModeDropdownOpen(false); }} className="w-full text-left px-6 py-4 hover:bg-blue-600/10 text-blue-500 text-[10px] font-black uppercase tracking-[0.2em]">Manage All Modes</button>
                      </div>
                    </div>
                  )}
                </div>

                <button onClick={status === AppStatus.IDLE ? startMonitoring : stopAll} className={`px-10 py-4 rounded-2xl font-black text-sm transition-all shadow-2xl active:scale-95 ${status === AppStatus.IDLE ? 'bg-blue-600 hover:bg-blue-500 shadow-[0_0_30px_rgba(37,99,235,0.3)]' : 'bg-red-950/30 text-red-500 border border-red-900/40'}`}>
                  {status === AppStatus.IDLE ? 'START RADAR' : 'TERMINATE SESSION'}
                </button>
                <button onClick={() => setIsStealth(true)} className="p-4 bg-zinc-900 rounded-2xl hover:bg-zinc-800 transition-colors group" title="Enter Stealth Mode">
                   <svg className="w-6 h-6 text-zinc-600 group-hover:text-blue-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                </button>
              </div>
            </div>

            {/* Content Feed */}
            <div className="flex-1 overflow-y-auto px-8 pb-32 scrollbar-hide">
              {Object.keys(grouped).length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center opacity-20 py-20">
                  <div className="w-20 h-20 rounded-full border-4 border-dashed border-zinc-800 flex items-center justify-center mb-6">
                    <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  </div>
                  <p className="font-black text-2xl tracking-tighter">Radar System Idle. Awaiting Telemetry.</p>
                </div>
              ) : (
                (Object.entries(grouped) as [string, Insight[]][]).map(([date, items]) => (
                  <div key={date} className="mb-16">
                    <h3 className="text-[10px] font-black uppercase tracking-[0.5em] text-zinc-600 mb-8 border-l-2 border-zinc-900 pl-6">{date}</h3>
                    <div className="grid grid-cols-1 gap-4">
                      {items.map(item => (
                        <div key={item.id} className="p-8 bg-zinc-900/30 border border-zinc-900 hover:border-zinc-700 rounded-[2.5rem] transition-all group flex items-start justify-between shadow-none hover:shadow-2xl">
                          <div className="flex-1 pr-16">
                            <h4 className="font-black text-xl mb-3 group-hover:text-blue-400 transition-colors leading-tight">{item.question}</h4>
                            <p className="text-zinc-500 text-lg leading-relaxed font-medium">{item.answer}</p>
                          </div>
                          <div className="flex flex-col items-end gap-3 shrink-0">
                            <span className="text-[10px] font-mono text-zinc-700 font-bold uppercase tracking-widest">{new Date(item.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                            <div className={`px-4 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${item.type === 'screen' ? 'bg-zinc-800 text-zinc-500' : 'bg-blue-900/40 text-blue-500'}`}>{item.type}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Manual Text Input Bar */}
            {status === AppStatus.MONITORING && (
              <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-full max-w-4xl px-8 z-[100] animate-in slide-in-from-bottom">
                <form onSubmit={handleSendTypedQuestion} className="relative group">
                  <input 
                    type="text" 
                    value={typedQuestion} 
                    onChange={e => setTypedQuestion(e.target.value)} 
                    placeholder="Type a manual question (AI uses last 1-3 sentences as context)..."
                    className="w-full bg-zinc-950/80 backdrop-blur-3xl border border-zinc-800 p-6 pr-24 rounded-[2rem] text-lg font-bold shadow-2xl focus:outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 transition-all placeholder:text-zinc-600"
                  />
                  <button 
                    type="submit" 
                    disabled={isQuerying || !typedQuestion.trim()}
                    className={`absolute right-3 top-1/2 -translate-y-1/2 px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all ${isQuerying || !typedQuestion.trim() ? 'bg-zinc-900 text-zinc-700' : 'bg-blue-600 text-white shadow-[0_0_20px_rgba(37,99,235,0.4)] hover:scale-105 active:scale-95'}`}
                  >
                    {isQuerying ? 'Querying...' : 'Send'}
                  </button>
                </form>
              </div>
            )}
          </div>
        </StealthUI>
      )}

      {/* Stealth HUD Overlay - Real-time Voice Answer & Screen Answer */}
      {isStealth && (latestAnswer || userInputBuffer || aiOutputBuffer) && (
        <div className="fixed top-24 right-12 z-[200] max-w-sm pointer-events-none animate-in fade-in slide-in-from-right-4 duration-500">
          <div className="bg-black/80 backdrop-blur-3xl border border-white/5 p-8 rounded-[3rem] shadow-2xl relative overflow-hidden group">
             <div className="absolute top-0 left-0 w-1 h-full bg-blue-600" />
             
             {userInputBuffer && (
               <div className="mb-4 opacity-60">
                 <div className="flex items-center gap-2 mb-1">
                   <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                   <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Captured:</span>
                 </div>
                 <p className="text-xs italic text-zinc-300">"{userInputBuffer}"</p>
               </div>
             )}

             <div className="flex items-center gap-3 mb-4">
               <div className="w-2 h-2 rounded-full bg-blue-500 animate-ping shadow-[0_0_10px_#3b82f6]" />
               <span className="text-[10px] font-black uppercase tracking-[0.4em] text-blue-500">Live Intel Feed</span>
             </div>
             
             <p className="text-base font-bold text-white/95 leading-relaxed">
               {aiOutputBuffer || (latestAnswer?.answer)}
             </p>
          </div>
        </div>
      )}

      {/* Mode Hub Modal */}
      {isManageModesOpen && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-xl z-[300] flex items-center justify-center p-8 animate-in fade-in">
           <div className="w-full max-w-6xl h-[85vh] bg-zinc-950 border border-zinc-900 rounded-[3.5rem] shadow-2xl flex overflow-hidden animate-in scale-95 duration-300">
             {/* Sidebar List */}
             <div className="w-80 border-r border-zinc-900 flex flex-col p-10 bg-zinc-950/50">
               <div className="flex items-center justify-between mb-10">
                 <h2 className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-600">Mode Hub</h2>
                 <button onClick={handleCreateMode} className="p-2 bg-blue-600 rounded-xl hover:bg-blue-500 transition-colors shadow-lg">
                   <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" /></svg>
                 </button>
               </div>
               <div className="flex-1 overflow-y-auto space-y-3 pr-2 scrollbar-hide">
                 {modes.map(m => (
                   <button key={m.id} onClick={() => setEditingModeId(m.id)} className={`w-full text-left p-5 rounded-3xl transition-all border-2 ${editingModeId === m.id ? 'bg-blue-600/10 border-blue-600 text-white' : 'bg-transparent border-transparent text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300'}`}>
                     <div className="font-black text-sm truncate">{m.name}</div>
                     <div className="text-[10px] font-mono uppercase opacity-40 mt-1 truncate">{m.instruction.slice(0, 40)}...</div>
                   </button>
                 ))}
               </div>
             </div>
             
             <div className="flex-1 p-16 overflow-y-auto bg-black flex flex-col">
                {editingMode ? (
                  <div className="max-w-3xl flex flex-col h-full">
                    <div className="flex justify-between items-start mb-16">
                      <h3 className="text-5xl font-black tracking-tighter">Mode Parameters</h3>
                      <button onClick={() => handleDeleteMode(editingMode.id)} className="px-6 py-2 rounded-2xl bg-red-950/20 text-red-500 text-[10px] font-black uppercase tracking-widest border border-red-900/30 hover:bg-red-900 transition-colors">Terminate Mode</button>
                    </div>

                    <div className="space-y-12 flex-1">
                      <div>
                        <label className="block text-[10px] font-black uppercase text-zinc-700 mb-4 tracking-widest">Alias</label>
                        <input type="text" value={editingMode.name} onChange={e => updateMode(editingMode.id, { name: e.target.value })} className="w-full bg-zinc-950 border border-zinc-900 p-6 rounded-[1.5rem] text-xl font-bold focus:border-blue-600 transition-all outline-none" />
                      </div>
                      
                      <div>
                        <label className="block text-[10px] font-black uppercase text-zinc-700 mb-4 tracking-widest">Intelligence Directive</label>
                        <textarea value={editingMode.instruction} onChange={e => updateMode(editingMode.id, { instruction: e.target.value })} className="w-full h-48 bg-zinc-950 border border-zinc-900 p-8 rounded-[1.5rem] text-lg font-medium resize-none focus:border-blue-600 transition-all outline-none leading-relaxed text-zinc-300" placeholder="Define behavior..." />
                      </div>

                      <div>
                        <label className="block text-[10px] font-black uppercase text-zinc-700 mb-4 tracking-widest">Grounding Knowledge Base</label>
                        <div className="relative group">
                          <div className="flex items-center gap-6 p-10 bg-zinc-950 border-2 border-dashed border-zinc-900 rounded-[2.5rem] group-hover:border-blue-600 transition-all">
                            <div className="w-16 h-16 rounded-2xl bg-zinc-900 flex items-center justify-center text-zinc-600 group-hover:bg-blue-600 group-hover:text-white transition-all">
                              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            </div>
                            <div className="flex-1">
                              <p className="text-xl font-black text-zinc-200">{editingMode.fileName || "Universal Document Ingestion"}</p>
                              <p className="text-sm text-zinc-600">Supports .doc, .docx, .pdf, .txt, .md. Ground AI answers in technical docs.</p>
                            </div>
                            <input 
                              type="file" 
                              onChange={e => handleFileUpload(e, editingMode.id)} 
                              accept=".doc,.docx,.pdf,.txt,.md,.json,.csv" 
                              className="absolute inset-0 opacity-0 cursor-pointer" 
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pt-16 flex justify-end">
                       <button onClick={() => setIsManageModesOpen(false)} className="bg-white text-black px-12 py-5 rounded-3xl font-black text-lg hover:scale-105 active:scale-95 transition-all shadow-2xl">COMMIT CHANGES</button>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-zinc-900">
                    <p className="text-3xl font-black tracking-tighter uppercase opacity-30">Select mode for configuration</p>
                  </div>
                )}
             </div>
             
             <button onClick={() => setIsManageModesOpen(false)} className="absolute top-12 right-12 text-zinc-700 hover:text-white transition-all hover:rotate-90 duration-300">
               <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
             </button>
           </div>
        </div>
      )}

      {(userInputBuffer || aiOutputBuffer) && !isStealth && (
        <div className="fixed bottom-32 right-12 z-[250] bg-zinc-950/90 backdrop-blur-2xl px-10 py-6 rounded-[2.5rem] border border-zinc-800 shadow-2xl max-w-md animate-in slide-in-from-bottom duration-500 border-l-4 border-l-blue-600">
          <p className="text-[10px] font-black text-blue-500 uppercase tracking-[0.4em] mb-3">Live Radar Transcript</p>
          <div className="space-y-2">
            {userInputBuffer && <p className="text-xs font-bold text-zinc-500 italic truncate">"{userInputBuffer}"</p>}
            <p className="text-lg font-bold text-zinc-100 leading-snug">{aiOutputBuffer || '...'}</p>
          </div>
        </div>
      )}

      <style>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slide-in-from-right { from { transform: translateX(2rem); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes slide-in-from-bottom { from { transform: translateY(2rem); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes scale-in { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .animate-in { animation: fade-in 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
        .slide-in-from-right-4 { animation: slide-in-from-right 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
        .slide-in-from-bottom { animation: slide-in-from-bottom 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
        .scale-95 { animation: scale-in 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
      `}</style>
    </div>
  );
};

export default App;
