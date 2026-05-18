"use client";

import React from 'react';

type Office = { ncode: number | string; vcompanyname: string; nunder?: number | string };

interface Props {
  offices: Office[];
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  single?: boolean; // single-select mode
  search?: string;
}

export default function BranchTree({ offices, selectedIds, setSelectedIds, single = false, search = '' }: Props) {
  const normalizedSelectedIds = Array.isArray(selectedIds) ? selectedIds.map(String) : (selectedIds ? [String(selectedIds)] : []);

  const getAllChildren = (id: string): string[] => {
    const children = offices.filter(c => String(c.nunder) === String(id));
    let ids = [id];
    children.forEach(c => {
      ids = [...ids, ...getAllChildren(String(c.ncode))];
    });
    return ids;
  };

  const buildTree = (parentId: string | null = '0', level = 0): React.ReactNode[] => {
    return offices
      .filter(o => String(o.nunder || '0') === String(parentId || '0'))
      .filter(o => !search || o.vcompanyname.toLowerCase().includes(search.toLowerCase()))
      .map(o => {
        const id = String(o.ncode);
        const isSelected = normalizedSelectedIds.includes(id);
        return [
          <label key={id} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 rounded cursor-pointer transition-colors group">
            <div style={{ width: `${level * 12}px` }} />
            <input
              type="checkbox"
              className="w-3.5 h-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
              checked={isSelected}
              onChange={(e) => {
                if (single) {
                  if (e.target.checked) setSelectedIds([id]);
                  else setSelectedIds([]);
                  return;
                }

                if (e.target.checked) {
                  const allToAdd = getAllChildren(id);
                  const newIds = Array.from(new Set([...normalizedSelectedIds, ...allToAdd]));
                  setSelectedIds(newIds);
                } else {
                  const allToRemove = getAllChildren(id);
                  const newIds = normalizedSelectedIds.filter(i => !allToRemove.includes(i));
                  setSelectedIds(newIds);
                }
              }}
            />
            <span className={`text-[11px] font-medium ${isSelected ? 'text-slate-900 font-bold' : 'text-slate-600'} group-hover:text-slate-900`}>
              {o.vcompanyname}
            </span>
          </label>,
          ...buildTree(String(o.ncode), level + 1)
        ];
      }).flat();
  };

  return <div>{buildTree('0', 0)}</div>;
}
