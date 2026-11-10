"use client";

import { Archive, ArrowCounterClockwise, CaretDown, CaretUp, PencilSimple, Plus, X } from "@/components/icons";
import { useState, type FormEvent } from "react";
import { liveCategories } from "@/lib/catalogue/categories";
import { addCategory, moveCategory, productsInCategory, renameCategory, setCategoryArchived } from "@/lib/demo-store";
import type { Category } from "@/lib/domain";
import { requestConfirm } from "@/lib/ui/confirm-store";
import { toast } from "@/lib/ui/toast-store";

/** Stage 2C: the owner adds, renames, orders and archives categories. Works offline through the outbox. */
export function CategoriesPanel({ categories, problems, onClose }: { categories: Category[]; problems: Map<string, string>; onClose: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const live = liveCategories(categories);
  const archived = categories.filter((category) => category.archived).sort((a, b) => a.name.localeCompare(b.name));

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = addCategory(name);
    if (!result.ok) return setError(result.error);
    setName("");
    setError("");
    toast("Category added");
  }

  function saveRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const result = renameCategory(editing.id, editing.name);
    if (!result.ok) return setError(result.error);
    setEditing(null);
    setError("");
  }

  async function archive(category: Category) {
    const count = productsInCategory(category.id);
    if (count && !(await requestConfirm({
      title: `Archive ${category.name}?`,
      body: `${count} ${count === 1 ? "product" : "products"} will show as Uncategorised.`,
      confirmLabel: "Archive",
    }))) return;
    const result = setCategoryArchived(category.id, true);
    setError(result.ok ? "" : result.error);
  }

  function restore(category: Category) {
    const result = setCategoryArchived(category.id, false);
    setError(result.ok ? "" : result.error);
  }

  const row = (category: Category, index: number) => (
    <li key={category.id} className="category-row">
      {editing?.id === category.id ? (
        <form className="category-rename" onSubmit={saveRename}>
          <input className="input" aria-label={`New name for ${category.name}`} value={editing.name} maxLength={40} autoFocus onChange={(event) => setEditing({ id: category.id, name: event.target.value })} />
          <button className="button primary" type="submit">Save</button>
          <button className="button" type="button" onClick={() => setEditing(null)}>Cancel</button>
        </form>
      ) : (
        <>
          <span className="category-name">{category.name}{problems.get(category.id) ? <small className="form-error">{problems.get(category.id)}</small> : null}</span>
          <span className="category-actions">
            <button className="button icon-only" type="button" onClick={() => moveCategory(category.id, -1)} disabled={index === 0} aria-label={`Move ${category.name} up`}><CaretUp size={14} weight="bold" /></button>
            <button className="button icon-only" type="button" onClick={() => moveCategory(category.id, 1)} disabled={index === live.length - 1} aria-label={`Move ${category.name} down`}><CaretDown size={14} weight="bold" /></button>
            <button className="button" type="button" onClick={() => setEditing({ id: category.id, name: category.name })} aria-label={`Rename ${category.name}`}><PencilSimple size={14} weight="bold" /> Rename</button>
            <button className="button" type="button" onClick={() => void archive(category)} aria-label={`Archive ${category.name}`}><Archive size={14} weight="bold" /> Archive</button>
          </span>
        </>
      )}
    </li>
  );

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-label="Categories">
        <div className="modal-header"><div><div className="panel-title">Categories</div><div className="panel-subtitle">Group products for the till and for profit reports</div></div><button type="button" className="button icon-only" onClick={onClose} aria-label="Close"><X size={16} weight="bold" /></button></div>
        <div className="modal-body">
          <form className="category-add" onSubmit={add}>
            <label className="sr-only" htmlFor="new-category">New category</label>
            <input className="input" id="new-category" placeholder="New category, e.g. Drinks" maxLength={40} value={name} onChange={(event) => setName(event.target.value)} autoFocus />
            <button className="button primary" type="submit"><Plus size={14} weight="bold" /> Add</button>
          </form>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {live.length ? <ol className="category-list">{live.map(row)}</ol> : <p className="field-hint">No categories yet. Products without one show as Uncategorised.</p>}
          {archived.length ? (
            <>
              <button type="button" className="button" onClick={() => setShowArchived((value) => !value)}>{showArchived ? "Hide archived" : `Show archived (${archived.length})`}</button>
              {showArchived ? <ul className="category-list">{archived.map((category) => (
                <li key={category.id} className="category-row"><span className="category-name">{category.name}</span><span className="category-actions"><button className="button" type="button" onClick={() => restore(category)} aria-label={`Restore ${category.name}`}><ArrowCounterClockwise size={14} weight="bold" /> Restore</button></span></li>
              ))}</ul> : null}
            </>
          ) : null}
        </div>
        <div className="modal-footer"><button type="button" className="button" onClick={onClose}>Done</button></div>
      </section>
    </div>
  );
}
