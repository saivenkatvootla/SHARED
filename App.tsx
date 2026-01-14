
import React, { useState, useEffect, useRef } from 'react';
import { AppStatus, Insight, JobMode, UserProfile } from './types';
import { StealthUI } from './components/StealthUI';
import { analyzeScreenContent, getGeminiClient, decodeAudio, decodeAudioData, processTypedQuestion, encodeAudio } from './services/geminiService';
import { LiveServerMessage, Modality } from '@google/genai';

// Mammoth for .docx parsing
declare const mammoth: any;

const DEFAULT_MODES: JobMode[] = [
  { 
    id: '1', 
    name: 'Technical Interview', 
    guidelines: 'Act as a professional assistant. Respond strictly in English. Extract keywords from speech/screen. Be extremely fast. If asked for an introduction, provide exactly 3 well-structured paragraphs. For technical questions, provide concise, high-impact bullet points. Follow the provided RAG context strictly.',
    fileContent: 'General Technical Core: Saga, Microservices, Spring Boot, Java 21, Microservices Modernization.'
  }
];

const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [isStealth, setIsStealth] = useState(false);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [policyMemory, setPolicyMemory] = useState<string[]>([]);
  const [typedQuestion, setTypedQuestion] = useState<string>('');
  const [isQuerying, setIsQuerying] = useState<boolean>(false);
  const [history, setHistory] = useState<string[]>([]);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [modes, setModes] = useState<JobMode[]>(DEFAULT_MODES);
  const [currentModeId, setCurrentModeId] = useState<string>(DEFAULT_MODES[0].id);
  const [isPolicyStoreOpen, setIsPolicyStoreOpen] = useState(false);
  const [isModesOpen, setIsModesOpen] = useState(false);
  const [editingMode, setEditingMode] = useState<JobMode | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const currentMode = modes.find(m => m.id === currentModeId) || modes[0];
  const screenStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureIntervalRef = useRef<number | null>(null);
  
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const liveTranscriptionRef = useRef<string>('');

  useEffect(() => {
    const storedUser = localStorage.getItem('omnisense_user');
    if (storedUser) {
      try {
        const parsed = JSON.parse(storedUser);
        setUser(parsed);
        const storedData = localStorage.getItem(`omnisense_v6_${parsed.email}`);
        if (storedData) {
          const { insights: si, policy: sp, modes: sm, lastModeId } = JSON.parse(storedData);
          if (si) setInsights(si);
          if (sp) setPolicyMemory(sp);
          if (sm) setModes(sm);
          if (lastModeId) setCurrentModeId(lastModeId);
        }
      } catch (e) { console.error(e); }
    }
    videoRef.current = document.createElement('video');
    canvasRef.current = document.createElement('canvas');
  }, []);

  useEffect(() => {
    if (user) {
      const data = { insights, policy: policyMemory, modes, lastModeId: currentModeId };
      localStorage.setItem(`omnisense_v6_${user.email}`, JSON.stringify(data));
    }
  }, [insights, policyMemory, modes, user, currentModeId]);

  const handleInitialize = () => {
    const newUser = { name: 'Expert User', email: 'expert@omnisense.ai', picture: '' };
    localStorage.setItem('omnisense_user', JSON.stringify(newUser));
    setUser(newUser);
  };

  const startMonitoring = async () => {
    if (!user) return;
    setErrorMessage(null);
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screenStreamRef.current = screenStream;
      if (videoRef.current) {
        videoRef.current.srcObject = screenStream;
        videoRef.current.play();
      }
      
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = micStream;

      await startVoiceSession(micStream);
      
      captureIntervalRef.current = window.setInterval(captureAndAnalyze, 8000);
      setStatus(AppStatus.MONITORING);
    } catch (err: any) { 
      console.error(err);
      setStatus(AppStatus.ERROR);
      setErrorMessage(err.message.includes('permissions policy') ? "Screen capture disallowed by policy." : err.message);
    }
  };

  const stopMonitoring = () => {
    if (captureIntervalRef.current) clearInterval(captureIntervalRef.current);
    if (screenStreamRef.current) screenStreamRef.current.getTracks().forEach(t => t.stop());
    if (micStreamRef.current) micStreamRef.current.getTracks().forEach(t => t.stop());
    if (sessionPromiseRef.current) {
      sessionPromiseRef.current.then(session => session.close());
    }
    setStatus(AppStatus.IDLE);
    setErrorMessage(null);
  };

  const captureAndAnalyze = async () => {
    if (!videoRef.current || !canvasRef.current || !screenStreamRef.current?.active) return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const base64 = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
    
    const result = await analyzeScreenContent(base64, currentMode.guidelines, currentMode.fileContent || '', policyMemory);
    if (result && result.question) {
      setInsights(prev => [{
        id: Math.random().toString(36).substr(2, 9),
        type: 'screen',
        timestamp: Date.now(),
        ...result
      }, ...prev].slice(0, 50));
    }
  };

  const createAudioBlob = (data: Float32Array) => {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
      int16[i] = data[i] * 32768;
    }
    return {
      data: encodeAudio(new Uint8Array(int16.buffer)),
      mimeType: 'audio/pcm;rate=16000',
    };
  };

  const startVoiceSession = async (stream: MediaStream) => {
    const ai = getGeminiClient();
    inputAudioContextRef.current = new AudioContext({ sampleRate: 16000 });
    outputAudioContextRef.current = new AudioContext({ sampleRate: 24000 });
    
    const systemInstruction = `
      STRICTLY ENGLISH. FAST TRANSCRIBER & TECHNICAL AGENT.
      - EXTRACT KEYWORDS from speech.
      - YOU MUST TRANSCRIBE EVERYTHING SPOKEN.
      - RESPOND concisly only when requested.
      - RAG DATA: ${currentMode.fileContent?.slice(0, 5000)}
    `;

    const sessionPromise = ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction,
        inputAudioTranscription: {}, // ENABLE TRANSCRIPTION
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
      },
      callbacks: {
        onopen: () => {
          const source = inputAudioContextRef.current!.createMediaStreamSource(stream);
          const scriptProcessor = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);
          scriptProcessor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            const pcmBlob = createAudioBlob(inputData);
            sessionPromiseRef.current?.then(session => {
              session.sendRealtimeInput({ media: pcmBlob });
            });
          };
          source.connect(scriptProcessor);
          scriptProcessor.connect(inputAudioContextRef.current!.destination);
        },
        onmessage: async (message: LiveServerMessage) => {
          // Handle Input Transcription (User Speech)
          if (message.serverContent?.inputTranscription) {
            const text = message.serverContent.inputTranscription.text;
            liveTranscriptionRef.current += ' ' + text;
            setTypedQuestion(liveTranscriptionRef.current.trim());
          }
          
          if (message.serverContent?.turnComplete) {
            liveTranscriptionRef.current = '';
          }

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
          }
        }
      }
    });
    sessionPromiseRef.current = sessionPromise;
  };

  const handleSendTypedQuestion = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!typedQuestion.trim() || isQuerying) return;

    setIsQuerying(true);
    try {
      const result = await processTypedQuestion(
        typedQuestion,
        history,
        currentMode.guidelines,
        currentMode.fileContent || '',
        policyMemory
      );

      if (result) {
        setInsights(prev => [{
          id: Math.random().toString(36).substr(2, 9),
          type: 'voice',
          timestamp: Date.now(),
          question: typedQuestion,
          answer: result.answer,
          policyApplied: result.policyApplied
        }, ...prev].slice(0, 50));
        setHistory(prev => [...prev, `User: ${typedQuestion}`, `Assistant: ${result.answer}`].slice(-10));
      }
      setTypedQuestion('');
      liveTranscriptionRef.current = '';
    } catch (error) {
      console.error("Manual query error:", error);
    } finally {
      setIsQuerying(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editingMode) return;
    const reader = new FileReader();
    if (file.name.endsWith('.docx') || file.name.endsWith('.doc')) {
      reader.onload = async (event) => {
        try {
          const result = await mammoth.extractRawText({ arrayBuffer: event.target?.result });
          setEditingMode({ ...editingMode, fileContent: result.value, fileName: file.name });
        } catch (err) { alert("DOCX Error."); }
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = (event) => setEditingMode({ ...editingMode, fileContent: event.target?.result as string, fileName: file.name });
      reader.readAsText(file);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white font-sans flex flex-col overflow-hidden relative">
      {/* STEALTH HUD BOX - Always on top, semi-transparent 'Clear Box' */}
      {isStealth && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 w-full max-w-lg z-[100] pointer-events-none">
          <div className="bg-white/[0.03] backdrop-blur-[2px] border border-white/10 rounded-[2rem] p-6 shadow-2xl animate-in fade-in slide-in-from-top-4 duration-700">
             <div className="flex items-center gap-2 mb-4">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                <span className="text-[7px] font-black uppercase tracking-[0.3em] text-white/40">STEALTH FEED</span>
             </div>
             <div className="max-h-[300px] overflow-y-auto space-y-4 scrollbar-hide pointer-events-auto">
                {insights.slice(0, 3).map(ins => (
                  <div key={ins.id} className="border-l border-indigo-500/30 pl-4 py-1">
                    <p className="text-[11px] font-bold text-white/90 leading-tight mb-1">{ins.question}</p>
                    <p className="text-[10px] text-white/60 leading-relaxed line-clamp-3">{ins.answer}</p>
                  </div>
                ))}
             </div>
          </div>
        </div>
      )}

      <header className="h-20 border-b border-white/5 flex items-center justify-between px-10 bg-black/95 backdrop-blur-xl z-[60] relative">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tighter italic uppercase">OmniSense <span className="text-indigo-500">Fast</span></h1>
            <p className="text-[8px] text-zinc-500 font-black uppercase tracking-[0.2em]">{currentMode.name} Active</p>
          </div>
        </div>

        {user && (
          <div className="flex items-center gap-6">
            <button onClick={() => setIsModesOpen(true)} className="px-5 py-2.5 bg-zinc-900 border border-white/5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-zinc-800 transition-all active:scale-95">
              RAG SETUP
            </button>
            <div className="h-8 w-px bg-white/10" />
            <button onClick={() => setIsStealth(!isStealth)} className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${isStealth ? 'bg-indigo-600 shadow-xl' : 'bg-zinc-800 text-zinc-400'}`}>
              HUD {isStealth ? 'ON' : 'OFF'}
            </button>
          </div>
        )}
      </header>

      {!user ? (
        <div className="flex-1 flex flex-col items-center justify-center p-12 text-center bg-zinc-950">
           <div className="w-24 h-24 rounded-3xl bg-indigo-600 flex items-center justify-center mb-10 rotate-3 shadow-2xl animate-pulse">
             <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
           </div>
           <h2 className="text-6xl font-black mb-4 tracking-tighter">Stealth RAG Access.</h2>
           <p className="text-zinc-500 mb-12 max-w-sm font-medium">Voice transcription buffers instantly. Hit Enter to process technical answers from your RAG context.</p>
           <button onClick={handleInitialize} className="bg-white text-black px-16 py-5 rounded-2xl font-black text-xl shadow-2xl hover:scale-105 active:scale-95 transition-all">INITIALIZE HUB</button>
        </div>
      ) : (
        <StealthUI isVisible={isStealth} onToggle={() => setIsStealth(!isStealth)}>
          <div className="flex-1 flex flex-col h-full relative overflow-hidden max-w-5xl mx-auto w-full">
            {errorMessage && (
              <div className="mx-6 mt-6 bg-red-950/40 border border-red-500/30 p-4 rounded-2xl flex items-center gap-3">
                <p className="text-red-200 text-xs font-bold">{errorMessage}</p>
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-6 py-12 space-y-6 scrollbar-hide pb-48">
              {insights.map(ins => (
                <div key={ins.id} className="group relative bg-zinc-900/60 border border-white/5 p-8 rounded-[2.5rem] hover:border-indigo-500/30 transition-all shadow-xl backdrop-blur-md">
                  <h3 className="text-xl font-black mb-3 text-white tracking-tight">{ins.question}</h3>
                  <div className="text-zinc-400 text-base leading-relaxed whitespace-pre-wrap">{ins.answer}</div>
                  <div className="mt-6 pt-4 border-t border-white/5 flex justify-between items-center text-[8px] font-black text-zinc-600 uppercase tracking-widest">
                    <span>{ins.type} EXTRACTED</span>
                    <button onClick={() => setInsights(insights.filter(i => i.id !== ins.id))} className="hover:text-white transition-colors">Dismiss</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="absolute bottom-10 left-0 w-full px-6 z-[100]">
              <div className="bg-zinc-950/80 backdrop-blur-2xl border border-white/10 rounded-[3rem] p-4 flex gap-4 shadow-2xl items-center">
                <button 
                  onClick={status === AppStatus.IDLE ? startMonitoring : stopMonitoring}
                  className={`w-16 h-16 rounded-[2rem] flex items-center justify-center shrink-0 transition-all ${status === AppStatus.MONITORING ? 'bg-red-600' : 'bg-indigo-600 hover:scale-105 active:scale-95 shadow-indigo-900/40 shadow-lg'}`}
                >
                  <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d={status === AppStatus.MONITORING ? "M6 18L18 6M6 6l12 12" : "M13 10V3L4 14h7v7l9-11h-7z"} /></svg>
                </button>
                <form onSubmit={handleSendTypedQuestion} className="flex-1 relative">
                  <input 
                    type="text" 
                    value={typedQuestion}
                    onChange={e => setTypedQuestion(e.target.value)}
                    placeholder={status === AppStatus.MONITORING ? "Speak to transcribe... Press Enter to Answer." : "Type your technical query..."}
                    className="w-full h-16 bg-transparent px-4 font-bold text-lg focus:outline-none placeholder:text-zinc-800 text-white"
                  />
                  <button type="submit" disabled={isQuerying} className="absolute right-2 top-1/2 -translate-y-1/2 px-6 h-10 bg-indigo-600 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-indigo-900/20 active:scale-95 transition-all">
                    {isQuerying ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Enter'}
                  </button>
                </form>
              </div>
            </div>
          </div>
        </StealthUI>
      )}

      {isModesOpen && (
        <div className="fixed inset-0 bg-black/98 backdrop-blur-2xl z-[200] flex items-center justify-center p-8 animate-in fade-in duration-300">
           <div className="w-full max-w-4xl h-[85vh] bg-zinc-950 border border-white/10 rounded-[4rem] shadow-2xl flex overflow-hidden">
              <div className="w-1/3 border-r border-white/5 p-10 bg-zinc-900/20">
                 <h3 className="text-xl font-black italic mb-8 uppercase tracking-tighter">Profiles</h3>
                 <div className="space-y-3">
                    {modes.map(m => (
                       <div key={m.id} onClick={() => { setEditingMode(m); setCurrentModeId(m.id); }} className={`p-6 rounded-3xl cursor-pointer transition-all border ${currentModeId === m.id ? 'bg-indigo-600/20 border-indigo-500' : 'bg-zinc-900/50 border-transparent hover:bg-zinc-800'}`}>
                          <h4 className="font-black text-sm uppercase">{m.name}</h4>
                          {m.fileName && <p className="text-[7px] text-indigo-400 font-black uppercase mt-2 truncate">📄 {m.fileName}</p>}
                       </div>
                    ))}
                 </div>
              </div>

              <div className="flex-1 p-16 relative bg-zinc-950">
                 {editingMode ? (
                   <div className="space-y-10">
                      <div>
                        <label className="text-[8px] font-black uppercase text-zinc-600 mb-4 block">Profile Name</label>
                        <input type="text" value={editingMode.name} onChange={e => setEditingMode({...editingMode, name: e.target.value})} className="w-full bg-transparent border-b-2 border-zinc-900 text-3xl font-black focus:outline-none focus:border-indigo-500 pb-2" />
                      </div>
                      <div>
                        <label className="text-[8px] font-black uppercase text-zinc-600 mb-4 block">RAG Source (.docx, .doc, .txt)</label>
                        <label className="cursor-pointer bg-zinc-900/50 border-2 border-dashed border-zinc-800 rounded-3xl p-8 flex flex-col items-center hover:bg-zinc-800 transition-all">
                           <input type="file" className="hidden" onChange={handleFileUpload} accept=".txt,.docx,.doc" />
                           <p className="font-black text-[9px] text-zinc-500 uppercase">{editingMode.fileName || "Upload Document"}</p>
                        </label>
                      </div>
                      <div className="flex justify-end pt-10">
                        <button onClick={() => { setModes(modes.map(m => m.id === editingMode.id ? editingMode : m)); setIsModesOpen(false); }} className="px-12 py-4 bg-indigo-600 rounded-2xl font-black text-xs uppercase shadow-xl">Sync RAG</button>
                      </div>
                   </div>
                 ) : <div className="h-full flex items-center justify-center text-zinc-800 font-black italic">Select a profile.</div>}
                 <button onClick={() => setIsModesOpen(false)} className="absolute top-10 right-10 text-zinc-700 hover:text-white transition-all"><svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg></button>
              </div>
           </div>
        </div>
      )}

      <style>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slide-in-top { from { transform: translateY(-1rem); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .animate-in { animation: fade-in 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
      `}</style>
    </div>
  );
};

export default App;
