/**
 * The shared summary card as a PNG, drawn on a canvas in the site's palette.
 * It holds only what both chose to show: names, the evening, the lines each
 * partner marked as shareable, and the step for the week. No scores.
 */
export interface SummaryContent {
  title: string;
  dateLine: string;
  facts: string[];
  lines: { name: string; text: string }[];
  step?: string;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

export async function renderSummary(content: SummaryContent): Promise<string> {
  await document.fonts?.ready;
  const width = 1080;
  const height = 1350;
  const pad = 96;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.direction = "rtl";
  ctx.textAlign = "right";
  const right = width - pad;

  ctx.fillStyle = "#184a4c";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#faf6ee";
  ctx.beginPath();
  ctx.roundRect(48, 48, width - 96, height - 96, 36);
  ctx.fill();

  let y = 190;
  ctx.fillStyle = "#184a4c";
  ctx.font = "700 34px Heebo, sans-serif";
  ctx.fillText(content.dateLine, right, y);
  y += 90;
  ctx.fillStyle = "#132a2b";
  ctx.font = "650 72px Rubik, Heebo, sans-serif";
  for (const line of wrap(ctx, content.title, width - pad * 2)) {
    ctx.fillText(line, right, y);
    y += 86;
  }
  y += 10;
  ctx.fillStyle = "#596660";
  ctx.font = "500 36px Heebo, sans-serif";
  ctx.fillText(content.facts.join("  ·  "), right, y);
  y += 80;

  for (const item of content.lines) {
    if (y > height - 300) break;
    ctx.fillStyle = "#c05630";
    ctx.font = "700 34px Heebo, sans-serif";
    ctx.fillText(item.name, right, y);
    y += 56;
    ctx.fillStyle = "#132a2b";
    ctx.font = "400 42px Heebo, sans-serif";
    for (const line of wrap(ctx, item.text, width - pad * 2).slice(0, 4)) {
      ctx.fillText(line, right, y);
      y += 58;
    }
    y += 34;
  }

  if (content.step) {
    const boxTop = height - 290;
    ctx.fillStyle = "#e6f0ec";
    ctx.beginPath();
    ctx.roundRect(pad - 20, boxTop, width - (pad - 20) * 2, 150, 24);
    ctx.fill();
    ctx.fillStyle = "#184a4c";
    ctx.font = "700 32px Heebo, sans-serif";
    ctx.fillText("הצעד שלנו לשבוע", right, boxTop + 56);
    ctx.fillStyle = "#132a2b";
    ctx.font = "500 38px Heebo, sans-serif";
    ctx.fillText(wrap(ctx, content.step, width - pad * 2)[0] ?? "", right, boxTop + 112);
  }

  ctx.fillStyle = "#184a4c";
  ctx.font = "700 30px Rubik, sans-serif";
  ctx.textAlign = "left";
  ctx.direction = "ltr";
  ctx.fillText("Couple Lab", pad, height - 92);
  return canvas.toDataURL("image/png");
}
