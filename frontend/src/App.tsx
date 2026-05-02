import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import "./App.css";
import { BarChart } from "./components/BarChart";
import { EditorPanel } from "./components/EditorPanel";
import { StatusBar } from "./components/StatusBar";
import { useSelection } from "./hooks/useSelection";
import { useUndo, type UndoSnapshot } from "./hooks/useUndo";
import { useWebSocket } from "./hooks/useWebSocket";
import { installMockHarness, isMockMode } from "./mock/harness";
import type { EditedSection, Mode, NewRequest, Section, Snapshot } from "./types";

interface CurrentRequest {
  requestId: string;
  model: string;
  sections: Section[];
  totalTokens: number;
  totalCost: number;
  held: boolean;
}

interface AppState {
  mode: Mode;
  paused: boolean;
  currentRequest: CurrentRequest | null;
  // Held requests that arrived while another was already pending. The proxy
  // only ever holds one at a time in normal use, but this guards against
  // back-to-back rapid prompts silently displacing one another.
  pendingQueue: NewRequest[];
  removedIndices: Set<number>;
  editedSections: Map<number, string>;
  editorOpenForIndex: number | null;
}

type Action =
  | { type: "new_request"; msg: NewRequest }
  | { type: "snapshot"; msg: Snapshot }
  | { type: "mode_change"; mode: Mode }
  | { type: "pause_toggle"; paused: boolean }
  | { type: "confirm_removed"; indices: number[] }
  | { type: "apply_snapshot"; snapshot: UndoSnapshot }
  | { type: "edit_section"; index: number; content: string }
  | { type: "open_editor"; index: number }
  | { type: "close_editor" }
  | { type: "after_send" };

function buildCurrentRequest(msg: NewRequest, fallbackHeld: boolean): CurrentRequest {
  return {
    requestId: msg.requestId,
    model: msg.model,
    sections: msg.sections,
    totalTokens: msg.totalTokens,
    totalCost: msg.totalCost,
    held: msg.held ?? fallbackHeld,
  };
}

// Distinguish "main conversation" requests from Claude Code's auxiliary
// calls (title generation, topic detection, conversation summary). Aux
// calls have a tiny system prompt and ship no `tools`, while every main
// request defines the full tool set. Without this filter, those tiny aux
// requests overwrite the main-chat chart on every keystroke.
function isMainConversationRequest(msg: NewRequest): boolean {
  return msg.sections.some((s) => s.sectionType === "tool_def");
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "snapshot": {
      const { msg } = action;
      const incoming = msg.pendingRequest ?? msg.latestRequest ?? null;
      const isHeld = msg.pendingRequest !== null;
      const next: AppState = {
        ...state,
        mode: msg.mode,
        paused: msg.paused,
      };
      const pendingFromSnapshot = (msg.pendingRequests ?? []).filter(
        isMainConversationRequest,
      );
      if (pendingFromSnapshot.length > 1) {
        next.pendingQueue = pendingFromSnapshot.slice(1);
      } else if (state.pendingQueue.length > 0 && pendingFromSnapshot.length <= 1) {
        next.pendingQueue = [];
      }
      if (incoming && isMainConversationRequest(incoming)) {
        const sameId = state.currentRequest?.requestId === incoming.requestId;
        if (!sameId) {
          const isTopLevel = (incoming.kind ?? "top_level") === "top_level";
          next.currentRequest = buildCurrentRequest(incoming, isHeld);
          if (isTopLevel) {
            next.removedIndices = new Set();
            next.editedSections = new Map();
            next.editorOpenForIndex = null;
          }
        } else if (state.currentRequest && state.currentRequest.held !== isHeld) {
          next.currentRequest = { ...state.currentRequest, held: isHeld };
        }
      }
      return next;
    }
    case "new_request": {
      const { msg } = action;
      if (!isMainConversationRequest(msg)) {
        return state;
      }
      if (
        state.currentRequest &&
        state.currentRequest.held &&
        state.currentRequest.requestId !== msg.requestId
      ) {
        return { ...state, pendingQueue: [...state.pendingQueue, msg] };
      }
      const isHeld = msg.held ?? state.mode === "ask_permission";
      const isTopLevel = (msg.kind ?? "top_level") === "top_level";
      // tool_chain continuations preserve in-flight edits so a section the user
      // was mid-editing in Monaco doesn't lose its text the moment the next
      // step arrives. top_level prompts always start clean.
      if (!isTopLevel) {
        return {
          ...state,
          currentRequest: buildCurrentRequest(msg, isHeld),
        };
      }
      return {
        ...state,
        currentRequest: buildCurrentRequest(msg, isHeld),
        removedIndices: new Set(),
        editedSections: new Map(),
        editorOpenForIndex: null,
      };
    }
    case "mode_change":
      return { ...state, mode: action.mode };
    case "pause_toggle":
      return { ...state, paused: action.paused };
    case "confirm_removed": {
      const next = new Set(state.removedIndices);
      for (const i of action.indices) next.add(i);
      return { ...state, removedIndices: next };
    }
    case "apply_snapshot":
      return {
        ...state,
        removedIndices: new Set(action.snapshot.removedIndices),
        editedSections: new Map(action.snapshot.editedSections),
      };
    case "edit_section": {
      const next = new Map(state.editedSections);
      next.set(action.index, action.content);
      return { ...state, editedSections: next };
    }
    case "open_editor":
      return { ...state, editorOpenForIndex: action.index };
    case "close_editor":
      return { ...state, editorOpenForIndex: null };
    case "after_send": {
      const cr = state.currentRequest;
      if (state.pendingQueue.length > 0) {
        const [next, ...rest] = state.pendingQueue;
        const isHeld = next.held ?? state.mode === "ask_permission";
        return {
          ...state,
          currentRequest: buildCurrentRequest(next, isHeld),
          pendingQueue: rest,
          removedIndices: new Set(),
          editedSections: new Map(),
          editorOpenForIndex: null,
        };
      }
      return {
        ...state,
        currentRequest: cr ? { ...cr, held: false } : null,
        removedIndices: new Set(),
        editedSections: new Map(),
        editorOpenForIndex: null,
      };
    }
  }
}

function loadInitialState(): AppState {
  return {
    mode: "auto_send",
    paused: false,
    currentRequest: null,
    pendingQueue: [],
    removedIndices: new Set(),
    editedSections: new Map(),
    editorOpenForIndex: null,
  };
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitialState);
  const selection = useSelection();
  const undo = useUndo({
    applySnapshot: useCallback(
      (snapshot) => dispatch({ type: "apply_snapshot", snapshot }),
      [],
    ),
  });

  const [undoToast, setUndoToast] = useState<{ message: string; id: number } | null>(null);
  useEffect(() => {
    if (!undoToast) return;
    const t = setTimeout(() => setUndoToast(null), 1800);
    return () => clearTimeout(t);
  }, [undoToast?.id]);

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  const senders = useWebSocket({
    onNewRequest: (msg: NewRequest) => {
      const cur = stateRef.current;
      const isMain = msg.sections.some((s) => s.sectionType === "tool_def");
      const isTopLevel = (msg.kind ?? "top_level") === "top_level";
      const willReplace =
        isMain &&
        !(
          cur.currentRequest &&
          cur.currentRequest.held &&
          cur.currentRequest.requestId !== msg.requestId
        ) &&
        (!cur.currentRequest || cur.currentRequest.requestId !== msg.requestId);
      dispatch({ type: "new_request", msg });
      if (willReplace && isTopLevel) {
        selection.clearAll();
        undo.clear();
      }
    },
    onSnapshot: (msg: Snapshot) => {
      const cur = stateRef.current;
      const incoming = msg.pendingRequest ?? msg.latestRequest ?? null;
      const isMain =
        !!incoming && incoming.sections.some((s) => s.sectionType === "tool_def");
      const isTopLevel = (incoming?.kind ?? "top_level") === "top_level";
      const replacingRequest =
        isMain &&
        (!cur.currentRequest || cur.currentRequest.requestId !== incoming!.requestId);
      dispatch({ type: "snapshot", msg });
      if (replacingRequest && isTopLevel) {
        selection.clearAll();
        undo.clear();
      }
    },
  });

  useEffect(() => {
    if (!isMockMode()) return;
    return installMockHarness();
  }, []);

  const visibleSections = useMemo<Section[]>(() => {
    const cr = state.currentRequest;
    if (!cr) return [];
    return cr.sections
      .filter((s) => !state.removedIndices.has(s.index))
      .map((s) => {
        const edited = state.editedSections.get(s.index);
        if (edited == null) return s;
        const tokenCount = Math.max(1, Math.ceil(edited.length / 4));
        return { ...s, rawContent: edited, tokenCount };
      });
  }, [state.currentRequest, state.removedIndices, state.editedSections]);

  const canDelete = useCallback(
    (toDelete: Iterable<number>) => {
      const cr = state.currentRequest;
      if (!cr) return false;
      const removed = new Set(state.removedIndices);
      for (const i of toDelete) removed.add(i);
      const remaining = cr.sections.filter((s) => !removed.has(s.index));
      if (remaining.length === 0) return false;
      let calls = 0;
      let outputs = 0;
      for (const s of remaining) {
        if (s.sectionType === "tool_call") calls += 1;
        if (s.sectionType === "tool_output") {
          outputs += 1;
          if (outputs > calls) return false;
        }
      }
      return true;
    },
    [state.currentRequest, state.removedIndices],
  );

  const confirmDeletion = useCallback(() => {
    const cr = state.currentRequest;
    if (!cr) return;
    const indices = [...selection.markedForDelete];
    if (indices.length === 0) return;
    if (!canDelete(indices)) {
      selection.clearMarks();
      return;
    }
    undo.push({
      removedIndices: state.removedIndices,
      editedSections: state.editedSections,
    });
    dispatch({ type: "confirm_removed", indices });
    selection.clearAll();
    if (!cr.held) {
      const merged = new Set(state.removedIndices);
      for (const i of indices) merged.add(i);
      const editedSections: EditedSection[] = [...state.editedSections].map(
        ([index, newContent]) => ({ index, newContent }),
      );
      senders.sendCommitEditsNow(cr.requestId, [...merged], editedSections);
    }
  }, [
    state.currentRequest,
    state.removedIndices,
    state.editedSections,
    selection,
    canDelete,
    undo,
    senders,
  ]);

  const tryMarkSelected = useCallback(() => {
    const cr = state.currentRequest;
    if (!cr) return;
    if (selection.selectedIndices.size === 0) return;
    const wouldDelete = new Set([
      ...state.removedIndices,
      ...selection.selectedIndices,
    ]);
    const remaining = cr.sections.filter((s) => !wouldDelete.has(s.index));
    if (remaining.length === 0) return;
    selection.markSelectedForDelete();
  }, [state.currentRequest, state.removedIndices, selection]);

  const handleUndo = useCallback(() => {
    if (undo.size() === 0) return;
    const prevRemoved = state.removedIndices;
    const prevEdited = state.editedSections;
    const snapshot = undo.undo();
    selection.clearAll();
    if (snapshot) {
      const cr = state.currentRequest;
      const restoredSections = cr
        ? cr.sections.filter(
            (s) => prevRemoved.has(s.index) && !snapshot.removedIndices.has(s.index),
          )
        : [];
      let message: string;
      if (restoredSections.length === 1) {
        const typeLabel: Record<string, string> = {
          system: "system prompt",
          tool_def: "tool definition",
          user: "user message",
          assistant: "assistant response",
          tool_call: "tool call",
          tool_output: "tool output",
          image: "image",
          thinking: "thinking block",
          unknown: "section",
        };
        message = `Restored: ${typeLabel[restoredSections[0].sectionType] ?? "section"}`;
      } else if (restoredSections.length > 1) {
        message = `Restored ${restoredSections.length} sections`;
      } else if (prevEdited.size !== snapshot.editedSections.size) {
        message = "Edit undone";
      } else {
        message = "Undo";
      }
      setUndoToast({ message, id: Date.now() });
    }
  }, [undo, selection, state.removedIndices, state.editedSections, state.currentRequest]);

  useEffect(() => {
    if (state.editorOpenForIndex !== null) return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        tryMarkSelected();
      } else if (e.key === "Enter") {
        e.preventDefault();
        confirmDeletion();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        handleUndo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state.editorOpenForIndex, tryMarkSelected, confirmDeletion, handleUndo]);

  const onSend = useCallback(() => {
    const cr = state.currentRequest;
    if (!cr) return;
    if (state.removedIndices.size === 0 && state.editedSections.size === 0) {
      senders.sendApprove(cr.requestId);
    } else {
      const editedSections: EditedSection[] = [...state.editedSections].map(
        ([index, newContent]) => ({ index, newContent }),
      );
      senders.sendApproveModified(
        cr.requestId,
        [...state.removedIndices],
        editedSections,
      );
    }
    undo.clear();
    selection.clearAll();
    dispatch({ type: "after_send" });
  }, [state.currentRequest, state.removedIndices, state.editedSections, senders, undo, selection]);

  const onEditSection = useCallback(
    (index: number, content: string) => {
      dispatch({ type: "edit_section", index, content });
    },
    [],
  );

  const handleCloseEditor = useCallback(() => {
    const cr = state.currentRequest;
    const idx = state.editorOpenForIndex;
    if (cr && !cr.held && idx != null && state.editedSections.has(idx)) {
      const editedSections: EditedSection[] = [...state.editedSections].map(
        ([i, newContent]) => ({ index: i, newContent }),
      );
      senders.sendCommitEditsNow(
        cr.requestId,
        [...state.removedIndices],
        editedSections,
      );
    }
    dispatch({ type: "close_editor" });
  }, [
    state.currentRequest,
    state.editorOpenForIndex,
    state.editedSections,
    state.removedIndices,
    senders,
  ]);

  const onDeleteFromEditor = useCallback(
    (index: number) => {
      if (!canDelete([index])) return;
      undo.push({
        removedIndices: state.removedIndices,
        editedSections: state.editedSections,
      });
      dispatch({ type: "confirm_removed", indices: [index] });
      dispatch({ type: "close_editor" });
      selection.clearAll();
      const cr = state.currentRequest;
      if (cr && !cr.held) {
        const merged = new Set(state.removedIndices);
        merged.add(index);
        const editedSections: EditedSection[] = [...state.editedSections].map(
          ([i, newContent]) => ({ index: i, newContent }),
        );
        senders.sendCommitEditsNow(cr.requestId, [...merged], editedSections);
      }
    },
    [
      state.currentRequest,
      state.removedIndices,
      state.editedSections,
      canDelete,
      undo,
      selection,
      senders,
    ],
  );

  const editorSection = useMemo<Section | null>(() => {
    const cr = state.currentRequest;
    if (!cr || state.editorOpenForIndex == null) return null;
    return cr.sections.find((s) => s.index === state.editorOpenForIndex) ?? null;
  }, [state.currentRequest, state.editorOpenForIndex]);

  const editorContent = useMemo(() => {
    if (!editorSection) return "";
    return state.editedSections.get(editorSection.index) ?? editorSection.rawContent;
  }, [editorSection, state.editedSections]);

  const totalTokens = useMemo(() => {
    const cr = state.currentRequest;
    if (!cr) return 0;
    let total = 0;
    for (const s of visibleSections) total += s.tokenCount;
    return total;
  }, [state.currentRequest, visibleSections]);

  const totalCost = useMemo(() => {
    const cr = state.currentRequest;
    if (!cr) return 0;
    if (cr.totalTokens === 0) return cr.totalCost;
    return (totalTokens / cr.totalTokens) * cr.totalCost;
  }, [state.currentRequest, totalTokens]);

  const hasEstimate = state.editedSections.size > 0;

  if (!state.currentRequest) {
    return (
      <div className="app empty">
        <motion.div
          className="empty-card"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 28 }}
        >
          <h1>Autonomy</h1>
          <p>Waiting for the next Claude Code API call…</p>
          <p className="hint">
            Run Claude Code with{" "}
            <code>ANTHROPIC_BASE_URL=http://localhost:8080</code> to start
            streaming context here.
          </p>
        </motion.div>
      </div>
    );
  }

  const cr = state.currentRequest;

  return (
    <div className={`app ${state.editorOpenForIndex !== null ? "with-editor" : ""}`}>
      <main className="app-main">
        <div style={{ position: "absolute", inset: 0, display: "flex" }}>
          <BarChart
            sections={visibleSections}
            allSections={cr.sections}
            selectedIndices={selection.selectedIndices}
            markedForDelete={selection.markedForDelete}
            onSelect={(index, shift) => {
              if (shift) {
                selection.rangeSelect(
                  index,
                  visibleSections.map((s) => s.index),
                );
              } else {
                selection.select(index);
              }
            }}
            onOpenEditor={(index) => dispatch({ type: "open_editor", index })}
          />
        </div>

        <AnimatePresence>
          {editorSection && (
            <EditorPanel
              key={editorSection.index}
              section={editorSection}
              content={editorContent}
              onSave={(text) => onEditSection(editorSection.index, text)}
              onDelete={() => onDeleteFromEditor(editorSection.index)}
              onClose={handleCloseEditor}
            />
          )}
        </AnimatePresence>

        <div className="undo-toast-anchor">
          <AnimatePresence>
            {undoToast && (
              <motion.div
                key={undoToast.id}
                className="undo-toast"
                initial={{ opacity: 0, y: 8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.95 }}
                transition={{ type: "spring", stiffness: 340, damping: 30 }}
              >
                {undoToast.message}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      <StatusBar
        mode={state.mode}
        paused={state.paused}
        held={cr.held}
        queueLength={state.pendingQueue.length}
        totalTokens={totalTokens}
        totalCost={totalCost}
        hasEdits={hasEstimate}
        canUndo={undo.size() > 0}
        onModeChange={(mode) => {
          dispatch({ type: "mode_change", mode });
          senders.sendModeChange(mode);
        }}
        onTogglePause={() => {
          const next = !state.paused;
          dispatch({ type: "pause_toggle", paused: next });
          senders.sendPauseToggle(next);
        }}
        onSend={onSend}
        onUndo={handleUndo}
      />
    </div>
  );
}
