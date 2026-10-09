// Use a classic worker: MediaPipe's WASM loader uses importScripts internally.
// The library itself can still be loaded with dynamic import in this worker.
const VERSION = '0.10.32';
const PACKAGE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
let landmarker;

self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      const { FilesetResolver, PoseLandmarker } = await import(`${PACKAGE}/vision_bundle.mjs`);
      const vision = await FilesetResolver.forVisionTasks(`${PACKAGE}/wasm`);
      landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' },
        canvas: new OffscreenCanvas(1, 1),
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false
      });
      self.postMessage({ type: 'ready' });
    } catch (error) {
      self.postMessage({ type: 'error', message: error.message });
    }
    return;
  }

  if (data.type === 'frame') {
    try {
      if (!landmarker) throw new Error('Tracking model is not ready.');
      const result = landmarker.detectForVideo(data.bitmap, data.timestamp);
      self.postMessage({
        type: 'result',
        landmarks: result.landmarks[0] || [],
        sourceWidth: data.sourceWidth,
        sourceHeight: data.sourceHeight
      });
    } catch (error) {
      self.postMessage({ type: 'error', message: error.message });
    } finally {
      data.bitmap.close();
    }
  }
};
