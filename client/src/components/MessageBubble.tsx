import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useUiStore } from '../store/uiStore';
import ResultsTabs from './ResultsTabs';
import type { ChatMessage } from '../types/travel';

export default function MessageBubble({ message }: { message: ChatMessage }) {
  const openId = useUiStore((s) => s.openResultsMessageId);
  const openResults = useUiStore((s) => s.openResults);
  const closeResults = useUiStore((s) => s.closeResults);

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] animate-fade-in whitespace-pre-wrap rounded-2xl rounded-br-sm bg-wayfarer-600 px-4 py-2.5 text-sm text-white">
          {message.content}
        </div>
      </div>
    );
  }

  const isOpen = openId === message.id;
  return (
    <div className="flex justify-start">
      <div className="max-w-[88%] animate-fade-in">
        <div className="rounded-2xl rounded-bl-sm bg-white px-4 py-3 text-sm text-ink shadow-sm">
          <div className="markdown leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>
        </div>
        {message.results && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => (isOpen ? closeResults() : openResults(message.id))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-wayfarer-700 shadow-sm hover:border-wayfarer-500"
            >
              {isOpen ? 'Hide results' : 'View results'}
            </button>
            {isOpen && <ResultsTabs results={message.results} />}
          </div>
        )}
      </div>
    </div>
  );
}
