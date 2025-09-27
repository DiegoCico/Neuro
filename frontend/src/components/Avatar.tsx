export default function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initial = (name?.trim()?.[0] ?? "U").toUpperCase();
  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        display: "grid",
        placeItems: "center",
        background: "color-mix(in oklab, var(--accent) 20%, var(--card))",
        border: "1px solid var(--border)",
        fontWeight: 700,
      }}
    >
      {initial}
    </div>
  );
}
