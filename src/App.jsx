// --- TRUE SPAN TEXT (glyph chopped by cells) ---
if (s.spanOn && s.spanText?.length) {
  const row = clamp(s.spanRow, 0, s.rows - 1);
  const col = clamp(s.spanCol, 0, s.cols - 1);
  const spanCols = clamp(s.spanCols ?? s.spanLen ?? 4, 1, s.cols - col);
  const spanRows = clamp(s.spanRows ?? 4, 1, s.rows - row);

  // Calculate full span rectangle in grid space
  const startGeom = swissCellGeom(row, col, w, h);
  const endGeom = swissCellGeom(row + spanRows - 1, col + spanCols - 1, w, h);

  const spanX = startGeom.x;
  const spanY = startGeom.y;
  const spanW = (endGeom.x + endGeom.w) - spanX;
  const spanH = (endGeom.y + endGeom.h) - spanY;

  // Font size based on HEIGHT only (prevents giant black box)
  const fontSize = spanH * 0.9;

  ctx.save();
  ctx.font = `900 ${fontSize}px ${getFontFamily()}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillStyle = "#000";

  const textX = spanX + spanW / 2;
  const textY = spanY + spanH / 2;

  // Draw per-cell clipped
  for (let rr = 0; rr < spanRows; rr++) {
    for (let cc = 0; cc < spanCols; cc++) {
      const g = swissCellGeom(row + rr, col + cc, w, h);

      ctx.save();
      ctx.beginPath();
      ctx.rect(g.x, g.y, g.w, g.h);
      ctx.clip();

      ctx.fillText(s.spanText, textX, textY);

      ctx.restore();
    }
  }

  ctx.restore();
}
