// Plan and problem lines, shared by `bb crew plan` and the crew-file editor's
// preview (§8.1 E4: "Apply shows the same preview as plan"). No Node imports:
// the frontend bundle uses this file too.
export type PlanLine = { key: string; address: string; action: string; reasons: readonly string[]; threadId: string | null };
export type ProblemLine = { level: "error" | "warning"; message: string };

export function formatProblems(problems: readonly ProblemLine[]): string[] {
  return problems.map((problem) => `  ${problem.level === "error" ? "error" : "warning"}: ${problem.message}`);
}

export function formatPlan(items: readonly PlanLine[]): string[] {
  return items.map(
    (item) =>
      `  ${item.action.padEnd(9)} ${item.address.padEnd(28)} ${item.threadId ?? "-"}${item.reasons.length ? `  (${item.reasons.join("; ")})` : ""}`,
  );
}

/** A member's context use (0..1) as the rounded percentage shown in the UI and agent tools. */
export function formatContextShare(share: number): string {
  return `${Math.round(share * 100)}%`;
}

export type DriftMember = { key: string; provider: string | null; model: string | null };

/**
 * How a crew instance differs from a crew file (BBP-248): members only the
 * instance has (+), members only the file has (−), and model changes as
 * instance → file. One line for `bb crew plan` and `bb crew show --against`.
 */
export function formatDrift(instance: readonly DriftMember[], file: readonly DriftMember[], version: number): string {
  const wanted = new Map(file.map((member) => [member.key, member]));
  const have = new Set(instance.map((member) => member.key));
  const extra = instance.filter((member) => !wanted.has(member.key)).map((member) => member.key);
  const missing = file.filter((member) => !have.has(member.key)).map((member) => member.key);
  const models = instance.flatMap((member) => {
    const target = wanted.get(member.key);
    if (!target || (target.provider === member.provider && target.model === member.model)) return [];
    const show = (m: DriftMember) => (target.provider === member.provider ? `${m.model ?? "?"}` : `${m.provider ?? "?"}/${m.model ?? "?"}`);
    return [`${member.key} (${show(member)}→${show(target)})`];
  });
  const parts = [
    ...(extra.length ? [`+members ${extra.join(", ")}`] : []),
    ...(missing.length ? [`−members ${missing.join(", ")}`] : []),
    ...(models.length ? [`models ${models.join(", ")}`] : []),
  ];
  return `Drift from file: ${parts.length ? parts.join(", ") : "none"}; stored file v${version}`;
}
