export default function ReportLoading() {
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0 bg-slate-50 animate-pulse">
      <div className="h-14 flex-shrink-0 border-b border-slate-200 bg-white" />
      <div className="flex-1 p-6 space-y-4">
        <div className="h-10 w-64 rounded-xl bg-slate-200/80" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-24 rounded-2xl bg-slate-200/60" />
          ))}
        </div>
        <div className="flex-1 min-h-[320px] rounded-2xl bg-slate-200/60" />
      </div>
    </div>
  );
}
