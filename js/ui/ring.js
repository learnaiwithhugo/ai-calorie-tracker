// ring.js — RingGauge component (SPEC-UI.md §1.3): two concentric circles, progress arc starts
// at 12 o'clock and draws clockwise, round line caps, .easeOut transition on progress change.

/**
 * Returns markup for a ring gauge. Caller wraps it in a positioned container if a center icon
 * is supplied (already baked in here via .ring-center).
 * @param {{size:number, strokeWidth:number, progress:number, color:string, trackColor:string, centerHtml?:string}} opts
 */
export function ringGauge({ size, strokeWidth, progress, color, trackColor, centerHtml = "" }) {
  const radius = size / 2 - strokeWidth / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, progress));
  const dashOffset = circumference * (1 - clamped);
  return `
    <div class="ring-wrap" style="width:${size}px;height:${size}px;">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${radius}" stroke="${trackColor}" stroke-width="${strokeWidth}"></circle>
        <circle class="ring-progress" cx="${size / 2}" cy="${size / 2}" r="${radius}" stroke="${color}" stroke-width="${strokeWidth}"
          stroke-dasharray="${circumference}" stroke-dashoffset="${dashOffset}"></circle>
      </svg>
      <div class="ring-center">${centerHtml}</div>
    </div>
  `;
}
