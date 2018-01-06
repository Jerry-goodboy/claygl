
/**
 * Helpers for creating a common 3d application.
 * @namespace clay.application
 */

 // TODO loadModel, createLight, geoCache, Shadow, RayPicking and event.
import Renderer from './Renderer';
import Scene from './Scene';
import Timeline from './animation/Timeline';
import CubeGeo from './geometry/Cube';
import SphereGeo from './geometry/Sphere';
import PlaneGeo from './geometry/Plane';
import CylinderGeo from './geometry/Cylinder';
import Texture2D from './Texture2D';
import Texture from './Texture';
import shaderLibrary from './shader/library';
import Mesh from './Mesh';
import Material from './Material';
import PerspectiveCamera from './camera/Perspective';
import OrthographicCamera from './camera/Orthographic';
import Vector3 from './math/Vector3';
import GLTFLoader from './loader/GLTF';
import Node from './Node';

import './shader/builtin';

/**
 * @constructor
 * @alias clay.application.App3D
 * @param {HTMLDomElement|string} dom Container dom element or a selector string that can be used in `querySelector`
 * @param {Object} appNS
 * @param {Function} init Initialization callback that will be called when initing app.
 * @param {Function} loop Loop callback that will be called each frame.
 * @param {number} [width] Container width.
 * @param {number} [height] Container height.
 * @param {number} [devicePixelRatio]
 *
 */
function App3D(dom, appNS) {

    appNS = appNS || {};

    if (typeof dom === 'string') {
        dom = document.querySelector(dom);
    }

    if (!dom) {
        throw new Error('Invalid dom');
    }

    var isDomCanvas = dom.nodeName.toUpperCase() === 'CANVAS';
    var rendererOpts = {};
    if (isDomCanvas) {
        rendererOpts.canvas = dom;
    }
    if (appNS.devicePixelRatio) {
        rendererOpts.devicePixelRatio = appNS.devicePixelRatio;
    }

    var gRenderer = new Renderer(rendererOpts);
    var gWidth = appNS.width || dom.clientWidth;
    var gHeight = appNS.height || dom.clientHeight;

    if (!isDomCanvas) {
        dom.appendChild(gRenderer.canvas);
    }
    gRenderer.resize(gWidth, gHeight);

    var gScene = new Scene();
    var gTimeline = new Timeline();
    var gFrameTime = 0;
    var gElapsedTime = 0;

    gTimeline.start();

    Object.defineProperties(this, {
        /**
         * Container dom element
         * @name clay.application.App3D#container
         * @type {HTMLDomElement}
         */
        container: { get: function () { return dom; } },
        /**
         * @name clay.application.App3D#renderer
         * @type {clay.Renderer}
         */
        renderer: { get: function () { return gRenderer; }},
        /**
         * @name clay.application.App3D#scene
         * @type {clay.Renderer}
         */
        scene: { get: function () { return gScene; }},
        /**
         * @name clay.application.App3D#timeline
         * @type {clay.Renderer}
         */
        timeline: { get: function () { return gTimeline; }},
        /**
         * Time elapsed since last frame. Can be used in loop to calculate the movement.
         * @name clay.application.App3D#frameTime
         * @type {number}
         */
        frameTime: { get: function () { return gFrameTime; }},
        /**
         * Time elapsed since application created.
         * @name clay.application.App3D#elapsedTime
         * @type {number}
         */
        elapsedTime: { get: function () { return gElapsedTime; }}
    });

    /**
     * Resize the application. Will use the container clientWidth/clientHeight if width/height in parameters are not given.
     * @method
     * @memberOf {clay.application.App3D}
     * @param {number} [width]
     * @param {number} [height]
     */
    this.resize = function (width, height) {
        gWidth = width || appNS.width || dom.clientWidth;
        gHeight = height || dom.height || dom.clientHeight;
        gRenderer.resize(gWidth, gHeight);
    };

    this.dispose = function () {
        if (appNS.dispose) {
            appNS.dispose(this);
        }
        gTimeline.stop();
        gRenderer.disposeScene(gScene);
        dom.innerHTML = '';
    };

    appNS.init && appNS.init(this);

    var gTexturesList = {};
    var gGeometriesList = {};

    if (appNS.loop) {
        gTimeline.on('frame', function (frameTime) {
            gFrameTime = frameTime;
            gElapsedTime += frameTime;
            appNS.loop(this);

            this._doRender(gRenderer, gScene);

            // Mark all resources unused;
            markUsed(gTexturesList);
            markUsed(gGeometriesList);

            // Collect resources used in this frame.
            var newTexturesList = [];
            var newGeometriesList = [];
            this._collectResources(newTexturesList, newGeometriesList);

            // Dispose those unsed resources.
            checkAndDispose(this.renderer, gTexturesList);
            checkAndDispose(this.renderer, gGeometriesList);

            gTexturesList = newTexturesList;
            gGeometriesList = newGeometriesList;
        }, this);
    }
}

function isImageLikeElement(val) {
    return val instanceof Image
        || val instanceof HTMLCanvasElement
        || val instanceof HTMLVideoElement;
}

App3D.prototype._doRender = function (renderer, scene) {
    var camera = scene.getMainCamera();
    camera.aspect = renderer.getViewportAspect();
    renderer.render(scene);
};


function markUsed(resourceList) {
    for (var i = 0; i < resourceList.length; i++) {
        resourceList[i].__used__ = 0;
    }
}

function checkAndDispose(renderer, resourceList) {
    for (var i = 0; i < resourceList.length; i++) {
        if (!resourceList[i].__used__) {
            resourceList[i].dispose(renderer);
        }
    }
}

function updateUsed(resource, list) {
    list.push(resource);
    resource.__used__ = resource.__used__ || 0;
    resource.__used__++;
}
App3D.prototype._collectResources = function (textureResourceList, geometryResourceList) {

    function trackQueue(queue) {
        for (var i = 0; i < queue.length; i++) {
            var renderable = queue[i];
            var geometry = renderable.geometry;
            var material = renderable.material;
            updateUsed(geometry, geometryResourceList);

            for (var name in material.uniforms) {
                var val = material.uniforms[name].value;
                if (val instanceof Texture) {
                    updateUsed(val, textureResourceList);
                }
                else if (val instanceof Array) {
                    for (var k = 0; k < val.length; k++) {
                        if (val[k] instanceof Texture) {
                            updateUsed(val[k], textureResourceList);
                        }
                    }
                }
            }
        }
    }

    var scene = this.scene;

    trackQueue(scene.opaqueList);
    trackQueue(scene.transparentList);

    for (var k = 0; k < scene.lights.length; k++) {
        // Track AmbientCubemap
        if (scene.lights[k].cubemap) {
            updateUsed(scene.lights[k].cubemap, textureResourceList);
        }
    }

};
/**
 * Load a texture from image or string.
 * @param {string|HTMLCanvasElement|HTMLImageElement|HTMLVideoElement} img
 * @param {Object} [opts] Texture options.
 * @param {boolean} [opts.flipY=true] If flipY. See {@link clay.Texture.flipY}
 * @param {number} [opts.anisotropic] Anisotropic filtering. See {@link clay.Texture.anisotropic}
 * @param {number} [opts.wrapS=clay.Texture.REPEAT] See {@link clay.Texture.wrapS}
 * @param {number} [opts.wrapT=clay.Texture.REPEAT] See {@link clay.Texture.wrapT}
 * @param {number} [opts.minFilter=clay.Texture.LINEAR_MIPMAP_LINEAR] See {@link clay.Texture.minFilter}
 * @param {number} [opts.magFilter=clay.Texture.LINEAR] See {@link clay.Texture.magFilter}
 * @return {Promise}
 * @example
 *  app.loadTexture('diffuseMap.jpg')
 *      .then(function (texture) {
 *          material.set('diffuseMap', texture);
 *      });
 */
App3D.prototype.loadTexture = function (urlOrImg, opts) {
    var self = this;
    // TODO Promise ?
    return new Promise(function (resolve, reject) {
        var texture = self.loadTextureSync(urlOrImg, opts);
        if (!texture.isRenderable()) {
            texture.success(function () {
                resolve(texture);
            });
            texture.error(function () {
                reject();
            });
        }
        else {
            resolve(texture);
        }
    });
};

/**
 * Create a texture from image or string synchronously. Texture can be use directly and don't have to wait for it's loaded.
 * @param {string|HTMLCanvasElement|HTMLImageElement|HTMLVideoElement} img
 * @param {Object} [opts] Texture options.
 * @param {boolean} [opts.flipY=true] If flipY. See {@link clay.Texture.flipY}
 * @param {number} [opts.anisotropic] Anisotropic filtering. See {@link clay.Texture.anisotropic}
 * @param {number} [opts.wrapS=clay.Texture.REPEAT] See {@link clay.Texture.wrapS}
 * @param {number} [opts.wrapT=clay.Texture.REPEAT] See {@link clay.Texture.wrapT}
 * @param {number} [opts.minFilter=clay.Texture.LINEAR_MIPMAP_LINEAR] See {@link clay.Texture.minFilter}
 * @param {number} [opts.magFilter=clay.Texture.LINEAR] See {@link clay.Texture.magFilter}
 * @return {Promise}
 * @example
 *  var texture = app.loadTexture('diffuseMap.jpg', {
 *      anisotropic: 8,
 *      flipY: false
 *  });
 *  material.set('diffuseMap', texture);
 */
App3D.prototype.loadTextureSync = function (urlOrImg, opts) {
    var texture = new Texture2D(opts);
    if (typeof urlOrImg === 'string') {
        texture.load(urlOrImg);
    }
    else if (isImageLikeElement(urlOrImg)) {
        texture.image = urlOrImg;
        texture.dynamic = urlOrImg instanceof HTMLVideoElement;
    }
    return texture;
};

/**
 * Create a material.
 * @param {Object} materialConfig. materialConfig contains `shader`, `transparent` and uniforms that used in corresponding uniforms.
 *                                 Uniforms can be `color`, `alpha` `diffuseMap` etc.
 * @param {string} [shader='clay.standard']
 * @param {boolean} [transparent=false] If material is transparent.
 * @return {clay.Material}
 */
App3D.prototype.createMaterial = function (matConfig) {
    matConfig = matConfig || {};
    matConfig.shader = matConfig.shader || 'clay.standard';
    var material = new Material({
        shader: shaderLibrary.get(matConfig.shader)
    });
    function makeTextureSetter(key) {
        return function (texture) {
            material.setUniform(key, texture);
        };
    }
    for (var key in matConfig) {
        if (material.uniforms[key]) {
            var val = matConfig[key];
            if (material.uniforms[key].type === 't' || isImageLikeElement(val)) {
                // Try to load a texture.
                this.loadTexture(val).then(makeTextureSetter(key));
            }
            else {
                material.setUniform(key, val);
            }
        }
    }

    if (matConfig.transparent) {
        matConfig.depthMask = false;
        matConfig.transparent = true;
    }
    return material;
};

function makeProceduralMeshCreator(createGeo) {
    return function (size, mat) {
        var mesh = new Mesh({
            geometry: createGeo(size),
            material: mat instanceof Material ? mat : this.createMaterial(mat)
        });
        this.scene.add(mesh);
        return mesh;
    };
}

/**
 * Create a cube mesh and add it to the scene.
 * @method
 * @param {Array.<number>|number} [size=1] Cube size. Can be a number to represent both width, height and depth. Or an array to represent them respectively.
 * @param {Object|clay.Material} [material]
 * @return {clay.Mesh}
 * @example
 *  // Create a 2 width, 1 height, 3 depth white cube.
 *  app.createCube([2, 1, 3])
 */
App3D.prototype.createCube = makeProceduralMeshCreator(function (size) {
    if (size == null) {
        size = 1;
    }
    if (typeof size === 'number') {
        size = [size, size, size];
    }
    return new CubeGeo({
        width: size[0],
        height: size[1],
        depth: size[2]
    });
});

/**
 * Create a sphere mesh and add it to the scene.
 * @method
 * @param {number} [size=1] Sphere radius.
 * @param {Object|clay.Material} [material]
 * @return {clay.Mesh}
 * @example
 *  // Create a 2 radius blue semi-transparent sphere.
 *  app.createSphere(2, {
 *      color: [0, 0, 1],
 *      transparent: true,
 *      alpha: 0.5
 *  })
 */
App3D.prototype.createSphere = makeProceduralMeshCreator(function (radius) {
    if (radius == null) {
        radius = 1;
    }
    return new SphereGeo({
        radius: radius
    });
});

/**
 * Create a plane mesh and add it to the scene.
 * @method
 * @param {Array.<number>|number} [size=1] Plane size. Can be a number to represent both width and height. Or an array to represent them respectively.
 * @param {Object|clay.Material} [material]
 * @return {clay.Mesh}
 * @example
 *  // Create a 2 width, 1 height red color plane.
 *  app.createPlane([2, 1], {
 *      color: [1, 0, 0]
 *  })
 */
App3D.prototype.createPlane = makeProceduralMeshCreator(function (size) {
    if (size == null) {
        size = 1;
    }
    if (typeof size === 'number') {
        size = [size, size];
    }
    return new PlaneGeo({
        width: size[0],
        height: size[1]
    });
});

/**
 * Create a perspective or orthographic camera and add it to the scene.
 * @param {Array.<number>|clay.math.Vector3} position
 * @param {Array.<number>|clay.math.Vector3} target
 * @param {string} [type="perspective"] Can be 'perspective' or 'orthographic'(in short 'ortho')
 * @return {clay.camera.Perspective}
 */
App3D.prototype.createCamera = function (position, target, type) {
    var CameraCtor;
    if (type === 'ortho' || type === 'orthographic') {
        CameraCtor = OrthographicCamera;
    }
    else {
        if (type && type !== 'perspective') {
            console.error('Unkown camera type ' + type + '. Use default perspective camera');
        }
        CameraCtor = PerspectiveCamera;
    }

    var camera = new CameraCtor();
    if (position instanceof Vector3) {
        camera.position.copy(position);
    }
    else if (position instanceof Array) {
        camera.position.setArray(position);
    }

    if (target instanceof Array) {
        target = new Vector3(target[0], target[1], target[2]);
    }
    if (target instanceof Vector3) {
        camera.lookAt(target);
    }

    this.scene.add(camera);

    return camera;
};

/**
 * Load a [glTF](https://github.com/KhronosGroup/glTF) format model.
 * You can convert FBX/DAE/OBJ format models to [glTF](https://github.com/KhronosGroup/glTF) with [fbx2gltf](https://github.com/pissang/claygl#fbx-to-gltf20-converter) python script,
 * or more simply using the [Clay Viewer](https://github.com/pissang/clay-viewer) client application.
 * @param {string} url
 * @param {Object} opts
 * @param {string} [opts.shader='lambert'] 'basic'|'lambert'|'standard'
 * @param {boolean} [opts.waitTextureLoaded=false] If add to scene util textures are all loaded.
 * @param {boolean} [opts.autoPlayAnimation=false] If autoplay the animation of model.
 * @param {boolean} [opts.upAxis='y'] Change model to y up if upAxis is 'z'
 * @param {boolean} [opts.textureFlipY=false]
 * @param {string} [opts.textureRootPath] Root path of texture. Default to be relative with glTF file.
 * @return {Promise}
 */
App3D.prototype.loadModel = function (url, opts) {
    if (typeof url !== 'string') {
        throw new Error('Invalid URL.');
    }

    opts = opts || {};
    var shaderName = opts.shader || 'standard';

    var loaderOpts = {
        rootNode: new Node(),
        shaderName: 'clay.' + shaderName,
        textureRootPath: opts.textureRootPath,
        crossOrigin: 'Anonymous',
        textureFlipY: opts.textureFlipY
    };

    var loader = new GLTFLoader(loaderOpts);

    var scene = this.scene;
    var timeline = this.timeline;

    return new Promise(function (resolve, reject) {
        function afterLoad(result) {
            scene.add(result.rootNode);
            if (opts.autoPlayAnimation) {
                result.clips.forEach(function (clip) {
                    timeline.addClip(clip);
                });
            }
            resolve(result);
        }
        loader.success(function (result) {
            if (!opts.waitTextureLoaded) {
                afterLoad(result);
            }
            else {
                Promise.all(result.textures.map(function (texture) {
                    if (texture.isRenderable()) {
                        return Promise.resolve(texture);
                    }
                    else {
                        return new Promise(function (resolve) {
                            texture.success(resolve);
                            texture.error(resolve);
                        });
                    }
                })).then(function () {
                    afterLoad(result);
                }).catch(function () {
                    afterLoad(result);
                });
            }
        });
        loader.error(function () {
            reject();
        });
        loader.load(url);
    });
};


export default {
    App3D: App3D,
    /**
     * Create a 3D application that will manage the app initialization and loop.
     * @name clay.application.create
     * @param {HTMLDomElement|string} dom Container dom element or a selector string that can be used in `querySelector`
     * @param {Object} appNS
     * @param {Function} init Initialization callback that will be called when initing app.
     * @param {Function} loop Loop callback that will be called each frame.
     * @param {number} [width] Container width.
     * @param {number} [height] Container height.
     * @param {number} [devicePixelRatio]
     * @return {clay.application.App3D}
     *
     * @example
     *  clay.application.create('#app', {
     *      init: function (app) {
     *          app.createCube();
     *          var camera = app.createCamera();
     *          camera.position.set(0, 0, 2);
     *      },
     *      loop: function () { // noop }
     *  })
     */
    create: function (dom, appNS) {
        return new App3D(dom, appNS);
    }
};