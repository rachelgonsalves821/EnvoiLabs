import type { EchoState } from "./echo";

export type EchoRenderer = {
  start: (reducedMotion: boolean) => void;
  stop: () => void;
  setState: (state: EchoState) => void;
  redraw: () => void;
  dispose: () => void;
};

const vertex = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const fragment = `
precision mediump float;
varying vec2 v_uv;
uniform float u_time;
uniform float u_elapsed;
uniform float u_state;
uniform float u_level;
void main() {
  vec2 p = (v_uv - 0.5) * 2.0;
  float r = length(p);
  float listen = step(0.5, u_state) * (1.0 - step(1.5, u_state));
  float think = step(1.5, u_state) * (1.0 - step(2.5, u_state));
  float sent = step(2.5, u_state) * (1.0 - step(3.5, u_state));
  float payout = step(3.5, u_state);
  float breathe = sin(u_time * 1.0472) * 0.012;
  float ripple = sin(r * 20.0 - u_time * 11.0) * 0.022 * listen * (0.3 + u_level);
  float wobble = sin(p.x * 13.0 + u_time * 3.0) *
    sin(p.y * 11.0 - u_time * 2.3) * (0.018 + think * 0.024);
  float settle = 1.0 + sent * 0.05 * (1.0 - smoothstep(0.0, 0.32, u_elapsed));
  float radius = (0.92 + breathe + ripple + wobble) * (1.0 + listen * 0.06) * settle;
  if (r > radius) discard;
  vec2 sphere = p / radius;
  float z = sqrt(max(0.0, 1.0 - dot(sphere, sphere)));
  vec3 normal = normalize(vec3(sphere.x + wobble * 2.0, sphere.y - wobble * 1.5, z));
  vec3 light = normalize(vec3(-0.48, 0.62, 0.78));
  float diffuse = max(dot(normal, light), 0.0);
  float specular = pow(max(dot(reflect(-light, normal), vec3(0.0, 0.0, 1.0)), 0.0), 20.0);
  float rim = pow(1.0 - z, 2.4);
  vec3 shade = vec3(1.0, 0.31, 0.55) * (0.42 + 0.48 * diffuse);
  shade += vec3(1.0, 0.77, 0.65) * specular * 0.72;
  shade += vec3(0.58, 0.46, 0.87) * rim * 0.52;
  shade = mix(shade, vec3(0.83, 0.96, 0.35), payout * exp(-u_elapsed * 8.0));
  gl_FragColor = vec4(shade, 1.0);
}`;

const stateIndex: Record<EchoState, number> = {
  idle: 0, listen: 1, think: 2, sent: 3, payout: 4,
};

function shader(gl: WebGLRenderingContext, type: number, source: string) {
  const result = gl.createShader(type);
  if (!result) throw new Error("Echo shader unavailable");
  gl.shaderSource(result, source);
  gl.compileShader(result);
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
    gl.deleteShader(result);
    throw new Error("Echo shader failed");
  }
  return result;
}

export function createEchoRenderer(canvas: HTMLCanvasElement, initial: EchoState,
  level: () => number): EchoRenderer | null {
  let gl: WebGLRenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let geometry: WebGLBuffer | null = null;
  let vertexShader: WebGLShader | null = null;
  let fragmentShader: WebGLShader | null = null;
  try {
    gl = canvas.getContext("webgl", { alpha: true, antialias: true,
      powerPreference: "low-power" });
    if (!gl) return null;
    vertexShader = shader(gl, gl.VERTEX_SHADER, vertex);
    fragmentShader = shader(gl, gl.FRAGMENT_SHADER, fragment);
    program = gl.createProgram();
    if (!program) throw new Error("Echo program unavailable");
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error("Echo program failed");
    geometry = gl.createBuffer();
    if (!geometry) throw new Error("Echo geometry unavailable");
  } catch {
    if (gl && geometry) gl.deleteBuffer(geometry);
    if (gl && program) gl.deleteProgram(program);
    if (gl && vertexShader) gl.deleteShader(vertexShader);
    if (gl && fragmentShader) gl.deleteShader(fragmentShader);
    return null;
  }
  const context = gl;
  const linked = program;
  const buffer = geometry;
  context.bindBuffer(context.ARRAY_BUFFER, buffer);
  context.bufferData(context.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), context.STATIC_DRAW);
  context.useProgram(linked);
  const position = context.getAttribLocation(linked, "a_position");
  context.enableVertexAttribArray(position);
  context.vertexAttribPointer(position, 2, context.FLOAT, false, 0, 0);
  const time = context.getUniformLocation(linked, "u_time");
  const elapsed = context.getUniformLocation(linked, "u_elapsed");
  const stateLocation = context.getUniformLocation(linked, "u_state");
  const amplitude = context.getUniformLocation(linked, "u_level");
  let state = initial;
  let changedAt = performance.now();
  let frame = 0;
  let running = false;
  let active = false;
  let reduced = false;
  let lost = false;
  const draw = (now: number) => {
    if (lost) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.viewport(0, 0, width, height);
    context.clearColor(0, 0, 0, 0);
    context.clear(context.COLOR_BUFFER_BIT);
    context.uniform1f(time, reduced ? 0 : now / 1000);
    context.uniform1f(elapsed, reduced ? (state === "payout" ? 0 : 1) : (now - changedAt) / 1000);
    context.uniform1f(stateLocation, stateIndex[state]);
    context.uniform1f(amplitude, Math.max(0, Math.min(1, level())));
    context.drawArrays(context.TRIANGLE_STRIP, 0, 4);
  };
  const tick = (now: number) => {
    if (!running) return;
    draw(now);
    frame = requestAnimationFrame(tick);
  };
  const cancelLoop = () => {
    running = false;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };
  const stop = () => { active = false; cancelLoop(); };
  const onLost = (event: Event) => {
    event.preventDefault();
    lost = true;
    stop();
    canvas.style.visibility = "hidden";
  };
  canvas.addEventListener("webglcontextlost", onLost);
  return {
    start(reducedMotion) {
      if (lost) return;
      active = true;
      reduced = reducedMotion;
      if (reduced) { cancelLoop(); draw(performance.now()); }
      else if (!running) { running = true; frame = requestAnimationFrame(tick); }
    },
    stop,
    setState(next) {
      if (next === state) return;
      state = next;
      changedAt = performance.now();
      if (active && reduced) draw(changedAt);
    },
    redraw() { if (active && reduced) draw(performance.now()); },
    dispose() {
      stop();
      canvas.removeEventListener("webglcontextlost", onLost);
      context.deleteBuffer(buffer);
      context.deleteProgram(linked);
      context.deleteShader(vertexShader);
      context.deleteShader(fragmentShader);
    },
  };
}
