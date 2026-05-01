import { useState, useRef, useEffect } from "react";
import {
  assignTag,
  createTag,
  removeTag,
  nextColor,
} from "../../db/queries/tags";
import type { Tag } from "../../types";

interface Props {
  projectId: string;
  projectTags: string[]; // tag names already on this project
  allTags: Tag[]; // all tags in the library
  onChange: () => void;
}

export default function TagInput({
  projectId,
  projectTags,
  allTags,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlighted(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const q = query.toLowerCase();
  const available = allTags.filter(
    (t) => !projectTags.includes(t.name) && t.name.toLowerCase().includes(q),
  );
  const hasExactMatch = allTags.some((t) => t.name.toLowerCase() === q);
  const showCreate = q.length > 0 && !hasExactMatch;

  type Row = { kind: "create" } | { kind: "existing"; tag: Tag };
  const rows: Row[] = [
    ...(showCreate ? [{ kind: "create" as const }] : []),
    ...available.map((tag) => ({ kind: "existing" as const, tag })),
  ];

  async function selectRow(row: Row) {
    if (!row) return;
    if (row.kind === "create") {
      const tag = await createTag(query.trim(), nextColor(allTags.length));
      await assignTag(projectId, tag.id);
    } else {
      await assignTag(projectId, row.tag.id);
    }
    setOpen(false);
    onChange();
  }

  async function handleRemove(tagName: string) {
    const tag = allTags.find((t) => t.name === tagName);
    if (!tag) return;
    await removeTag(projectId, tag.id);
    onChange();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, rows.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
      return;
    }
    if (e.key === "Enter" && rows.length > 0) {
      e.preventDefault();
      const idx = Math.min(highlighted, rows.length - 1);
      selectRow(rows[idx]);
      return;
    }
  }

  const tagColor = (name: string) =>
    allTags.find((t) => t.name === name)?.color ?? "#888";

  return (
    <div
      ref={containerRef}
      style={{
        display: "flex",
        gap: 5,
        flexWrap: "wrap",
        alignItems: "center",
        position: "relative",
      }}
    >
      {projectTags.map((name) => (
        <span
          key={name}
          className="chip active"
          style={{
            background: `${tagColor(name)}22`,
            color: tagColor(name),
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          #{name}
          <button
            onClick={() => handleRemove(name)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "inherit",
              padding: 0,
              lineHeight: 1,
              fontSize: 12,
            }}
            title="Remove tag"
          >
            ×
          </button>
        </span>
      ))}

      {open ? (
        <div style={{ position: "relative" }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlighted(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="tag name…"
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-autocomplete="list"
            aria-label="Add tag"
            style={{
              fontSize: 12,
              padding: "2px 7px",
              borderRadius: 10,
              border: "1px solid var(--accent)",
              background: "var(--bg-2)",
              color: "var(--text-1)",
              outline: "none",
              width: 110,
            }}
          />
          {rows.length > 0 && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                marginTop: 4,
                zIndex: 100,
                background: "var(--bg-2)",
                border: "1px solid var(--line-2)",
                borderRadius: 7,
                boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                minWidth: 150,
                overflow: "hidden",
              }}
              role="listbox"
            >
              {rows.map((row, i) => (
                <div
                  key={row.kind === "create" ? "__create__" : row.tag.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectRow(row);
                  }}
                  onMouseEnter={() => setHighlighted(i)}
                  role="option"
                  aria-selected={highlighted === i}
                  style={{
                    padding: "6px 10px",
                    cursor: "pointer",
                    fontSize: 12,
                    background:
                      highlighted === i ? "var(--bg-3)" : "transparent",
                    color:
                      row.kind === "create" ? "var(--accent)" : row.tag.color,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {row.kind === "create" ? (
                    <>
                      ＋ Create <b>#{query}</b>
                    </>
                  ) : (
                    <>
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: row.tag.color,
                          flexShrink: 0,
                        }}
                      />
                      #{row.tag.name}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <span
          className="chip"
          style={{ cursor: "pointer" }}
          onClick={() => setOpen(true)}
        >
          + add tag
        </span>
      )}
    </div>
  );
}
