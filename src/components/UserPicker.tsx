"use client";

// ── Config ─────────────────────────────────────────────────────────────────

export const USER_CONFIG = [
  {
    key: "Zaal",
    initial: "Z",
    btnActive: "bg-blue-500/25 border-blue-500/50 text-blue-200",
    avatarActive: "bg-blue-500/40 text-blue-100",
    avatarInactive: "bg-white/10 text-white/50",
  },
  {
    key: "Iman",
    initial: "I",
    btnActive: "bg-purple-500/25 border-purple-500/50 text-purple-200",
    avatarActive: "bg-purple-500/40 text-purple-100",
    avatarInactive: "bg-white/10 text-white/50",
  },
  {
    key: "ThyRev",
    initial: "T",
    btnActive: "bg-emerald-500/25 border-emerald-500/50 text-emerald-200",
    avatarActive: "bg-emerald-500/40 text-emerald-100",
    avatarInactive: "bg-white/10 text-white/50",
  },
];

const VALID_KEYS = USER_CONFIG.map((u) => u.key);
const BTN_INACTIVE =
  "bg-white/[0.04] border-white/10 text-white/40 hover:text-white/70 hover:bg-white/[0.08]";

// ── Mapping utilities ──────────────────────────────────────────────────────

// selected users → { owner, assignees } for FormData
export function usersToAssignment(users: string[]): { owner: string; assignees: string[] } {
  if (!users.length) return { owner: "Open", assignees: [] };
  const hasZaal = users.includes("Zaal");
  const hasIman = users.includes("Iman");
  const extra = users.filter((u) => u !== "Zaal" && u !== "Iman");
  if (hasZaal && hasIman) return { owner: "Both", assignees: extra };
  const [primary, ...rest] = users;
  return { owner: primary, assignees: rest };
}

// owner + assignees → selected users array (for form initialisation)
export function assignmentToUsers(owner: string, assignees: string[] = []): string[] {
  const base =
    owner === "Both" ? ["Zaal", "Iman"] :
    owner && owner !== "Open" ? [owner] : [];
  return [...new Set([...base, ...assignees])].filter((u) => VALID_KEYS.includes(u));
}

// ── Component ──────────────────────────────────────────────────────────────

// Normal (full) variant — shows avatar + name chip
function FullPicker({
  value,
  onChange,
  disabled,
  label,
}: {
  value: string[];
  onChange: (u: string[]) => void;
  disabled?: boolean;
  label?: string;
}) {
  const toggle = (key: string) =>
    onChange(value.includes(key) ? value.filter((u) => u !== key) : [...value, key]);

  return (
    <div>
      {label && (
        <p className="text-[11px] text-white/45 mb-2 uppercase tracking-wider">{label}</p>
      )}
      <div className="flex gap-2 flex-wrap">
        {USER_CONFIG.map(({ key, initial, btnActive, avatarActive, avatarInactive }) => {
          const active = value.includes(key);
          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => toggle(key)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-all disabled:opacity-40 select-none ${
                active ? btnActive : BTN_INACTIVE
              }`}
            >
              <span
                className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                  active ? avatarActive : avatarInactive
                }`}
              >
                {initial}
              </span>
              {key}
              {active && <span className="text-[10px] opacity-60 ml-0.5">✓</span>}
            </button>
          );
        })}
        {value.length === 0 && (
          <span className="text-xs text-white/25 self-center ml-1">None — open task</span>
        )}
      </div>
    </div>
  );
}

// Compact variant — avatar circles only, no name text (good for inline/quick forms)
function CompactPicker({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (u: string[]) => void;
  disabled?: boolean;
}) {
  const toggle = (key: string) =>
    onChange(value.includes(key) ? value.filter((u) => u !== key) : [...value, key]);

  return (
    <div className="flex items-center gap-1.5">
      {USER_CONFIG.map(({ key, initial, avatarActive, avatarInactive }) => {
        const active = value.includes(key);
        return (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => toggle(key)}
            title={key}
            className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all disabled:opacity-40 select-none ${
              active ? `${avatarActive} border-current` : `${avatarInactive} border-transparent`
            }`}
          >
            {initial}
          </button>
        );
      })}
      {value.length === 0 && (
        <span className="text-[10px] text-white/25 ml-0.5">Open</span>
      )}
    </div>
  );
}

export function UserPicker({
  value,
  onChange,
  disabled,
  label,
  compact = false,
}: {
  value: string[];
  onChange: (users: string[]) => void;
  disabled?: boolean;
  label?: string;
  compact?: boolean;
}) {
  return compact ? (
    <CompactPicker value={value} onChange={onChange} disabled={disabled} />
  ) : (
    <FullPicker value={value} onChange={onChange} disabled={disabled} label={label} />
  );
}
