const SLACK_MAX_LENGTH = 3000;

export function formatForSlack(text: string): string[] {
  if (!text) return ["No response generated."];

  if (text.length <= SLACK_MAX_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= SLACK_MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }

    let splitIdx = remaining.lastIndexOf("\n\n", SLACK_MAX_LENGTH);

    if (splitIdx < SLACK_MAX_LENGTH / 2) {
      splitIdx = remaining.lastIndexOf("\n", SLACK_MAX_LENGTH);
    }

    if (splitIdx < SLACK_MAX_LENGTH / 2) {
      splitIdx = remaining.lastIndexOf(" ", SLACK_MAX_LENGTH);
    }

    if (splitIdx < SLACK_MAX_LENGTH / 2) {
      splitIdx = SLACK_MAX_LENGTH;
    }

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks;
}
