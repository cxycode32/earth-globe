import * as THREE from "three";
import Stats from "three/examples/jsm/libs/stats.module";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GUI } from "lil-gui";
import { locations } from "./locations.js";
import { runApp, updateLoadingProgressBar } from "./utils/core-utils";
import { loadTexture } from "./utils/common-utils";
import vertexShader from './shaders/vertex.glsl?raw';
import fragmentShader from './shaders/fragment.glsl?raw';
import "./styles/styles.css";

/* =========================
   Asset constants & params
   ========================= */
const TEXTURE_ALBEDO = "/assets/earth_albedo.jpg";
const TEXTURE_BUMP = "/assets/earth_bump.jpg";
const TEXTURE_CLOUDS = "/assets/earth_clouds.png";
const TEXTURE_OCEAN_MASK = "/assets/earth_ocean_mask.png";
const TEXTURE_NIGHT_LIGHTS = "/assets/earth_night_lights.png";
const TEXTURE_STARFIELD = "/assets/gaia_sky_dark.png";

const params = {
    sunIntensity: 2.0,
    rotationSpeed: 2.0,
    metalness: 0.2,
    atmosphereOpacity: { value: 0.5 },
    atmospherePower: { value: 1 },
    atmosphereStrength: { value: 2 },
};

const globeContainer = document.getElementById("globe");
const pinsContainer = document.getElementById("pins");
const fallbackContainer = document.getElementById("fallback");
const fallbackLinks = document.getElementById("fallback-links");

/* =========================
   Utilities
   ========================= */
function createFallbackLinks() {
    fallbackLinks.innerHTML = "";
    locations.forEach((loc) => {
        const a = document.createElement("a");
        a.href = loc.branch_url;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = loc.location_name;
        fallbackLinks.appendChild(a);
    });
}

async function loadAllTextures(list) {
    const out = {};
    for (const [key, url] of Object.entries(list)) {
        try {
            out[key] = await loadTexture(url);
            // color-space tagging for albedo-like textures
            if (key === "albedo" && out[key]) {
                if ("colorSpace" in out[key]) out[key].colorSpace = THREE.SRGBColorSpace;
                else if ("encoding" in out[key]) out[key].encoding = THREE.sRGBEncoding;
            }
        } catch (err) {
            console.warn(`Texture load failed (${key}):`, err);
            out[key] = null;
        }
    }
    return out;
}

function latLonToVector3(lat, lon, r) {
    const phi = THREE.MathUtils.degToRad(90 - lat);
    const theta = THREE.MathUtils.degToRad(lon + 180);
    const x = -r * Math.sin(phi) * Math.cos(theta);
    const z = r * Math.sin(phi) * Math.sin(theta);
    const y = r * Math.cos(phi);
    return new THREE.Vector3(x, y, z);
}

/* =========================
   Boot (check WebGL) + fallback
   ========================= */
createFallbackLinks();

const canUseWebGL = (() => {
    try {
        const canvas = document.createElement("canvas");
        return !!(
            window.WebGLRenderingContext &&
            (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
        );
    } catch (e) {
        return false;
    }
})();

if (!canUseWebGL || !THREE) {
    fallbackContainer.style.display = "block";
    console.warn("WebGL not available — showing fallback links.");
} else {
    fallbackContainer.style.display = "none";
    init();
}

/* =========================
   Main init
   ========================= */
async function init() {
    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    THREE.ColorManagement.enabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.useLegacyLights = false;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 2.5;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.background = "transparent";
    renderer.domElement.style.zIndex = "5";

    // Scene + Camera
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
        45,
        window.innerWidth / window.innerHeight,
        1,
        1000
    );
    camera.position.set(0, 0, 30);

    // Lights
    const dirLight = new THREE.DirectionalLight(0xffffff, params.sunIntensity);
    dirLight.position.set(-50, 0, 30);
    scene.add(dirLight);

    const ambient = new THREE.AmbientLight(0xffffff, 0.15);
    scene.add(ambient);

    // Hemisphere light for subtle sky->ground fill (gives natural color on dark side)
    const hemi = new THREE.HemisphereLight(0x87baf7, 0x2b2b2b, 0.15); // (skyColor, groundColor, intensity)
    scene.add(hemi);

    await updateLoadingProgressBar(0.1);

    // Load textures (batched helper)
    const textures = await loadAllTextures({
        albedo: TEXTURE_ALBEDO,
        bump: TEXTURE_BUMP,
        clouds: TEXTURE_CLOUDS,
        oceanMask: TEXTURE_OCEAN_MASK,
        nightLights: TEXTURE_NIGHT_LIGHTS,
        starfield: TEXTURE_STARFIELD,
    });
    await updateLoadingProgressBar(0.8);

    let atmosGeo = new THREE.SphereGeometry(12.5, 64, 64)
    let atmosMat = new THREE.ShaderMaterial({
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        uniforms: {
            atmOpacity: params.atmosphereOpacity,
            atmPowFactor: params.atmospherePower,
            atmMultiplier: params.atmosphereStrength
        },
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
    })
    const atmos = new THREE.Mesh(atmosGeo, atmosMat)

    // Environment background
    if (textures.starfield) {
        textures.starfield.mapping = THREE.EquirectangularReflectionMapping;
        scene.background = textures.starfield;
    }

    // Earth + layers
    const radius = 10;
    const group = new THREE.Group();
    group.rotation.z = THREE.MathUtils.degToRad(23.5);
    scene.add(group);
    group.add(atmos)

    const earthGeo = new THREE.SphereGeometry(radius, 64, 64);
    const earthMat = new THREE.MeshStandardMaterial({
        map: textures.albedo || null,
        bumpMap: textures.bump || null,
        bumpScale: 0.03,
        roughnessMap: textures.oceanMask || null,
        metalness: params.metalness,
        metalnessMap: textures.oceanMask || null,
        emissiveMap: textures.nightLights || null,
        emissive: new THREE.Color(0xffff88),
    });
    const earth = new THREE.Mesh(earthGeo, earthMat);
    earth.rotateY(-0.3);
    group.add(earth);

    const cloudGeo = new THREE.SphereGeometry(10.05, 64, 64);
    const cloudsMat = new THREE.MeshStandardMaterial({
        alphaMap: textures.clouds || null,
        transparent: true,
    });
    const clouds = new THREE.Mesh(cloudGeo, cloudsMat);
    clouds.rotateY(-0.3);
    group.add(clouds);

    // Inject custom shader logic into the standard material (cloud shadows + atmosphere extras)
    earthMat.onBeforeCompile = function (shader) {
        // Add uniforms we need
        shader.uniforms.tClouds = { value: textures.clouds };
        shader.uniforms.tClouds.value.wrapS = THREE.RepeatWrapping;
        shader.uniforms.uv_xOffset = { value: 0 };

        // Insert uniform declarations near common include
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `
                #include <common>
                uniform sampler2D tClouds;
                uniform float uv_xOffset;
            `
        );

        // Safely extend emissive logic (use unique variable names)
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <emissivemap_fragment>',
            `
                #include <emissivemap_fragment>

                #ifdef USE_EMISSIVEMAP
                    vec4 emissiveColor_custom = texture2D(emissiveMap, vEmissiveMapUv);
                    emissiveColor_custom *= 1.0 - smoothstep(-0.02, 0.0, dot(geometryNormal, directionalLights[0].direction));
                    totalEmissiveRadiance *= emissiveColor_custom.rgb;
                #endif

                float cloudsMapValue = texture2D(tClouds, vec2(vMapUv.x - uv_xOffset, vMapUv.y)).r;
                diffuseColor.rgb *= max(1.0 - cloudsMapValue, 0.2);

                float intensity = 1.4 - dot(geometryNormal, vec3(0.0, 0.0, 1.0));
                vec3 atmosphere = vec3(0.3, 0.6, 1.0) * pow(intensity, 5.0);
                diffuseColor.rgb += atmosphere;
            `
        );

        // Tweak roughness to use ocean mask inverted (keeps original idea; uses custom name)
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <roughnessmap_fragment>',
            `
                float roughnessFactor = roughness;

                #ifdef USE_ROUGHNESSMAP
                    vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
                    texelRoughness = vec4(1.0) - texelRoughness;
                    roughnessFactor *= clamp(texelRoughness.g, 0.5, 1.0);
                #endif
            `
        );

        earthMat.userData.shader = shader;
    };

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = radius * 1.2;
    controls.maxDistance = radius * 3.5;
    controls.dampingFactor = 0.08;

    // GUI (binds live to objects / params)
    const gui = new GUI();
    gui.add(params, "sunIntensity", 0.0, 5.0, 0.1)
        .name("Sun Intensity")
        .onChange((v) => (dirLight.intensity = v));
    gui.add(params, "rotationSpeed", 0.1, 20.0, 0.1).name("Rotation Speed");
    gui.add(params, "metalness", 0.0, 1.0, 0.05)
        .name("Ocean Metalness")
        .onChange((v) => (earthMat.metalness = v));
    gui.add(params.atmosphereOpacity, "value", 0.0, 1.0, 0.05).name("Atmos Opacity");
    gui.add(params.atmospherePower, "value", 0.0, 20.0, 0.1).name("Atmos Power Factor");
    gui.add(params.atmosphereStrength, "value", 0.0, 20.0, 0.1).name("Atmos Multiplier");

    // Stats
    const stats = new Stats();
    stats.showPanel(0);
    stats.domElement.style.cssText = "position:absolute;top:0px;left:0px;";
    globeContainer.appendChild(stats.domElement);

    /* =========================
     Pins creation & placement
     ========================= */
    const pinObjects = [];

    locations.forEach((loc) => {
        const a = document.createElement("a");
        a.className = "pin";
        a.href = loc.branch_url;
        a.target = "_blank";
        a.rel = "noopener";
        a.setAttribute("aria-label", `${loc.location_name} branch — opens in a new tab`);
        a.setAttribute("title", `${loc.location_name} — click to open branch`);
        a.dataset.id = loc.id;

        // style wrapper so it can be positioned exactly where dot center should be
        a.style.position = "absolute";
        a.style.width = "0";
        a.style.height = "0";

        const dot = document.createElement("span");
        dot.className = "dot";
        dot.setAttribute("aria-hidden", "true");

        const label = document.createElement("span");
        label.className = "label";
        label.innerHTML = `${loc.location_name}`;

        a.appendChild(dot);
        a.appendChild(label);
        pinsContainer.appendChild(a);

        let pointerDownPos = null;
        a.addEventListener("pointerdown", (ev) => (pointerDownPos = { x: ev.clientX, y: ev.clientY }));
        a.addEventListener("pointerup", (ev) => {
            if (pointerDownPos) {
                const dist = Math.hypot(
                    ev.clientX - pointerDownPos.x,
                    ev.clientY - pointerDownPos.y
                );
                if (dist > 6) {
                    ev.preventDefault();
                    ev.stopPropagation();
                }
            }
            pointerDownPos = null;
        });

        pinObjects.push({
            loc,
            el: a,
            spherePos: latLonToVector3(loc.latitude, loc.longitude, radius),
        });
    });

    function updatePins() {
        if (!pinObjects.length) return;
        const canvasRect = renderer.domElement.getBoundingClientRect();
        const pinsRect = pinsContainer.getBoundingClientRect();
        const tempV = new THREE.Vector3();
        const camNorm = new THREE.Vector3();
        camNorm.copy(camera.position).normalize();

        pinObjects.forEach((obj) => {
            tempV.copy(obj.spherePos).applyMatrix4(earth.matrixWorld);

            // occlusion test (dot with camera direction)
            const visible = tempV.clone().normalize().dot(camNorm) > 0.02;
            if (!visible) {
                obj.el.style.opacity = "0";
                obj.el.style.pointerEvents = "none";
                return;
            }
            obj.el.style.opacity = "1";
            obj.el.style.pointerEvents = "auto";

            const proj = tempV.clone().project(camera);
            const canvasX = ((proj.x + 1) / 2) * canvasRect.width + canvasRect.left;
            const canvasY = ((-proj.y + 1) / 2) * canvasRect.height + canvasRect.top;
            const localX = canvasX - pinsRect.left;
            const localY = canvasY - pinsRect.top;

            const distance = camera.position.distanceTo(tempV);
            const scale = Math.max(0.7, Math.min(1.4, (radius * 2.8) / distance));

            obj.el.style.left = `${Math.round(localX)}px`;
            obj.el.style.top = `${Math.round(localY)}px`;
            obj.el.style.transform = `scale(${scale})`;
        });
    }

    /* =========================
     Window resize / lifecycle
     ========================= */
    function onResize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        updatePins();
    }
    window.addEventListener("resize", onResize, { passive: true });
    onResize();

    /* =========================
     App loop object (passed to runApp)
     ========================= */
    const userApp = {
        container: globeContainer,
        async initScene() {
            await updateLoadingProgressBar(1.0, 100);
        },
        updateScene(delta /* seconds */, elapsed /* seconds */) {
            // controls/stats + rotations
            controls.update();
            stats.update();

            earth.rotateY(delta * 0.005 * params.rotationSpeed);
            clouds.rotateY(delta * 0.01 * params.rotationSpeed);

            // advance cloud uv offset on the compiled shader
            const shader = earth.material.userData.shader;
            if (shader) {
                let offset = (delta * 0.005 * params.rotationSpeed) / (2 * Math.PI);
                shader.uniforms.uv_xOffset.value += offset % 1;
            }

            updatePins();
        },
        onResize(w, h) {
            updatePins();
        },
    };

    // start loop (runApp will append renderer.domElement to the globe container)
    runApp(userApp, scene, renderer, camera, true, undefined, undefined);
}
