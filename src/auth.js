/**
 * Authorization for the /latest command.
 * Allowed when the command carries `user=<allowed>` (or just the name),
 * or when the sender/chat username matches.
 */
export function authorizeLatest({
  text = "",
  fromUsername = "",
  chatUsername = "",
  allowed = "",
}) {
  const allow = allowed.toLowerCase();
  if (!allow) return false;

  const rest = text.trim().split(/\s+/).slice(1).join(" ");
  const param = rest.match(/(?:^|\s)(?:user=)?@?([\w.]+)/i);
  const supplied = (param ? param[1] : "").toLowerCase();

  return (
    supplied === allow ||
    fromUsername.toLowerCase() === allow ||
    chatUsername.toLowerCase() === allow
  );
}
