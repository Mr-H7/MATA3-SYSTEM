"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type Option = { id: string; name: string; departmentId: string; parentId?: string | null };
type Value = { id?: string; name: string; departmentId: string; parentId: string; archived?: boolean };

export default function CategoryForm({
  departments,
  categories,
  initial,
}: {
  departments: Array<{ id: string; name: string }>;
  categories: Option[];
  initial?: Value;
}) {
  const router = useRouter();
  const [value, setValue] = useState<Value>(initial ?? { name: "", departmentId: departments[0]?.id || "", parentId: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const parents = useMemo(
    () =>
      categories.filter(
        (category) =>
          category.departmentId === value.departmentId &&
          category.id !== initial?.id &&
          !category.parentId,
      ),
    [categories, value.departmentId, initial?.id],
  );

  async function save() {
    setSaving(true);
    setError("");
    const response = await fetch(initial?.id ? `/api/categories/${initial.id}` : "/api/categories", {
      method: initial?.id ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) return setError(result.error || "Save failed");
    router.push("/categories");
    router.refresh();
  }

  if (!departments.length) {
    return (
      <div className="bg-white border rounded p-5 space-y-3">
        <p className="text-red-600">No departments are available. The system will create standard departments automatically — refresh this page.</p>
      </div>
    );
  }

  return (
    <div className="bg-white border rounded p-5 space-y-4">
      <label className="block text-sm font-semibold">
        Name
        <input className="form-control mt-1" value={value.name} onChange={(event) => setValue({ ...value, name: event.target.value })} />
      </label>
      <label className="block text-sm font-semibold">
        Department
        <select className="form-control mt-1" value={value.departmentId} onChange={(event) => setValue({ ...value, departmentId: event.target.value, parentId: "" })}>
          {departments.map((department) => (
            <option value={department.id} key={department.id}>
              {department.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-semibold">
        Parent category
        <select className="form-control mt-1" value={value.parentId} onChange={(event) => setValue({ ...value, parentId: event.target.value })}>
          <option value="">None</option>
          {parents.map((category) => (
            <option value={category.id} key={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-[#6e685e]">Optional. Only top-level categories in the same department can be parents.</span>
      </label>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button disabled={saving || !value.name.trim() || !value.departmentId} onClick={save} className="btn btn-gold">
        {saving ? "Saving…" : "Save Category"}
      </button>
    </div>
  );
}
