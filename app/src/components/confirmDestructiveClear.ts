/** Strong confirmation for irreversible bulk editor actions. */
export function confirmDestructiveClear(description: string): boolean {
  const answer = window.prompt(
    `This will permanently delete ${description}.\n\nType CLEAR to continue.`,
  );
  return answer === "CLEAR";
}

export const destructiveButtonStyle: React.CSSProperties = {
  color: "#ffb4b4",
  borderColor: "rgba(255,90,90,0.55)",
  background: "rgba(130,20,20,0.22)",
};
