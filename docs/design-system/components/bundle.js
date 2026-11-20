/* @ds-bundle: {"format":4,"namespace":"EnvoiLabs","components":[{"name":"Echo"}]} */
(function () {
  "use strict";

  var VERT = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";

  // Raymarched sphere displaced by smooth noise, lit like glossy plastic.
  var FRAG = [
    "precision highp float;",
    "uniform vec2 uRes;uniform float uTime;uniform float uAmp;uniform float uSpeed;uniform float uScale;",
    "uniform vec3 uBody;uniform vec3 uHi;uniform vec3 uRim;uniform vec3 uDeep;",
    "float hash(vec3 p){p=fract(p*0.3183099+.1);p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}",
    "float noise(vec3 x){vec3 i=floor(x);vec3 f=fract(x);f=f*f*(3.0-2.0*f);",
    " return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),",
    "            mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}",
    "float fbm(vec3 p){float a=0.5,s=0.0;for(int i=0;i<2;i++){s+=a*noise(p);p*=2.02;a*=0.5;}return s;}",
    "float map(vec3 p){float t=uTime*uSpeed;",
    " float d=length(p)-uScale;",
    " float n=fbm(p*1.15+vec3(t*0.35,t*0.22,-t*0.18))-0.5;",
    " float w=sin(p.y*2.2+t*1.3)*sin(p.x*1.9-t*0.9)*0.5;",
    " return (d-uAmp*(n*1.4+w*0.4))*0.55;}",
    "vec3 nrm(vec3 p){vec2 e=vec2(0.0025,0.0);",
    " return normalize(vec3(map(p+e.xyy)-map(p-e.xyy),map(p+e.yxy)-map(p-e.yxy),map(p+e.yyx)-map(p-e.yyx)));}",
    "void main(){",
    " vec2 uv=(gl_FragCoord.xy*2.0-uRes)/min(uRes.x,uRes.y);",
    " vec3 ro=vec3(0.0,0.0,3.4);vec3 rd=normalize(vec3(uv,-2.15));",
    " float t=0.0;bool hit=false;",
    " for(int i=0;i<96;i++){vec3 p=ro+rd*t;float d=map(p);if(d<0.0012){hit=true;break;}t+=d;if(t>6.0)break;}",
    " if(!hit){gl_FragColor=vec4(0.0);return;}",
    " vec3 p=ro+rd*t;vec3 n=nrm(p);vec3 v=-rd;",
    " vec3 L=normalize(vec3(-0.55,0.75,0.65));vec3 L2=normalize(vec3(0.8,-0.35,0.4));",
    " float dif=clamp(dot(n,L)*0.6+0.4,0.0,1.0);",
    " float bounce=clamp(dot(n,L2),0.0,1.0);",
    " vec3 h=normalize(L+v);float spec=pow(clamp(dot(n,h),0.0,1.0),70.0);",
    " float spec2=pow(clamp(dot(n,normalize(L2+v)),0.0,1.0),24.0);",
    " float fres=pow(1.0-clamp(dot(n,v),0.0,1.0),2.6);",
    " vec3 col=mix(uDeep,uBody,smoothstep(0.05,0.85,dif));",
    " col=mix(col,uHi,smoothstep(0.55,1.0,dif)*0.55);",
    " col+=uRim*fres*0.85+uRim*bounce*0.18;",
    " col+=vec3(1.0)*spec*0.9+uHi*spec2*0.25;",
    " gl_FragColor=vec4(col,1.0);",
    "}"
  ].join("\n");

  function hexToRgb(hex, fallback) {
    var h = (hex || "").trim().replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length !== 6) return fallback;
    return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
  }

  function tokenColor(el, name, fallback) {
    return hexToRgb(getComputedStyle(el).getPropertyValue("--" + name), fallback);
  }

  var STATES = {
    idle:   { amp: 0.08, speed: 0.55, scale: 0.92 },
    listen: { amp: 0.15, speed: 1.6,  scale: 0.97 },
    think:  { amp: 0.12, speed: 2.6,  scale: 0.92 },
    sent:   { amp: 0.04, speed: 0.4,  scale: 0.94 },
    payout: { amp: 0.12, speed: 0.8,  scale: 0.95 }
  };

  /**
   * Mounts the Echo into a host element.
   * opts.state: idle | listen | think | sent | payout
   * opts.level(): optional function returning mic level 0..1 while listening
   * Returns { setState(name), destroy() }
   */
  function mountEcho(host, opts) {
    opts = opts || {};
    host.classList.add("ev-echo");
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var shadow = document.createElement("div");
    shadow.className = "ev-echo-shadow";
    var canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    host.appendChild(shadow);
    host.appendChild(canvas);

    var gl = canvas.getContext("webgl", { premultipliedAlpha: false, alpha: true, antialias: true });
    if (!gl) {
      host.removeChild(canvas);
      var fb = document.createElement("div");
      fb.className = "ev-echo-fallback";
      host.appendChild(fb);
      return { setState: function () {}, destroy: function () { host.innerHTML = ""; } };
    }

    function sh(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); }
      return s;
    }
    var prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var U = {};
    ["uRes", "uTime", "uAmp", "uSpeed", "uScale", "uBody", "uHi", "uRim", "uDeep"].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });

    var stateName = STATES[opts.state] ? opts.state : "idle";
    var cur = { amp: STATES[stateName].amp, speed: STATES[stateName].speed, scale: STATES[stateName].scale };
    var start = performance.now(), last = start, simLevel = 0, raf = 0, visible = true, flash = 0;

    function palette() {
      var body = tokenColor(host, "pulse", [1, 0.31, 0.55]);
      var zest = tokenColor(host, "zest", [0.83, 0.96, 0.35]);
      var b = stateName === "payout" ? [body[0] * (1 - flash) + zest[0] * flash, body[1] * (1 - flash) + zest[1] * flash, body[2] * (1 - flash) + zest[2] * flash] : body;
      gl.uniform3fv(U.uBody, b);
      gl.uniform3fv(U.uHi, [1.0, 0.78, 0.62]);
      gl.uniform3fv(U.uRim, [0.72, 0.66, 1.0]);
      gl.uniform3fv(U.uDeep, [b[0] * 0.46, b[1] * 0.16, b[2] * 0.36]);
    }

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(U.uRes, w, h);
    }

    function frame(now) {
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      var target = STATES[stateName];
      var amp = target.amp, scale = target.scale;
      if (stateName === "listen") {
        var lvl = typeof opts.level === "function" ? opts.level() : null;
        if (lvl == null) { simLevel += ((Math.random() < 0.08 ? Math.random() : simLevel * 0.9) - simLevel) * 0.25; lvl = simLevel; }
        amp += lvl * 0.12; scale += lvl * 0.04;
      }
      if (stateName === "idle") { scale += Math.sin(now / 1000 * (Math.PI * 2 / 6)) * 0.02; }
      if (stateName === "payout") { flash = 0.5 + 0.5 * Math.sin(now / 1000 * 2.2); }
      var k = 1 - Math.exp(-dt * 8);
      cur.amp += (amp - cur.amp) * k; cur.speed += (target.speed - cur.speed) * k; cur.scale += (scale - cur.scale) * k;
      resize(); palette();
      gl.uniform1f(U.uTime, (now - start) / 1000);
      gl.uniform1f(U.uAmp, cur.amp);
      gl.uniform1f(U.uSpeed, cur.speed);
      gl.uniform1f(U.uScale, cur.scale);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (!reduce && visible && !document.hidden) raf = requestAnimationFrame(frame); else raf = 0;
    }

    function kick() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
    var io = "IntersectionObserver" in window ? new IntersectionObserver(function (e) { visible = e[0].isIntersecting; if (visible) kick(); }) : null;
    if (io) io.observe(host);
    document.addEventListener("visibilitychange", kick);
    kick();

    return {
      setState: function (n) { if (STATES[n]) { stateName = n; kick(); } },
      destroy: function () { cancelAnimationFrame(raf); if (io) io.disconnect(); document.removeEventListener("visibilitychange", kick); host.innerHTML = ""; }
    };
  }

  window.EnvoiLabs = window.EnvoiLabs || {};
  window.EnvoiLabs.Echo = mountEcho;
  window.EnvoiLabs.mountEcho = mountEcho;
})();
