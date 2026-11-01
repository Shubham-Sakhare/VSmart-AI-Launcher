// ═══════════════════════════════════════════════════════════════════════════
// JARVIS/IRIS - Notification Stack
//
// Toast notifications in the corner of the screen.
// Supports: info, success, warning, error with auto-dismiss.
// ═══════════════════════════════════════════════════════════════════════════

import { X, Info, CheckCircle, AlertTriangle, AlertCircle } from "lucide-react";
import { useAppStore, type AppNotification } from "../../../store/appStore";
import "./NotificationStack.css";

const ICONS: Record<AppNotification["type"], React.ReactNode> = {
  info:    <Info         size={15} />,
  success: <CheckCircle  size={15} />,
  warning: <AlertTriangle size={15} />,
  error:   <AlertCircle  size={15} />,
};

export default function NotificationStack() {
  const { notifications, dismissNotification } = useAppStore();

  if (notifications.length === 0) return null;

  return (
    <div className="notif-stack" role="alert" aria-live="polite">
      {notifications.slice(0, 5).map(n => (
        <div key={n.id} className={`notif-item notif-${n.type}`}>
          <span className={`notif-icon icon-${n.type}`}>{ICONS[n.type]}</span>
          <div className="notif-body">
            <p className="notif-title">{n.title}</p>
            <p className="notif-msg">{n.message}</p>
          </div>
          <button
            className="notif-close"
            onClick={() => dismissNotification(n.id)}
            aria-label="Dismiss notification"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
