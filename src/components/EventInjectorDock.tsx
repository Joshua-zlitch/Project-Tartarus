import React, { useState } from 'react';
import { Send, Zap } from 'lucide-react';

interface EventInjectorDockProps {
  onInitializeZeus: () => void;
  onSubmitZeusTask: (prompt: string) => void;
}

export const EventInjectorDock: React.FC<EventInjectorDockProps> = ({
  onInitializeZeus,
  onSubmitZeusTask,
}) => {
  const [zeusPrompt, setZeusPrompt] = useState<string>('');

  const handlePromptSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = zeusPrompt.trim();
    if (!trimmed) return;
    onSubmitZeusTask(trimmed);
    setZeusPrompt('');
  };

  return (
    <aside
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className="w-80 bg-[#111827]/95 backdrop-blur-md border border-[#1E293B] rounded-xl p-4 text-slate-100 shadow-2xl select-text space-y-3.5"
    >
      {/* Initialize Zeus Button */}
      <button
        type="button"
        onClick={onInitializeZeus}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-sm"
      >
        <Zap className="w-4 h-4 fill-slate-950" />
        <span>Initialize Zeus</span>
      </button>

      {/* Controlled 'Prompt Zeus' Text Input & Submit Button */}
      <form onSubmit={handlePromptSubmit} className="space-y-1.5">
        <label
          htmlFor="prompt-zeus-input"
          className="block text-xs font-medium text-slate-300"
        >
          Prompt Zeus
        </label>
        <div className="flex items-center gap-1.5">
          <input
            id="prompt-zeus-input"
            type="text"
            value={zeusPrompt}
            onChange={(e) => setZeusPrompt(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Type a custom task..."
            autoComplete="off"
            className="w-full bg-[#0B0F17] border border-[#1E293B] focus:border-amber-500 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!zeusPrompt.trim()}
            className="px-3 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer disabled:cursor-not-allowed"
            title="Emit zeus_task WebSocket payload with your typed prompt"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Submit</span>
          </button>
        </div>
      </form>
    </aside>
  );
};
