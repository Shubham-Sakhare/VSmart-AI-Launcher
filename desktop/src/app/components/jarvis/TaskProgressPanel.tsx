// ═══════════════════════════════════════════════════════════════════════════
// JARVIS/IRIS - Task Progress Panel
//
// Real-time view of the active task and its steps.
// Shows: current task, each step with status icon, running tool, cancel button.
// ═══════════════════════════════════════════════════════════════════════════

import { CheckCircle, XCircle, Loader, Clock, SkipForward, AlertTriangle, X } from "lucide-react";
import { useTaskStore, type Task, type StepStatus } from "../../../store/taskStore";
import "./TaskProgressPanel.css";

const STEP_ICONS: Record<StepStatus, React.ReactNode> = {
  pending:              <Clock          size={13} className="step-icon pending"    />,
  running:              <Loader         size={13} className="step-icon running"    />,
  completed:            <CheckCircle    size={13} className="step-icon completed"  />,
  failed:               <XCircle        size={13} className="step-icon failed"     />,
  skipped:              <SkipForward    size={13} className="step-icon skipped"    />,
  waiting_confirmation: <AlertTriangle  size={13} className="step-icon confirm"    />,
};

interface TaskProgressPanelProps {
  compact?: boolean;
}

export default function TaskProgressPanel({ compact = false }: TaskProgressPanelProps) {
  const { tasks, activeTaskId, historyTasks, cancelTask } = useTaskStore();
  const activeTask = tasks.find(t => t.id === activeTaskId);

  const completedSteps = activeTask?.steps.filter(s => s.status === "completed").length ?? 0;
  const totalSteps     = activeTask?.steps.length ?? 0;
  const progress       = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  // Nothing to show
  if (!activeTask && historyTasks.length === 0) {
    return (
      <div className="task-panel-empty">
        <Clock size={20} />
        <p>No tasks yet</p>
      </div>
    );
  }

  return (
    <div className={`task-panel ${compact ? "compact" : ""}`}>

      {/* ── Active task ────────────────────────────────────────────────── */}
      {activeTask && (
        <div className={`task-card task-${activeTask.status}`}>
          <div className="task-card-header">
            <div className="task-title-row">
              <span className={`task-status-dot dot-${activeTask.status}`} />
              <span className="task-title">{activeTask.title}</span>
            </div>

            {(activeTask.status === "running" || activeTask.status === "queued") && (
              <button
                className="task-cancel-btn"
                onClick={() => cancelTask(activeTask.id)}
                title="Cancel task"
                aria-label="Cancel task"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Progress bar */}
          {totalSteps > 0 && (
            <div className="task-progress-bar-wrap">
              <div className="task-progress-bar" style={{ width: `${progress}%` }} />
              <span className="task-progress-text">{completedSteps}/{totalSteps}</span>
            </div>
          )}

          {/* Step list */}
          {!compact && (
            <ol className="step-list">
              {activeTask.steps.map((step, i) => (
                <li
                  key={step.id}
                  className={`step-item step-${step.status} ${activeTask.currentStepIdx === i && step.status === "running" ? "step-current" : ""}`}
                >
                  <span className="step-num">{i + 1}</span>
                  {STEP_ICONS[step.status]}
                  <span className="step-desc">{step.description}</span>
                  {step.tool && <span className="step-tool">via {step.tool}</span>}
                  {step.result && step.status === "completed" && (
                    <span className="step-result" title={step.result}>
                      {step.result.slice(0, 60)}{step.result.length > 60 ? "…" : ""}
                    </span>
                  )}
                  {step.error && (
                    <span className="step-error" title={step.error}>
                      {step.error.slice(0, 60)}{step.error.length > 60 ? "…" : ""}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}

          {/* Final result */}
          {activeTask.result && activeTask.status === "completed" && (
            <div className="task-result">✓ {activeTask.result.slice(0, 120)}</div>
          )}
          {activeTask.error && (
            <div className="task-error">✕ {activeTask.error.slice(0, 120)}</div>
          )}
        </div>
      )}

      {/* ── History (last 5) ────────────────────────────────────────────── */}
      {!compact && historyTasks.length > 0 && (
        <div className="task-history">
          <p className="task-history-label">Recent</p>
          {historyTasks.slice(0, 5).map(t => (
            <div key={t.id} className={`task-history-item hist-${t.status}`}>
              <span className={`task-status-dot dot-${t.status}`} />
              <span className="hist-title">{t.title}</span>
              <span className="hist-time">{relTime(t.completedAt ?? t.updatedAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function relTime(ts: number | undefined): string {
  if (!ts) return "";
  const diff = Math.round((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  return `${Math.round(diff / 3600)}h ago`;
}
