import { useEffect, useRef, type ReactNode } from "react";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
} from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  defaultHighlightStyle,
  syntaxHighlighting,
  foldGutter,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { json } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import { X, Plus, Trash2, FileUp } from "lucide-react";
import { pair, type Pair } from "../core/model";
import { store } from "../storage/store";
export function Button({
  children,
  onClick,
  title,
  className = "",
  disabled = false,
  ...rest
}: {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type="button"
      className={"button " + className}
      onClick={onClick}
      title={title}
      disabled={disabled}
      {...rest}
    >
      {children}
    </button>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "modal wide" : "modal"}
      onCancel={onClose}
    >
      <div className="modal-title">
        <h2>{title}</h2>
        <Button aria-label="Close dialog" onClick={onClose}>
          <X size={18} />
        </Button>
      </div>
      <div className="modal-content">{children}</div>
    </dialog>
  );
}
export function CodeEditor({
  value,
  onChange,
  language = "text",
  readOnly = false,
  label = "Body editor",
}: {
  value: string;
  onChange?: (v: string) => void;
  language?: string;
  readOnly?: boolean;
  label?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const callback = useRef(onChange);
  callback.current = onChange;
  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          foldGutter(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          syntaxHighlighting(defaultHighlightStyle),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          EditorView.lineWrapping,
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.contentAttributes.of({ "aria-label": label }),
          ...(language === "json"
            ? [json()]
            : language === "xml"
              ? [xml()]
              : []),
          EditorView.updateListener.of((v) => {
            if (v.docChanged) callback.current?.(v.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, [language, readOnly, label]); // Value updates are applied without rebuilding the editor.
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value)
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: value },
      });
  }, [value]);
  return <div ref={host} className="code-editor" />;
}
export function PairEditor({
  rows,
  onChange,
  label = "Header",
  files = false,
  onError,
}: {
  rows: Pair[];
  onChange: (p: Pair[]) => void;
  label?: string;
  files?: boolean;
  onError?: (s: string) => void;
}) {
  const update = (id: string, patch: Partial<Pair>) =>
    onChange(rows.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  return (
    <div className="pair-editor">
      <div className="pair-heading">
        <span />
        <span>NAME</span>
        <span>VALUE</span>
        <span />
      </div>
      {rows.map((p, i) => (
        <div className="pair-row" key={p.id}>
          <input
            type="checkbox"
            aria-label={`Enable ${label} ${i + 1}`}
            checked={p.enabled}
            onChange={(e) => update(p.id, { enabled: e.target.checked })}
          />
          <input
            aria-label={`${label} name ${i + 1}`}
            placeholder="Name"
            value={p.name}
            onChange={(e) => update(p.id, { name: e.target.value })}
          />
          <div className="pair-value">
            <input
              aria-label={`${label} value ${i + 1}`}
              placeholder='Value · ${"variable"}'
              value={p.fileId ? (p.fileName ?? "File") : p.value}
              disabled={!!p.fileId}
              onChange={(e) => update(p.id, { value: e.target.value })}
            />
            {files && (
              <label className="icon-button" title="Select file">
                <FileUp size={16} />
                <input
                  type="file"
                  hidden
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f)
                      try {
                        update(p.id, {
                          fileId: await store.addFile(f),
                          fileName: f.name,
                        });
                      } catch (err) {
                        onError?.(String(err));
                      }
                  }}
                />
              </label>
            )}
            {p.fileId && (
              <Button
                onClick={() =>
                  update(p.id, { fileId: undefined, fileName: undefined })
                }
                title="Use text value"
              >
                <X size={14} />
              </Button>
            )}
          </div>
          <Button
            title={`Remove ${label}`}
            onClick={() => onChange(rows.filter((x) => x.id !== p.id))}
          >
            <Trash2 size={15} />
          </Button>
        </div>
      ))}
      <Button
        className="text-button"
        onClick={() => onChange([...rows, pair()])}
      >
        <Plus size={15} /> Add {label.toLowerCase()}
      </Button>
    </div>
  );
}
export function download(
  name: string,
  content: Blob | string,
  type = "application/json",
) {
  const url = URL.createObjectURL(
    typeof content === "string" ? new Blob([content], { type }) : content,
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export const errorText = (e: unknown) =>
  e instanceof Error ? e.message : String(e);
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-mark">{"{ }"}</div>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
