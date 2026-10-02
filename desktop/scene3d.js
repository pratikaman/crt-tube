import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// The museum's original scan, including its keyboard, mouse and textures.
// The existing PNG and native player remain untouched in the normal front view.
const canvas = document.getElementById('model-canvas');
const api = window.tube;
let renderer, scene, camera, model, pivot, loading;
let active = false, pointer = null, frame = null, yaw = -.35, pitch = .2;
let maskTarget, maskPixels, disposed = false;
let maskDirty = true, previewTimer, previewGeneration = 0;
const screenCanvas = document.createElement('canvas');
screenCanvas.width = 558; screenCanvas.height = 398;
const screenContext = screenCanvas.getContext('2d');
const screenTexture = new THREE.CanvasTexture(screenCanvas);
screenTexture.colorSpace = THREE.SRGBColorSpace;
const screenUniforms = { tubePicture: { value: screenTexture }, tubePictureVisible: { value: 0 } };

function invalidate(updateMask = true) {
  maskDirty ||= updateMask;
  if (!active || frame !== null || disposed) return;
  frame = requestAnimationFrame(() => {
    frame = null;
    pivot.rotation.set(pitch, yaw, 0, 'YXZ');
    renderer.render(scene, camera);
    canvas.dataset.yaw = yaw.toFixed(3);
    canvas.dataset.pitch = pitch.toFixed(3);
    if (api && maskDirty) {
      maskDirty = false;
      renderer.setRenderTarget(maskTarget); renderer.render(scene, camera);
      renderer.readRenderTargetPixels(maskTarget, 0, 0, 205, 173, maskPixels);
      renderer.setRenderTarget(null);
      const pixels = new Uint8Array(205 * 173);
      for (let y = 0; y < 173; y++) {
        for (let x = 0; x < 205; x++) pixels[y * 205 + x] = maskPixels[((172 - y) * 205 + x) * 4 + 3];
      }
      api.setHitMask({ width: 205, height: 173, pixels });
    }
  });
}

async function load() {
  if (model) return;
  if (loading) return loading;
  loading = (async () => {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(820, 690, false);
    renderer.setClearColor(0, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-.38, .38, .32, -.32, .01, 10);
    camera.position.set(0, 0, 3);
    scene.add(new THREE.HemisphereLight(0xfff8e9, 0x64675e, 2));
    const key = new THREE.DirectionalLight(0xfff3d9, 2.4);
    key.position.set(-1, 2, 2); scene.add(key);
    const fill = new THREE.DirectionalLight(0xd8e8ff, .9);
    fill.position.set(1, .4, -1); scene.add(fill);
    const gltf = await new GLTFLoader().loadAsync('assets/macintosh-plus.glb');
    if (disposed) return;
    model = gltf.scene;
    // Project the picture directly onto the scan's curved glass. Its original
    // geometry and texture remain intact, including when the screen is off.
    model.traverse(object => {
      if (!object.isMesh) return;
      object.material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, screenUniforms);
        shader.vertexShader = `varying vec3 tubePosition; varying vec3 tubeNormal;\n${shader.vertexShader}`
          .replace('#include <begin_vertex>', '#include <begin_vertex>\ntubePosition = position; tubeNormal = normal;');
        shader.fragmentShader = `uniform sampler2D tubePicture; uniform float tubePictureVisible; varying vec3 tubePosition; varying vec3 tubeNormal;\n${shader.fragmentShader}`
          .replace('#include <colorspace_fragment>', `
            vec2 tubeUV = (tubePosition.xy - vec2(-0.098, 0.164)) / vec2(0.190, 0.139);
            vec2 tubeEdge = abs(tubeUV - 0.5) - vec2(0.46, 0.445);
            float tubeDistance = length(max(tubeEdge, 0.0)) + min(max(tubeEdge.x, tubeEdge.y), 0.0) - 0.045;
            float tubeMask = (1.0 - smoothstep(-0.006, 0.002, tubeDistance))
              * step(0.018, tubePosition.z) * step(tubePosition.z, 0.048)
              * smoothstep(0.55, 0.85, tubeNormal.z) * tubePictureVisible;
            gl_FragColor.rgb = mix(gl_FragColor.rgb, texture2D(tubePicture, tubeUV).rgb, tubeMask);
            #include <colorspace_fragment>`);
      };
    });
    const bounds = new THREE.Box3().setFromObject(model);
    model.position.sub(bounds.getCenter(new THREE.Vector3()));
    pivot = new THREE.Group(); pivot.add(model); scene.add(pivot);
    maskTarget = new THREE.WebGLRenderTarget(205, 173);
    maskPixels = new Uint8Array(205 * 173 * 4);
    canvas.dataset.ready = 'true';
  })();
  try { await loading; }
  catch (error) { dispose(); throw error; }
}

function endDrag() {
  if (!pointer) return;
  const id = pointer.id; pointer = null;
  if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  document.body.classList.remove('is-orbiting');
  api?.orbitGesture(false);
}

function dispose() {
  if (disposed) return;
  endDrag(); active = false; disposed = true;
  clearTimeout(previewTimer); previewGeneration++;
  if (frame !== null) cancelAnimationFrame(frame);
  const geometries = new Set(), materials = new Set(), textures = new Set();
  scene?.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : []) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    material.dispose();
  }
  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) { texture.source?.data?.close?.(); texture.dispose(); }
  screenTexture.dispose(); maskTarget?.dispose(); renderer?.dispose();
}

async function updatePreview(generation) {
  if (!active || disposed || generation !== previewGeneration) return;
  try {
    const source = await api?.captureScreen();
    if (source && active && generation === previewGeneration) {
      const image = new Image(); image.src = source; await image.decode();
      if (active && generation === previewGeneration) {
        screenContext.drawImage(image, 0, 0, 558, 398);
        screenTexture.needsUpdate = true; screenUniforms.tubePictureVisible.value = 1;
        canvas.dataset.preview = 'live'; invalidate(false);
      }
    }
  } catch { /* Keep the original glass when a frame is unavailable. */ }
  if (active && !disposed && generation === previewGeneration) previewTimer = setTimeout(() => updatePreview(generation), 166);
}

canvas.addEventListener('pointerdown', event => {
  if (!active || event.button !== 0) return;
  event.preventDefault();
  pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
  document.body.classList.add('is-orbiting'); api?.orbitGesture(true);
});
canvas.addEventListener('pointermove', event => {
  if (!pointer || pointer.id !== event.pointerId) return;
  const scale = document.getElementById('scene').getBoundingClientRect().width / 820;
  yaw += (event.clientX - pointer.x) * .009 / scale;
  pitch = THREE.MathUtils.clamp(pitch + (event.clientY - pointer.y) * .006 / scale, -.5, .85);
  pointer.x = event.clientX; pointer.y = event.clientY;
  invalidate();
});
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(event, endDrag);
canvas.addEventListener('dblclick', () => api?.command('front-view'));
window.addEventListener('blur', endDrag);
canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault(); dispose();
  document.body.classList.remove('is-inspecting');
  api?.setHitMask(null); api?.command('front-view');
});
window.addEventListener('beforeunload', dispose, { once: true });

window.macintosh3D = {
  async prepare() { if (disposed) throw new Error('3D is unavailable.'); await load(); },
  setActive(value) {
    endDrag(); active = value && !!model && !disposed;
    clearTimeout(previewTimer); previewGeneration++;
    screenUniforms.tubePictureVisible.value = 0;
    delete canvas.dataset.preview;
    document.body.classList.toggle('is-inspecting', active);
    canvas.dataset.active = String(active);
    if (active) { yaw = -.35; pitch = .2; invalidate(); void updatePreview(previewGeneration); }
    else { if (frame !== null) cancelAnimationFrame(frame); frame = null; api?.setHitMask(null); }
  },
  turn(key) {
    if (!active) return;
    if (key === 'ArrowLeft') yaw -= .16;
    if (key === 'ArrowRight') yaw += .16;
    if (key === 'ArrowUp') pitch = Math.max(-.5, pitch - .1);
    if (key === 'ArrowDown') pitch = Math.min(.85, pitch + .1);
    if (key === 'Home') { yaw = -.35; pitch = .2; }
    invalidate();
  },
  refresh: invalidate,
};
