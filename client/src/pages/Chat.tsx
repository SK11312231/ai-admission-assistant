import ChatWindow from '../components/ChatWindow';

export default function Chat() {
  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Page header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-lg font-semibold text-gray-900">AI Admission Counselor</h1>
          <p className="text-sm text-gray-500">
            Ask me about universities, programs, requirements, or anything admission-related.
          </p>
        </div>
      </div>

      {/* Chat window takes remaining height */}
      <div className="flex-1 overflow-hidden max-w-3xl w-full mx-auto flex flex-col">
        <ChatWindow />
      </div>
    </div>
  );
}
