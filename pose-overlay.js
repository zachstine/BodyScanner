import { containRect, drawPose, hasBody } from './pose-drawing.js';

const FRAME_INTERVAL = 1000 / 15;
const STALE_AFTER = 750;

export class PoseOverlay {
  constructor({ video, canvas, onStatus, onRate }) {
    this.video = video;
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.onStatus = onStatus;
    this.onRate = onRate;
    this.enabled = true;
    this.streamAvailable = false;
    this.showBounds = true;
    this.worker = null;
    this.pose = null;
    this.failed = false;
    this.lastStatus = '';
    this.handleVisibility = () => this.reconcile();
    this.handleResize = () => {
      this.clear();
      if (performance.now() - this.lastResultAt < STALE_AFTER) this.draw();
    };
    document.addEventListener('visibilitychange', this.handleVisibility);
    video.addEventListener('resize', this.handleResize);
    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.resizeObserver.observe(canvas);
    this.setStatus('waiting', 'Tracking starts automatically when live video arrives.');
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.failed = false;
    this.reconcile();
  }

  setStreamAvailable(available) {
    this.streamAvailable = available;
    this.reconcile();
  }

  setShowBounds(showBounds) {
    this.showBounds = showBounds;
    this.clear();
    if (performance.now() - this.lastResultAt < STALE_AFTER) this.draw();
  }

  retry() {
    this.failed = false;
    this.reconcile();
  }

  setStatus(state, message) {
    const key = `${state}:${message}`;
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    this.onStatus(state, message);
  }

  reconcile() {
    if (!this.enabled || !this.streamAvailable || document.hidden) {
      this.stopWorker();
      if (!this.enabled) this.setStatus('paused', 'Tracking paused. Live video continues.');
      else if (document.hidden) this.setStatus('paused', 'Tracking pauses while this tab is hidden.');
      else this.setStatus('waiting', 'Waiting for live camera video.');
      return;
    }
    if (!this.worker && !this.failed) this.startWorker();
  }

  startWorker() {
    if (!this.context || !window.Worker || !window.OffscreenCanvas || !window.createImageBitmap) {
      this.fail('Use a current Chrome or Edge browser on the laptop for body tracking.');
      return;
    }
    this.setStatus('loading', 'Loading the body tracking model. The first load may take a moment.');
    try {
      const worker = new Worker(new URL('./pose-worker.js', import.meta.url));
      this.worker = worker;
      this.ready = false;
      this.busy = false;
      this.lastFrameId = -1;
      this.frameSerial = 0;
      this.lastFrameAt = 0;
      this.lastResultAt = 0;
      this.rateStart = performance.now();
      this.frameCount = 0;
      this.loadTimeout = setTimeout(() => {
        this.fail('Model download timed out. Check your connection, then retry tracking.');
      }, 60000);
      worker.onerror = event => {
        if (this.worker !== worker) return;
        event.preventDefault();
        this.fail('Body tracking could not start. Check your connection, then retry tracking.');
      };
      worker.onmessage = ({ data }) => {
        if (this.worker !== worker) return;
        if (data.type === 'ready') {
          clearTimeout(this.loadTimeout);
          this.ready = true;
          this.rateStart = performance.now();
          if (this.video.requestVideoFrameCallback) {
            const watchFrame = (time, metadata) => {
              if (this.worker !== worker) return;
              this.frameSerial = metadata.presentedFrames;
              this.videoFrameCallback = this.video.requestVideoFrameCallback(watchFrame);
            };
            this.videoFrameCallback = this.video.requestVideoFrameCallback(watchFrame);
          }
          this.setStatus('searching', 'Step into view with your full body visible.');
          this.animationFrame = requestAnimationFrame(time => this.tick(time));
        } else if (data.type === 'result') {
          clearTimeout(this.frameTimeout);
          this.busy = false;
          if (data.sourceWidth !== this.video.videoWidth || data.sourceHeight !== this.video.videoHeight) {
            this.pose = null;
            this.clear();
            return;
          }
          this.lastResultAt = performance.now();
          this.pose = hasBody(data.landmarks) ? data.landmarks : null;
          this.clear();
          this.draw();
          this.setStatus(this.pose ? 'tracking' : 'searching', this.pose
            ? 'Body detected. Tracking one person.'
            : 'No body detected. Step into view with your full body visible.');
          this.frameCount++;
          const elapsed = this.lastResultAt - this.rateStart;
          if (elapsed >= 1000) {
            this.onRate(Math.round(this.frameCount * 1000 / elapsed));
            this.frameCount = 0;
            this.rateStart = this.lastResultAt;
          }
        } else if (data.type === 'error') {
          console.warn('Pose tracking:', data.message);
          this.fail('Body tracking is unavailable. Check your internet connection and retry tracking.');
        }
      };
      worker.postMessage({ type: 'init' });
    } catch (error) {
      console.warn('Pose worker:', error);
      this.fail('Body tracking could not start. Retry tracking in Chrome or Edge.');
    }
  }

  tick(time) {
    if (!this.worker || !this.ready) return;
    this.animationFrame = requestAnimationFrame(next => this.tick(next));
    // Clear a frozen pose if the phone stops supplying frames.
    if (this.lastResultAt && time - this.lastResultAt > STALE_AFTER) {
      this.pose = null;
      this.clear();
      this.onRate(null);
      this.setStatus('waiting', 'Waiting for fresh video frames.');
    }
    const frameId = this.video.requestVideoFrameCallback ? this.frameSerial : this.video.currentTime;
    if (this.busy || this.video.paused || this.video.readyState < 2
      || !this.video.videoWidth || !this.video.videoHeight
      || time - this.lastFrameAt < FRAME_INTERVAL
      || (this.video.requestVideoFrameCallback && !frameId)
      || frameId === this.lastFrameId) return;
    this.lastFrameAt = time;
    this.lastFrameId = frameId;
    this.captureFrame(time);
  }

  async captureFrame(timestamp) {
    const worker = this.worker;
    this.busy = true;
    const sourceWidth = this.video.videoWidth;
    const sourceHeight = this.video.videoHeight;
    // Keep only one in-flight frame and cap its size. Slow devices skip frames
    // instead of building a queue of increasingly delayed poses.
    const scale = Math.min(1, 960 / Math.max(sourceWidth, sourceHeight));
    this.frameTimeout = setTimeout(() => {
      this.fail('Tracking stopped responding. Retry tracking to reload the model.');
    }, 10000);
    let bitmap;
    try {
      bitmap = await createImageBitmap(this.video, {
        resizeWidth: Math.max(1, Math.round(sourceWidth * scale)),
        resizeHeight: Math.max(1, Math.round(sourceHeight * scale)),
        resizeQuality: 'low'
      });
      if (this.worker !== worker) {
        bitmap.close();
        return;
      }
      worker.postMessage({ type: 'frame', bitmap, timestamp, sourceWidth, sourceHeight }, [bitmap]);
    } catch (error) {
      bitmap?.close();
      if (this.worker !== worker) return;
      console.warn('Pose frame:', error);
      this.fail('Could not read the video for tracking. Retry tracking after reconnecting the camera.');
    }
  }

  clear() {
    if (!this.context) return;
    const { width, height } = this.canvas.getBoundingClientRect();
    if (!width || !height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    this.context.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0);
    this.context.clearRect(0, 0, width, height);
  }

  draw() {
    if (!this.pose || !this.context) return;
    const { width, height } = this.canvas.getBoundingClientRect();
    const frame = containRect(width, height, this.video.videoWidth, this.video.videoHeight);
    drawPose(this.context, this.pose, frame, this.showBounds);
  }

  fail(message) {
    this.failed = true;
    this.stopWorker();
    this.setStatus('error', message);
  }

  stopWorker() {
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.busy = false;
    cancelAnimationFrame(this.animationFrame);
    if (this.videoFrameCallback !== undefined) {
      this.video.cancelVideoFrameCallback?.(this.videoFrameCallback);
      this.videoFrameCallback = undefined;
    }
    clearTimeout(this.loadTimeout);
    clearTimeout(this.frameTimeout);
    this.pose = null;
    this.lastResultAt = 0;
    this.clear();
    this.onRate(null);
  }

  dispose() {
    this.stopWorker();
    this.resizeObserver.disconnect();
    document.removeEventListener('visibilitychange', this.handleVisibility);
    this.video.removeEventListener('resize', this.handleResize);
  }
}
