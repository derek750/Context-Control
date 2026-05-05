import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import type * as monacoNs from "monaco-editor";
import { motion } from "motion/react";
import { useCallback, useMemo, useRef } from "react";
import type { Section } from "../types";
import "./EditorPanel.css";

interface Props {
  section: Section;
  content: string;
  onSave: (text: string) => void;
  onDelete: () => void;
  onClose: () => void;
}

const TYPE_LABEL: Record<string, string> = {
  system: "System prompt",
  tool_def: "Tool definition",
  user: "User message",
  assistant: "Assistant response",
  tool_call: "Tool call",
  tool_output: "Tool output",
  image: "Image content",
  thinking: "Thinking",
  unknown: "Unknown section",
};

// Section types whose Monaco view is structural (Anthropic schema-bound),
// not free-form text. Edits to these don't round-trip back into the upstream
// body — see backend gating._apply_block_edit. The user can still delete
// the section to skip it.
const STRUCTURED_TYPES = new Set(["tool_def", "tool_call", "image", "thinking"]);

function languageFor(section: Section): string {
  if (section.sectionType === "tool_call") {
    return "json";
  }
  if (section.sectionType === "tool_output") {
    return detectToolOutputLanguage(section.rawContent);
  }
  return "markdown";
}

function detectToolOutputLanguage(rawContent: string): string {
  const text = rawContent.trim();
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const lowerFirstLine = firstLine.toLowerCase();

  const pathMatch =
    firstLine.match(/(?:^|\s)([\w./@-]+\.(tsx|ts|jsx|js|py|css|scss|html|json|md|ya?ml|toml|rs|go|java|kt|swift|c|h|cpp|hpp|cs|php|rb|sh|bash|zsh|sql))(?::\d+)?(?:\s|$)/i) ??
    text.match(/(?:^|\s)([\w./@-]+\.(tsx|ts|jsx|js|py|css|scss|html|json|md|ya?ml|toml|rs|go|java|kt|swift|c|h|cpp|hpp|cs|php|rb|sh|bash|zsh|sql))(?::\d+)?(?:\s|$)/i);

  const ext = pathMatch?.[2]?.toLowerCase();
  if (ext) {
    const byExtension: Record<string, string> = {
      tsx: "typescript",
      ts: "typescript",
      jsx: "javascript",
      js: "javascript",
      py: "python",
      css: "css",
      scss: "scss",
      html: "html",
      json: "json",
      md: "markdown",
      yaml: "yaml",
      yml: "yaml",
      toml: "toml",
      rs: "rust",
      go: "go",
      java: "java",
      kt: "kotlin",
      swift: "swift",
      c: "c",
      h: "c",
      cpp: "cpp",
      hpp: "cpp",
      cs: "csharp",
      php: "php",
      rb: "ruby",
      sh: "shell",
      bash: "shell",
      zsh: "shell",
      sql: "sql",
    };
    return byExtension[ext] ?? "plaintext";
  }

  if (
    (text.startsWith("{") && text.endsWith("}")) ||
    (text.startsWith("[") && text.endsWith("]"))
  ) {
    return "json";
  }
  if (text.startsWith("<!doctype html") || /<\/?[a-z][\s\S]*>/i.test(text.slice(0, 500))) {
    return "html";
  }
  if (/^#!.*\b(?:bash|sh|zsh)\b/.test(text) || /\b(?:npm|pnpm|yarn|git|cd|mkdir|rm|cp|mv)\s+/.test(text)) {
    return "shell";
  }
  if (/\bfrom\s+["'][^"']+["']\s+import\b|\bimport\s+type\b|\binterface\s+\w+|\btype\s+\w+\s*=|\bconst\s+\w+\s*[:=]/.test(text)) {
    return "typescript";
  }
  if (/\bimport\s+\w+|\bdef\s+\w+\(|\bclass\s+\w+[:(]/.test(text) && /:\s*(?:\n|#)/.test(text)) {
    return "python";
  }
  if (/[.#]?[a-z0-9_-]+\s*\{[\s\S]*:\s*[^;]+;/.test(text)) {
    return "css";
  }
  if (lowerFirstLine.includes("diff --git") || /^@@\s+-\d+,\d+\s+\+\d+,\d+\s+@@/m.test(text)) {
    return "diff";
  }

  return "plaintext";
}

function defineTheme(monaco: Monaco) {
  const root = getComputedStyle(document.documentElement);
  const v = (k: string, fallback: string) => (root.getPropertyValue(k).trim() || fallback);
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: true,
    noSuggestionDiagnostics: true,
  });
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: true,
    noSuggestionDiagnostics: true,
  });
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: false,
    allowComments: true,
    trailingCommas: "ignore",
  });
  monaco.languages.css.cssDefaults.setOptions({ validate: false });
  monaco.languages.css.scssDefaults.setOptions({ validate: false });
  monaco.languages.html.htmlDefaults.setOptions({ validate: false });
  monaco.editor.defineTheme("contextControl", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": v("--cl-bg", "#11100f"),
      "editor.foreground": v("--cl-text", "#f3e7dc"),
      "editorLineNumber.foreground": v("--cl-muted", "#aa9a8a"),
      "editor.selectionBackground": v(
        "--cl-accent-soft",
        "rgba(217, 119, 58, 0.16)",
      ),
      "editorCursor.foreground": v("--cl-accent-strong", "#f28c45"),
    },
  });
}

export function EditorPanel({
  section,
  content,
  onSave,
  onDelete,
  onClose,
}: Props) {
  const editorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(null);

  const language = useMemo(() => languageFor(section), [section]);
  const tokenEstimate = useMemo(
    () => Math.max(1, Math.ceil(content.length / 4)),
    [content],
  );

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    defineTheme(monaco);
    monaco.editor.setTheme("contextControl");
  }, []);

  const onEditorChange = useCallback(
    (value: string | undefined) => {
      onSave(value ?? "");
    },
    [onSave],
  );

  return (
    <motion.aside
      className="editor-panel"
      aria-label="Section editor"
      initial={{ x: "6%", opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: "6%", opacity: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 36 }}
    >
      <header className="editor-head">
        <div className="editor-head-left">
          <span className={`type-badge type-${section.sectionType}`}>
            {TYPE_LABEL[section.sectionType] ?? section.sectionType}
          </span>
          <span className="muted">
            <strong>{tokenEstimate.toLocaleString()}</strong> tokens{" "}
            <span className="estimate">(estimate)</span>
          </span>
        </div>
        <div className="editor-head-right">
          {STRUCTURED_TYPES.has(section.sectionType) && (
            <span
              className="muted"
              title="This section is a structured Anthropic block (tool definition, tool call, or image). Free-form text edits can't round-trip back into its schema, so the editor is read-only. Delete the section to skip it for this request."
            >
              structured · delete to skip
            </span>
          )}
          <button className="btn danger" onClick={onDelete} type="button">
            Delete section
          </button>
          <button className="btn" onClick={onClose} type="button">
            Close
          </button>
        </div>
      </header>
      <div className="editor-body">
        <div className="editor-split">
          <div className="editor-main">
            <Editor
              height="100%"
              language={language}
              value={content}
              onMount={handleMount}
              onChange={onEditorChange}
              theme="contextControl"
              options={{
                minimap: { enabled: false },
                wordWrap: "on",
                scrollBeyondLastLine: false,
                fontSize: 13,
                renderWhitespace: "selection",
                scrollbar: {
                  verticalScrollbarSize: 10,
                  horizontalScrollbarSize: 10,
                },
                lineHeight: 19,
                readOnly: STRUCTURED_TYPES.has(section.sectionType),
              }}
            />
          </div>
        </div>
      </div>
    </motion.aside>
  );
}
