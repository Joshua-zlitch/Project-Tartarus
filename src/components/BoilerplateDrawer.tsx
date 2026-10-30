import React, { useState } from 'react';
import {
  X,
  Copy,
  Check,
  Terminal,
  FileCode2,
  Cpu,
  Download,
} from 'lucide-react';
import {
  TERMINAL_COMMANDS,
  BOILERPLATE_FILES,
} from '../data/boilerplateData';

interface BoilerplateDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeSection: 'commands' | 'code' | 'architecture';
  onSectionChange: (section: 'commands' | 'code' | 'architecture') => void;
}

export const BoilerplateDrawer: React.FC<BoilerplateDrawerProps> = ({
  isOpen,
  onClose,
  activeSection,
  onSectionChange,
}) => {
  const [selectedFileId, setSelectedFileId] = useState<string>('app-jsx');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!isOpen) return null;

  const activeFile =
    BOILERPLATE_FILES.find((f) => f.id === selectedFileId) ||
    BOILERPLATE_FILES[0];

  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => {
        setCopiedId((prev) => (prev === id ? null : prev));
      }, 1800);
    } catch {
      // Fallback copy
    }
  };

  const handleDownloadFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs">
      <div className="relative w-full max-w-4xl h-full bg-[#0B0F17] border-l border-[#1E293B] flex flex-col shadow-2xl">
        {/* Drawer Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1E293B] bg-[#111827]">
          <div>
            <h2 className="text-lg font-semibold text-slate-100 font-display">
              Project Tartarus — Boilerplate & Desktop Build Guide
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              React + Vite + Tauri v2 (.exe) · Phaser.js Circular Arena · Python FastAPI + Uvicorn + PyInstaller Sidecar
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            aria-label="Close Boilerplate Drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Segmented Navigation */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-[#1E293B] bg-[#0B0F17]">
          <div className="flex items-center gap-1 p-1 bg-[#111827] border border-[#1E293B] rounded-lg">
            <button
              onClick={() => onSectionChange('commands')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeSection === 'commands'
                  ? 'bg-amber-500 text-slate-950 font-semibold'
                  : 'text-slate-300 hover:text-slate-100'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>01. Terminal Setup Commands</span>
            </button>
            <button
              onClick={() => onSectionChange('code')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeSection === 'code'
                  ? 'bg-amber-500 text-slate-950 font-semibold'
                  : 'text-slate-300 hover:text-slate-100'
              }`}
            >
              <FileCode2 className="w-3.5 h-3.5" />
              <span>02. Starting Source Code (main.jsx, App.jsx, main.py)</span>
            </button>
            <button
              onClick={() => onSectionChange('architecture')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeSection === 'architecture'
                  ? 'bg-amber-500 text-slate-950 font-semibold'
                  : 'text-slate-300 hover:text-slate-100'
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>03. PyInstaller & Tauri Sidecar Pipeline</span>
            </button>
          </div>
        </div>

        {/* Drawer Body Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeSection === 'commands' && (
            <div className="space-y-6">
              {TERMINAL_COMMANDS.map((section) => (
                <div
                  key={section.id}
                  className="bg-[#111827] border border-[#1E293B] rounded-xl p-5"
                >
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div>
                      <h3 className="text-base font-semibold text-slate-100 font-display">
                        <span className="text-amber-400 mr-2">
                          {section.stepNumber}
                        </span>
                        {section.title}
                      </h3>
                      <p className="text-xs text-slate-400 mt-1">
                        {section.subtitle}
                      </p>
                    </div>
                    <button
                      onClick={() => handleCopy(section.commands, section.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                    >
                      {copiedId === section.id ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy Commands</span>
                        </>
                      )}
                    </button>
                  </div>

                  <pre className="bg-[#0B0F17] border border-[#1E293B] rounded-lg p-4 text-xs font-mono text-slate-200 overflow-x-auto leading-relaxed">
                    <code>{section.commands}</code>
                  </pre>

                  <p className="text-xs text-slate-400 mt-3">{section.notes}</p>
                </div>
              ))}
            </div>
          )}

          {activeSection === 'code' && (
            <div className="space-y-4">
              {/* File Selector Tabs */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 p-1 bg-[#111827] border border-[#1E293B] rounded-lg">
                  {BOILERPLATE_FILES.map((file) => (
                    <button
                      key={file.id}
                      onClick={() => setSelectedFileId(file.id)}
                      className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        selectedFileId === file.id
                          ? 'bg-slate-800 text-amber-400 border border-amber-500/40 font-semibold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {file.filename}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      handleDownloadFile(
                        activeFile.filename.split(' ')[0],
                        activeFile.code
                      )
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#111827] hover:bg-slate-800 text-slate-300 border border-[#1E293B] rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download File</span>
                  </button>
                  <button
                    onClick={() => handleCopy(activeFile.code, activeFile.id)}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                  >
                    {copiedId === activeFile.id ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Copied to Clipboard</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy {activeFile.filename}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* File Metadata Header & Code View */}
              <div className="bg-[#111827] border border-[#1E293B] rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-[#1E293B] flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 text-slate-300">
                    <span className="font-mono text-amber-400">
                      {activeFile.filepath}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="text-slate-400">
                      {activeFile.description}
                    </span>
                  </div>
                </div>
                <pre className="p-4 text-xs font-mono text-slate-200 overflow-x-auto leading-relaxed bg-[#0B0F17]">
                  <code>{activeFile.code}</code>
                </pre>
              </div>
            </div>
          )}

          {activeSection === 'architecture' && (
            <div className="space-y-6">
              <div className="bg-[#111827] border border-[#1E293B] rounded-xl p-5 space-y-4">
                <h3 className="text-base font-semibold text-slate-100 font-display">
                  01. Why Tauri v2 Sidecar + PyInstaller Works Best for Project Tartarus
                </h3>
                <p className="text-sm text-slate-300 leading-relaxed">
                  Packaging a Python FastAPI + WebSockets backend alongside a native
                  desktop frontend requires two critical engineering safeguards so
                  the final Windows <code className="text-amber-400">.exe</code>{' '}
                  runs on machines without Python installed:
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <div className="bg-[#0B0F17] border border-[#1E293B] rounded-lg p-4">
                    <h4 className="text-xs font-semibold text-amber-400 mb-1.5">
                      Direct ASGI App Reference in main.py
                    </h4>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Calling <code className="text-slate-200">uvicorn.run(app, host="127.0.0.1", port=8000)</code>{' '}
                      with the <code className="text-slate-200">app</code> object
                      directly (instead of the string{' '}
                      <code className="text-slate-200">"main:app"</code>) along with{' '}
                      <code className="text-slate-200">multiprocessing.freeze_support()</code>{' '}
                      prevents PyInstaller <code className="text-slate-200">--onefile</code>{' '}
                      from failing on dynamic module imports or spawning infinite
                      subprocesses on Windows.
                    </p>
                  </div>
                  <div className="bg-[#0B0F17] border border-[#1E293B] rounded-lg p-4">
                    <h4 className="text-xs font-semibold text-emerald-400 mb-1.5">
                      React useRef Phaser Lifecycle Isolation
                    </h4>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Storing the <code className="text-slate-200">Phaser.Game</code>{' '}
                      instance in a React <code className="text-slate-200">useRef</code>{' '}
                      and routing incoming WebSocket JSON events directly to{' '}
                      <code className="text-slate-200">scene.handleServerEvent(payload)</code>{' '}
                      ensures 60 FPS WebGL rendering without React state re-renders
                      resetting the circular arena canvas.
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-[#111827] border border-[#1E293B] rounded-xl p-5">
                <h3 className="text-base font-semibold text-slate-100 font-display mb-3">
                  02. Target-Triple Naming Convention for Tauri v2 externalBin
                </h3>
                <p className="text-xs text-slate-400 mb-3">
                  When configuring <code className="text-slate-200">"externalBin": ["binaries/tartarus-backend"]</code>{' '}
                  in <code className="text-slate-200">src-tauri/tauri.conf.json</code>,
                  Tauri expects the PyInstaller binary inside{' '}
                  <code className="text-slate-200">src-tauri/binaries/</code> to
                  append your platform's Rust target triple:
                </p>
                <div className="bg-[#0B0F17] border border-[#1E293B] rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-[#1E293B] text-slate-400">
                      <tr>
                        <th className="py-2.5 px-4 font-medium">Operating System</th>
                        <th className="py-2.5 px-4 font-medium">Required Binary Filename in src-tauri/binaries/</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1E293B] font-mono text-slate-200">
                      <tr>
                        <td className="py-2.5 px-4 font-sans text-slate-300">Windows (64-bit x86_64)</td>
                        <td className="py-2.5 px-4 text-amber-400">tartarus-backend-x86_64-pc-windows-msvc.exe</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-4 font-sans text-slate-300">macOS (Apple Silicon)</td>
                        <td className="py-2.5 px-4">tartarus-backend-aarch64-apple-darwin</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-4 font-sans text-slate-300">Linux (64-bit gnu)</td>
                        <td className="py-2.5 px-4">tartarus-backend-x86_64-unknown-linux-gnu</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
