// ═══════════════════════════════════════════════════════════════════════════
// JARVIS/IRIS - File Intelligence Service
//
// Reads and extracts text from various file formats:
//   • TXT, MD, JSON, CSV    — direct read
//   • PDF                   — pdf-parse (free, no API)
//   • DOCX                  — mammoth (free, no API)
//   • XLSX                  — xlsx library (free)
//   • Images                — returns path for vision agent
//
// All processing is LOCAL — no internet required.
// ═══════════════════════════════════════════════════════════════════════════

import fs   from "fs";
import path from "path";

export interface FileReadResult {
  success:  boolean;
  content?: string;
  error?:   string;
  fileType?: string;
  pages?:   number;
}

export interface FileWriteResult {
  success: boolean;
  path?:   string;
  error?:  string;
}

// ── Read any supported file ───────────────────────────────────────────────────
export async function readFile(filePath: string): Promise<FileReadResult> {
  const resolvedPath = filePath.trim().replace(/^["']|["']$/g, "");

  if (!fs.existsSync(resolvedPath)) {
    return { success: false, error: `File not found: ${resolvedPath}` };
  }

  const ext  = path.extname(resolvedPath).toLowerCase();
  const stat = fs.statSync(resolvedPath);

  if (stat.size > 50 * 1024 * 1024) {
    return { success: false, error: "File too large (>50MB). Please provide a smaller file." };
  }

  try {
    // ── Plain text formats ────────────────────────────────────────────────
    if ([".txt", ".md", ".mdx", ".json", ".csv", ".xml", ".yaml", ".yml", ".log", ".ts", ".js", ".py", ".html", ".css"].includes(ext)) {
      const content = fs.readFileSync(resolvedPath, "utf-8");
      return { success: true, content, fileType: ext.slice(1) };
    }

    // ── PDF ───────────────────────────────────────────────────────────────
    if (ext === ".pdf") {
      return await readPdf(resolvedPath);
    }

    // ── DOCX ──────────────────────────────────────────────────────────────
    if (ext === ".docx" || ext === ".doc") {
      return await readDocx(resolvedPath);
    }

    // ── XLSX / XLS ────────────────────────────────────────────────────────
    if (ext === ".xlsx" || ext === ".xls" || ext === ".ods") {
      return await readExcel(resolvedPath);
    }

    // ── Images — don't read as text, return path ──────────────────────────
    if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"].includes(ext)) {
      return { success: true, content: `[Image file: ${resolvedPath}]`, fileType: "image" };
    }

    // ── Unsupported ───────────────────────────────────────────────────────
    return { success: false, error: `Unsupported file type: ${ext}` };

  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── PDF reading ───────────────────────────────────────────────────────────────
async function readPdf(filePath: string): Promise<FileReadResult> {
  try {
    const pdfParse = await import("pdf-parse").catch(() => null);
    if (!pdfParse) {
      // Try raw text extraction as fallback
      const buf = fs.readFileSync(filePath);
      const text = buf.toString("utf-8")
        .replace(/[^\x20-\x7E\n]/g, " ")
        .replace(/\s{3,}/g, "  ");
      return { success: true, content: text.slice(0, 10000), fileType: "pdf" };
    }

    const buf  = fs.readFileSync(filePath);
    const data = await pdfParse.default(buf);
    return {
      success:  true,
      content:  data.text,
      fileType: "pdf",
      pages:    data.numpages,
    };
  } catch (e) {
    return { success: false, error: `PDF read failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ── DOCX reading ──────────────────────────────────────────────────────────────
async function readDocx(filePath: string): Promise<FileReadResult> {
  try {
    const mammoth = await import("mammoth").catch(() => null);
    if (!mammoth) {
      return { success: false, error: "mammoth not installed. Run: npm install mammoth" };
    }

    const result = await mammoth.default.extractRawText({ path: filePath });
    return {
      success:  true,
      content:  result.value,
      fileType: "docx",
    };
  } catch (e) {
    return { success: false, error: `DOCX read failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ── XLSX reading ──────────────────────────────────────────────────────────────
async function readExcel(filePath: string): Promise<FileReadResult> {
  try {
    const XLSX = await import("xlsx").catch(() => null);
    if (!XLSX) {
      return { success: false, error: "xlsx not installed. Run: npm install xlsx" };
    }

    const workbook = XLSX.default.readFile(filePath);
    const lines: string[] = [];

    for (const sheetName of workbook.SheetNames.slice(0, 5)) {
      const sheet = workbook.Sheets[sheetName];
      const csv   = XLSX.default.utils.sheet_to_csv(sheet);
      lines.push(`=== Sheet: ${sheetName} ===\n${csv}`);
    }

    return {
      success:  true,
      content:  lines.join("\n\n").slice(0, 15000),
      fileType: "xlsx",
    };
  } catch (e) {
    return { success: false, error: `Excel read failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ── Write file ────────────────────────────────────────────────────────────────
export async function writeFile(filePath: string, content: string): Promise<FileWriteResult> {
  try {
    const resolvedPath = filePath.trim().replace(/^["']|["']$/g, "");
    const dir          = path.dirname(resolvedPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(resolvedPath, content, "utf-8");

    // Verify write
    const written = fs.readFileSync(resolvedPath, "utf-8");
    if (written !== content) {
      return { success: false, error: "File write verification failed." };
    }

    return { success: true, path: resolvedPath };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── List files in directory ───────────────────────────────────────────────────
export function listDirectory(dirPath: string, maxDepth = 2): string[] {
  const results: string[] = [];

  function walk(p: string, depth: number) {
    if (depth > maxDepth) return;
    try {
      const entries = fs.readdirSync(p, { withFileTypes: true });
      for (const e of entries) {
        const fullPath = path.join(p, e.name);
        results.push(fullPath);
        if (e.isDirectory() && depth < maxDepth) walk(fullPath, depth + 1);
      }
    } catch { /* skip inaccessible dirs */ }
  }

  walk(dirPath, 0);
  return results;
}
