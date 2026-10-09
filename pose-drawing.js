// Coordinates must follow the video's object-fit: contain layout, including
// the empty space around portrait footage. All drawing uses CSS pixels.
export function containRect(width, height, videoWidth, videoHeight) {
  if (Math.min(width, height, videoWidth, videoHeight) <= 0) return null;
  const scale = Math.min(width / videoWidth, height / videoHeight);
  const fittedWidth = videoWidth * scale;
  const fittedHeight = videoHeight * scale;
  return {
    x: (width - fittedWidth) / 2,
    y: (height - fittedHeight) / 2,
    width: fittedWidth,
    height: fittedHeight
  };
}

const JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 31, 32];
const CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32]
];

export function visible(point) {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
    && (point.visibility ?? 1) >= 0.5 && (point.presence ?? 1) >= 0.5);
}

export function hasBody(pose) {
  return Array.isArray(pose)
    && JOINTS.filter(index => visible(pose[index])).length >= 4
    && (visible(pose[11]) || visible(pose[12]));
}

export function drawPose(context, pose, frame, showBounds) {
  if (!frame || !hasBody(pose)) return;
  const pointAt = index => ({
    x: frame.x + pose[index].x * frame.width,
    y: frame.y + pose[index].y * frame.height
  });
  const joints = JOINTS.filter(index => visible(pose[index])).map(pointAt);

  context.save();
  context.beginPath();
  context.rect(frame.x, frame.y, frame.width, frame.height);
  context.clip();
  context.strokeStyle = '#63ffb1';
  context.fillStyle = '#d9ffeb';
  context.lineWidth = Math.max(2, Math.min(4, frame.width / 250));
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.shadowColor = '#00e984';
  context.shadowBlur = 6;

  context.beginPath();
  for (const [from, to] of CONNECTIONS) {
    if (!visible(pose[from]) || !visible(pose[to])) continue;
    const a = pointAt(from);
    const b = pointAt(to);
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
  }
  context.stroke();

  // A simple head and neck keep the overlay readable as a stick figure.
  if (visible(pose[0]) && visible(pose[11]) && visible(pose[12])) {
    const head = pointAt(0);
    const left = pointAt(11);
    const right = pointAt(12);
    const radius = Math.max(6, Math.hypot(left.x - right.x, left.y - right.y) * 0.22);
    context.beginPath();
    context.arc(head.x, head.y, radius, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(head.x, head.y + radius);
    context.lineTo((left.x + right.x) / 2, (left.y + right.y) / 2);
    context.stroke();
  }

  for (const point of joints) {
    context.beginPath();
    context.arc(point.x, point.y, 3, 0, Math.PI * 2);
    context.fill();
  }

  if (showBounds) {
    const padding = frame.width * 0.025;
    const left = Math.max(frame.x, Math.min(...joints.map(p => p.x)) - padding);
    const top = Math.max(frame.y, Math.min(...joints.map(p => p.y)) - padding);
    const right = Math.min(frame.x + frame.width, Math.max(...joints.map(p => p.x)) + padding);
    const bottom = Math.min(frame.y + frame.height, Math.max(...joints.map(p => p.y)) + padding);
    context.shadowBlur = 0;
    context.lineWidth = 1.5;
    context.setLineDash([7, 5]);
    context.strokeRect(left, top, right - left, bottom - top);
    context.setLineDash([]);
    context.font = 'bold 11px ui-monospace, monospace';
    context.fillStyle = '#08251c';
    const labelY = Math.max(frame.y, top - 22);
    context.fillRect(left, labelY, 121, 20);
    context.fillStyle = '#63ffb1';
    context.fillText('BODY DETECTED', left + 7, labelY + 14);
  }
  context.restore();
}
