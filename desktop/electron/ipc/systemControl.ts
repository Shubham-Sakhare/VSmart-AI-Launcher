import { ipcMain } from "electron";
import {
  openSpecialFolder,
  setVolume,
  setBrightness,
  toggleWifi,
  toggleBluetooth,
  takeScreenshot,
  openRecycleBin,
  writeNotepad,
  restartPC,
  shutdownPC,
  cancelShutdown,
  mediaPlayPause,
  mediaNext,
  mediaPrev,
  mediaStop,
  mediaMute,
  windowAction
} from "../services/systemControlService.js";

export interface ControlPayload {
  action: string;
  value?: string | number;
}

export function registerSystemControlIPC() {

  ipcMain.handle(
    "system:control",
    async (_, payload: ControlPayload) => {

      try {
        switch (payload.action) {
          case "openFolder":
            return await openSpecialFolder(String(payload.value ?? ""));

          case "setVolume":
            return await setVolume(Number(payload.value ?? 50));

          case "setBrightness":
            return await setBrightness(Number(payload.value ?? 50));

          case "wifiOn":
            return await toggleWifi("on");

          case "wifiOff":
            return await toggleWifi("off");

          case "bluetoothOn":
            return await toggleBluetooth("on");

          case "bluetoothOff":
            return await toggleBluetooth("off");

          case "screenshot":
            return await takeScreenshot();

          case "recycleBin":
            return await openRecycleBin();

          case "writeNotepad":
            return await writeNotepad(String(payload.value ?? ""));

          case "restart":
            return await restartPC();

          case "shutdown":
            return await shutdownPC();

          case "cancelShutdown":
            return await cancelShutdown();

          // --- Media controls ---
          case "mediaPlayPause":
            return await mediaPlayPause();

          case "mediaNext":
            return await mediaNext();

          case "mediaPrev":
            return await mediaPrev();

          case "mediaStop":
            return await mediaStop();

          case "mediaMute":
            return await mediaMute();

          // --- Window management ---
          case "windowMinimize":
            return await windowAction("minimize");

          case "windowMaximize":
            return await windowAction("maximize");

          case "windowClose":
            return await windowAction("close");

          case "windowMinimizeAll":
            return await windowAction("minimize_all");

          case "windowShowDesktop":
            return await windowAction("show_desktop");

          default:
            return `Unknown system control action: ${payload.action}`;
        }
      } catch (err) {
        return `Something went wrong: ${err}`;
      }

    }
  );

}
